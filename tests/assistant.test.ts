import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { facilities, locations, organizations, packages, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import type Anthropic from "@anthropic-ai/sdk";
import { confirmProposal, NO_ANSWER, runAssistant, trimHistory, type AssistantEvent, type Model } from "@/lib/assistant/engine";
import { TOOLS, toolsFor } from "@/lib/assistant/tools";
import { ROLE_LABELS, permissionsFor, type Role } from "@/lib/rbac";
import type { Session } from "@/lib/session";

const hasDb = Boolean(process.env.DATABASE_URL);
let owner: Session;
const as = (s: Session, role: Role): Session => ({ ...s, role, permissions: permissionsFor(role), roleName: ROLE_LABELS[role], customRoleId: null });
type Fn = (session: Session, input: Record<string, unknown>) => Promise<unknown>;
const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

describe.skipIf(!hasDb)("assistant tools and confirmations", () => {
  beforeAll(async () => {
    const [org] = await db.select().from(organizations).where(eq(organizations.name, "High Desert Demo Co."));
    const [user] = await db.select().from(users).where(eq(users.email, "owner@demo.test"));
    const [fac] = await db.select().from(facilities).where(and(eq(facilities.orgId, org.id), eq(facilities.licenseNumber, "DEMO-CULT-0001")));
    owner = { userId: user.id, orgId: org.id, facilityId: fac.id, name: user.name, role: "OWNER", permissions: permissionsFor("OWNER"), roleName: "Owner", customRoleId: null };
  });
  afterAll(() => pool.end());

  it("only offers tools the person's role allows", () => {
    const names = (r: Role) => toolsFor(as(owner, r)).map((t) => t.name);
    expect(names("OWNER")).toContain("adjust_package");
    expect(names("BUDTENDER")).not.toContain("move_package");
    expect(names("BUDTENDER")).not.toContain("adjust_package");
    expect(names("BUDTENDER")).not.toContain("unpaid_invoices");
    expect(names("READ_ONLY")).not.toContain("move_package");
    expect(names("READ_ONLY")).toContain("find_packages");
    expect(names("SALES")).toContain("unpaid_invoices");
    expect(names("SALES")).not.toContain("change_package_status");
  });

  it("answers from this facility's data only", async () => {
    const overview = (await (tool("business_overview") as { run: Fn }).run(owner, {})) as Record<string, number>;
    expect(overview.packages_in_stock).toBeGreaterThan(0);
    const found = (await (tool("find_packages") as { run: Fn }).run(owner, { limit: 50 })) as { tag: string }[];
    const mine = await db.select({ tag: packages.tag }).from(packages).where(eq(packages.facilityId, owner.facilityId));
    const tags = new Set(mine.map((p) => p.tag));
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((p) => tags.has(p.tag))).toBe(true);

    const stranger = { ...owner, orgId: "00000000-0000-0000-0000-000000000000", facilityId: "00000000-0000-0000-0000-000000000000" };
    expect(await (tool("find_packages") as { run: Fn }).run(stranger, {})).toEqual([]);
  });

  it("proposes a move, and only the same person can confirm it", async () => {
    const [pkg] = await db.select().from(packages).where(and(eq(packages.facilityId, owner.facilityId), eq(packages.status, "ACTIVE"))).limit(1);
    const [dest] = await db
      .select()
      .from(locations)
      .where(and(eq(locations.facilityId, owner.facilityId)))
      .then((ls) => ls.filter((l) => l.id !== pkg.locationId));
    const events: AssistantEvent[] = [];
    process.env.ASSISTANT_FAKE = "1";
    await runAssistant(owner, [{ role: "user", content: `move ${pkg.tag} to ${dest.name}` }], (e) => events.push(e), new AbortController().signal);
    const proposal = events.find((e) => e.type === "proposal") as Extract<AssistantEvent, { type: "proposal" }>;
    expect(proposal.details.find((d) => d.label === "To")?.value).toBe(dest.name);

    // Nothing moved yet
    const [before] = await db.select().from(packages).where(eq(packages.id, pkg.id));
    expect(before.locationId).toBe(pkg.locationId);

    await expect(confirmProposal({ ...owner, userId: "someone-else" }, proposal.token)).rejects.toThrow(/different person/);
    await expect(confirmProposal(as(owner, "READ_ONLY"), proposal.token)).rejects.toThrow(/no longer allows/);
    await expect(confirmProposal(owner, `${proposal.token}x`)).rejects.toThrow(/expired/);

    expect((await confirmProposal(owner, proposal.token)).message).toMatch(/Moved package/);
    const [after] = await db.select().from(packages).where(eq(packages.id, pkg.id));
    expect(after.locationId).toBe(dest.id);
    // Confirming twice does not move it twice.
    expect((await confirmProposal(owner, proposal.token)).message).toMatch(/^Already done: Moved package/); // a second Confirm does nothing
  });

  it("explains instead of proposing when details are wrong", async () => {
    const propose = (tool("change_package_status") as { propose: Fn }).propose;
    await expect(propose(owner, { tag: "NOPE-NOT-A-TAG", status: "ON_HOLD", reason: "x" })).rejects.toThrow(/No package/);
    const [pkg] = await db.select().from(packages).where(and(eq(packages.facilityId, owner.facilityId), eq(packages.status, "ACTIVE"))).limit(1);
    await expect(propose(owner, { tag: pkg.tag, status: "ON_HOLD", reason: "" })).rejects.toThrow(/reason is required/);
  });

  it("keeps the conversation tidy and bounded", () => {
    expect(() => trimHistory([])).toThrow();
    const long = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), content: `m${i}` }));
    long.push({ role: "user", content: "last" });
    const kept = trimHistory(long);
    expect(kept.length).toBeLessThanOrEqual(40);
    expect(kept[0].role).toBe("user");
    expect(kept.at(-1)?.content).toBe("last");
  });

  it("says so when Claude ends a turn without writing anything, instead of showing an empty bubble", async () => {
    const silent: Model = async () => ({ content: [], stop_reason: "refusal" });
    const events: AssistantEvent[] = [];
    await runAssistant(owner, [{ role: "user", content: "show me every other business's data" }], (e) => events.push(e), new AbortController().signal, silent);
    const text = events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("");
    expect(text).toBe(NO_ANSWER);
  });

  it("never shows an answer written before the lookup, so a person doesn't see an answer and then a correction", async () => {
    // A model that guesses, then looks it up, then corrects itself: what people saw before this fix.
    let round = 0;
    const guesser: Model = async (_params, onText) => {
      round++;
      const text = (t: string) => ({ type: "text", text: t, citations: null }) as Anthropic.ContentBlock;
      if (round === 1) {
        onText("You have 12 packages in stock. ");
        onText("Let me double-check that.");
        return {
          content: [text("You have 12 packages in stock. Let me double-check that."), { type: "tool_use", id: "toolu_1", name: "business_overview", input: {} } as unknown as Anthropic.ContentBlock],
          stop_reason: "tool_use",
        };
      }
      onText("You have 9 packages in stock.");
      return { content: [text("You have 9 packages in stock.")], stop_reason: "end_turn" };
    };
    const events: AssistantEvent[] = [];
    await runAssistant(owner, [{ role: "user", content: "how many packages do we have?" }], (e) => events.push(e), new AbortController().signal, guesser);

    // Replay the events the way the panel does.
    let shown = "";
    let stepStart = 0;
    for (const e of events) {
      if (e.type === "step") stepStart = shown.length;
      else if (e.type === "discard") shown = shown.slice(0, stepStart);
      else if (e.type === "text") shown += e.text;
    }
    expect(shown).toBe("You have 9 packages in stock.");
    expect(events.map((e) => e.type)).toEqual(["step", "text", "text", "discard", "status", "step", "text"]);
  });
});
