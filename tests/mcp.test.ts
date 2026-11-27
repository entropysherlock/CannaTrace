import { describe, expect, it } from "vitest";
import type { ApiKey } from "@/db/schema";
import { handleMcp, toolsForKey } from "@/lib/mcp";

const key = (canWrite: boolean) => ({ id: "k1", orgId: "o1", facilityId: "f1", name: "Test", canWrite }) as ApiKey;

describe("AI connector (MCP)", () => {
  it("offers only read tools to a read-only key", () => {
    const tools = toolsForKey(key(false));
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((t) => t.kind === "read")).toBe(true);
  });

  it("offers change tools to a write key, but never settings or people", () => {
    const names = toolsForKey(key(true)).filter((t) => t.kind === "action").map((t) => t.name);
    expect(names).toContain("adjust_package");
    expect(toolsForKey(key(true)).filter((t) => t.kind === "action").every((t) => t.kind === "action" && !["settings.manage", "users.manage", "integrations.manage"].includes(t.permission))).toBe(true);
  });

  it("refuses a change tool on a read-only key", async () => {
    const reply = (await handleMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "adjust_package", arguments: {} } }, key(false))) as { error?: { code: number } };
    expect(reply.error?.code).toBe(-32602);
  });

  it("adds preview and request_id to change tools, and marks read tools read-only", async () => {
    const reply = (await handleMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, key(true))) as { result: { tools: { name: string; inputSchema: { properties: Record<string, unknown> }; annotations: { readOnlyHint: boolean } }[] } };
    const adjust = reply.result.tools.find((t) => t.name === "adjust_package")!;
    expect(adjust.inputSchema.properties.preview).toBeTruthy();
    expect(adjust.inputSchema.properties.request_id).toBeTruthy();
    expect(reply.result.tools.find((t) => t.name === "business_overview")!.annotations.readOnlyHint).toBe(true);
  });

  it("answers initialize and ignores notifications", async () => {
    const init = (await handleMcp({ jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "2025-03-26" } }, key(false))) as { result: { protocolVersion: string } };
    expect(init.result.protocolVersion).toBe("2025-03-26");
    expect(await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, key(false))).toBeNull();
  });
});
