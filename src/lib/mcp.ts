import "server-only";
import type { ApiKey } from "@/db/schema";
import { InventoryError } from "./inventory-math";
import { can, type Permission } from "./rbac";
import type { Session } from "./session";
import { TOOLS, type Tool } from "./assistant/tools";
import { recordChange } from "./assistant/changes";

/**
 * A connector for outside AI apps (Claude, ChatGPT, and anything else that speaks MCP).
 * It offers the same tools Tally uses, scoped to the one business and facility an API key belongs to.
 * Read tools work with any key. Change tools need a key made with write access, run through the same
 * checks and functions as the screens, are recorded in the audit trail under the key's name, can be
 * previewed first, can be undone, and never run twice for the same request_id.
 */

/** Tally tools that work on chat attachments or Tally's own findings, which make no sense outside the chat. */
const LEFT_OUT = new Set(["attachment_rows", "compare_attachment_inventory", "watch_findings"]);

const VIEW_PERMISSIONS: Permission[] = ["inventory.view", "cultivation.view", "sales.view", "audit.view", "compliance.view", "reports.view"];
/** What a write key may change. Settings, people, integrations, and compliance setup are never offered here. */
const WRITE_PERMISSIONS: Permission[] = ["inventory.write", "inventory.adjust", "cultivation.write", "manufacturing.write", "sales.write", "catalog.manage", "labels.print"];

const OFFERED = TOOLS.filter((t) => !LEFT_OUT.has(t.name));

/** The identity an API key acts as: view-only, or view plus the change permissions above for a write key. */
export function sessionForKey(key: ApiKey): Session {
  return {
    userId: `api:${key.id}`,
    orgId: key.orgId,
    facilityId: key.facilityId,
    role: "READ_ONLY",
    name: `API key "${key.name}"`,
    permissions: key.canWrite ? [...VIEW_PERMISSIONS, ...WRITE_PERMISSIONS] : VIEW_PERMISSIONS,
    roleName: key.canWrite ? "API key with write access" : "Read-only API key",
    customRoleId: null,
    facilityIds: [key.facilityId],
  };
}

/** The tools this key may use. Change tools appear only for write keys, and only those its permissions allow. */
export function toolsForKey(key: ApiKey): Tool[] {
  const session = sessionForKey(key);
  return OFFERED.filter((t) => (t.kind === "read" ? t.permission === null || can(session, t.permission) : key.canWrite && can(session, t.permission)));
}

const textResult = (text: string, isError = false) => ({ ...(isError ? { isError: true } : {}), content: [{ type: "text", text }] });

async function callTool(tool: Tool, key: ApiKey, args: Record<string, unknown>) {
  const session = sessionForKey(key);
  if (tool.kind === "read") return textResult(JSON.stringify(await tool.run(session, args), null, 2));

  const { preview, request_id, ...input } = args;
  const proposal = await tool.propose(session, input);
  const needed = [tool.permission, ...(tool.extraPermissions?.(proposal.action.args) ?? [])];
  if (!needed.every((p) => can(session, p))) throw new InventoryError("This API key is not allowed to make that change.");
  if (preview === true) {
    const lines = [proposal.title, ...proposal.details.map((d) => `${d.label}: ${d.value}`), ...(proposal.steps ?? []).map((x, i) => `${i + 1}. ${x}`)];
    return textResult(`PREVIEW ONLY, nothing was changed.\n${lines.join("\n")}\nCall again without preview to make this change.`);
  }
  const actor = { userId: session.userId, userName: `${session.name} (via AI connector)`, orgId: session.orgId, facilityId: session.facilityId };
  // A retried request with the same request_id runs once.
  const id = typeof request_id === "string" && /^[\w.-]{8,64}$/.test(request_id) ? request_id : crypto.randomUUID().replace(/-/g, "");
  const exec = `mcp:${key.id}:${id}`;
  if (tool.record === false) return textResult(await tool.execute(actor, proposal.action.args, { key: exec }));
  const outcome = await recordChange(actor, { key: exec, tool: tool.name, title: proposal.title }, () => tool.execute(actor, proposal.action.args, { key: exec }));
  return textResult(`${outcome.message}${outcome.undoable ? " (This can be undone with undo_tally_change.)" : ""}`);
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];

const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** Answer one JSON-RPC message. Returns null for notifications, which get no reply. */
export async function handleMcp(message: Rpc, key: ApiKey): Promise<unknown | null> {
  const { id, method, params } = message;
  if (typeof method !== "string") return fail(id, -32600, "Invalid request.");
  if (id === undefined) return null; // a notification, such as notifications/initialized

  if (method === "initialize") {
    const asked = typeof params?.protocolVersion === "string" ? params.protocolVersion : "";
    return ok(id, {
      protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
      capabilities: { tools: {} },
      serverInfo: { name: "leaf2sale", version: "1.0.0" },
      instructions: key.canWrite
        ? "Access to one Leaf2Sale facility: inventory, plants, sales, wholesale orders, production, and state reporting. Tools that change data accept preview=true to show what would happen first; check with the person before making a change. Pass a unique request_id so a retry never repeats a change."
        : "Read-only access to one Leaf2Sale facility: inventory, plants, sales, wholesale orders, production, and state reporting. Nothing here changes data.",
    });
  }
  if (method === "ping") return ok(id, {});
  if (method === "tools/list") {
    return ok(id, {
      tools: toolsForKey(key).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema:
          t.kind === "read"
            ? t.schema
            : {
                ...t.schema,
                properties: {
                  ...((t.schema.properties as Record<string, unknown>) ?? {}),
                  preview: { type: "boolean", description: "Set true to see what this would change without changing anything." },
                  request_id: { type: "string", description: "A unique id for this request (8-64 letters, digits, dashes). Sending the same id again does not repeat the change." },
                },
              },
        annotations: t.kind === "read" ? { readOnlyHint: true, destructiveHint: false, openWorldHint: false } : { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      })),
    });
  }
  if (method === "tools/call") {
    const name = typeof params?.name === "string" ? params.name : "";
    const tool = toolsForKey(key).find((t) => t.name === name);
    if (!tool) return fail(id, -32602, `Unknown tool: ${name || "(none)"}.`);
    const args = params?.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? (params.arguments as Record<string, unknown>) : {};
    try {
      return ok(id, await callTool(tool, key, args));
    } catch (error) {
      // Business-rule messages are safe to show; anything else stays in our logs.
      if (error instanceof InventoryError) return ok(id, textResult(error.message, true));
      console.error(error);
      return ok(id, textResult("Something went wrong on our side. Nothing was changed.", true));
    }
  }
  return fail(id, -32601, `Method not found: ${method}.`);
}
