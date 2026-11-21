import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { facilities, itemCategories, items, locations, organizations, plantBatches, plants, strains, users } from "@/db/schema";
import { confirmProposal, signProposal } from "@/lib/assistant/engine";
import { TOOLS } from "@/lib/assistant/tools";
import { changePlantPhase, tagPlants, untagPlants } from "@/lib/cultivation";
import { db, pool } from "@/lib/db";
import type { Actor } from "@/lib/inventory";
import { permissionsFor } from "@/lib/rbac";
import type { Session } from "@/lib/session";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `AD${Date.now().toString(36).toUpperCase()}`;

describe.skipIf(!hasDb)("recent-feature bug fixes (database)", () => {
  let actor: Actor;
  let owner: Session;
  let vegRm: string;
  let flowerRm: string;
  let strainId: string;

  const toolAndConfirm = async (name: string, input: Record<string, unknown>) => {
    const tool = TOOLS.find((t) => t.name === name) as unknown as { propose: (s: Session, i: Record<string, unknown>) => Promise<Parameters<typeof signProposal>[1]> };
    const card = await tool.propose(owner, input);
    return { card, ...(await confirmProposal(owner, await signProposal(owner, card))) };
  };
  const undoChange = async (changeId: string) => {
    const tool = TOOLS.find((t) => t.name === "undo_tally_change") as unknown as { propose: (s: Session, i: Record<string, unknown>) => Promise<Parameters<typeof signProposal>[1]> };
    return confirmProposal(owner, await signProposal(owner, await tool.propose(owner, { change: changeId })));
  };
  const batch = async (name: string, untagged: number) =>
    (await db.insert(plantBatches).values({ orgId: actor.orgId, facilityId: actor.facilityId, name, strainId, source: "CLONE", locationId: vegRm, initialCount: untagged, untaggedCount: untagged, userId: actor.userId }).returning())[0];

  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `AgentA ${run}` }).returning();
    const [fac] = await db.insert(facilities).values({ orgId: org.id, name: "Mesa", licenseNumber: `${run}-F`, licenseType: "CULTIVATION", state: "NM" }).returning();
    const [u] = await db.insert(users).values({ orgId: org.id, name: "Ann Agent", email: `a-${run}@t.invalid`, passwordHash: "x", role: "OWNER" }).returning();
    actor = { userId: u.id, userName: u.name, orgId: org.id, facilityId: fac.id };
    owner = { userId: u.id, orgId: org.id, facilityId: fac.id, name: u.name, role: "OWNER", permissions: permissionsFor("OWNER"), roleName: "Owner", customRoleId: null };
    const [v, f] = await db
      .insert(locations)
      .values([
        { orgId: org.id, facilityId: fac.id, name: `Veg ${run}`, type: "ROOM" },
        { orgId: org.id, facilityId: fac.id, name: `Flower Room ${run}`, type: "ROOM" },
      ])
      .returning();
    vegRm = v.id;
    flowerRm = f.id;
    const [st] = await db.insert(strains).values({ orgId: org.id, name: `Strain ${run}`, type: "HYBRID", vegDays: 30 }).returning();
    strainId = st.id;
    await db.insert(itemCategories).values({ orgId: org.id, name: "Flower" });
  });
  afterAll(() => pool.end());

  it("untagging refuses plants that have since moved on to flower", async () => {
    const b = await batch(`UT-${run}`, 2);
    const made = await tagPlants(actor, { batchId: b.id, generate: 2 });
    await changePlantPhase(actor, { plantIds: [made[0].id], phase: "FLOWERING" });
    await expect(untagPlants(actor, { batchId: b.id, tags: made.map((p) => p.tag) })).rejects.toThrow(/since they were tagged/);
    expect(await db.$count(plants, eq(plants.batchId, b.id))).toBe(2);
  });

  it("undoing a move to flower puts the veg clock back, so the plants are still due", async () => {
    const b = await batch(`UV-${run}`, 0);
    const longAgo = new Date(Date.now() - 40 * 86400_000);
    await db.insert(plants).values({ orgId: actor.orgId, facilityId: actor.facilityId, strainId, batchId: b.id, tag: `${run}-U1`, locationId: vegRm, phaseChangedAt: longAgo });
    await db.insert(plants).values({ orgId: actor.orgId, facilityId: actor.facilityId, strainId, batchId: b.id, tag: `${run}-F1`, locationId: flowerRm, phase: "FLOWERING" });
    const done = await toolAndConfirm("advance_batch", { batch: `UV-${run}`, only_due: true });
    await undoChange(done.changeId!);
    const [p] = await db.select().from(plants).where(and(eq(plants.batchId, b.id), eq(plants.tag, `${run}-U1`)));
    expect(p.phase).toBe("VEGETATIVE");
    expect(Math.abs(p.phaseChangedAt.getTime() - longAgo.getTime())).toBeLessThan(1000);
  });
});
