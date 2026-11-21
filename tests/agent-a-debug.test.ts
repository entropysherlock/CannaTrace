import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { facilities, itemCategories, items, locations, orders, organizations, plantBatches, plants, priceLists, scanReads, strains, users } from "@/db/schema";
import { applyHarvestSheet, applyPriceList, applyWholesaleOrder } from "@/lib/scan/apply";
import { confirmProposal, signProposal } from "@/lib/assistant/engine";
import { TOOLS } from "@/lib/assistant/tools";
import { changePlantPhase, tagPlants, untagPlants } from "@/lib/cultivation";
import { db, pool } from "@/lib/db";
import { addDays, todayIn } from "@/lib/distribution-math";
import { createCustomer } from "@/lib/distribution";
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

  const scan = async (docType: string) => {
    const attachmentId = `att-${docType}-${crypto.randomUUID()}`;
    await db.insert(scanReads).values({ orgId: actor.orgId, facilityId: actor.facilityId, userId: actor.userId, attachmentId, kind: "DOC", proposal: { kind: "DOC", docType, fields: [], items: [], warnings: [] } });
    return attachmentId;
  };

  it("a harvest sheet that lists one plant twice doesn't double its weight", async () => {
    const b = await batch(`HS-${run}`, 0);
    const [pl] = await db.insert(plants).values({ orgId: actor.orgId, facilityId: actor.facilityId, strainId, batchId: b.id, tag: `${run}-H1`, locationId: flowerRm, phase: "FLOWERING" }).returning();
    await expect(
      applyHarvestSheet(owner, { attachmentId: await scan("HARVEST_SHEET"), name: `H-${run}`, unit: "G", locationId: flowerRm, rows: [{ plantId: pl.id, weight: "100" }, { plantId: pl.id, weight: "100" }] }),
    ).rejects.toThrow(/more than once/);
  });

  it("a price list that fails halfway saves nothing, so it can be tried again", async () => {
    const [cat] = await db.select().from(itemCategories).where(eq(itemCategories.orgId, actor.orgId));
    await db.insert(items).values({ orgId: actor.orgId, name: `Retired ${run}`, sku: `RET-${run}`, categoryId: cat.id, unit: "EACH", active: false });
    const rows = [
      { itemId: "", sku: "", product: `Fresh Thing ${run}`, category: "Flower", unit: "EACH", price: "3" },
      { itemId: "", sku: `RET-${run}`, product: `Clash ${run}`, category: "Flower", unit: "EACH", price: "4" },
    ];
    await expect(applyPriceList(owner, { attachmentId: await scan("PRICE_LIST"), listId: "", newListName: `PL ${run}`, rows })).rejects.toThrow();
    expect(await db.$count(priceLists, eq(priceLists.name, `PL ${run}`))).toBe(0);
    expect(await db.$count(items, eq(items.name, `Fresh Thing ${run}`))).toBe(0);
  });

  it("saving the same wholesale order twice at once makes one draft order", async () => {
    const cust = await createCustomer(actor, { name: `Buyer ${run}`, licenseNumber: `L-${run}`, licenseType: "Retailer", licenseExpires: addDays(todayIn(), 200) });
    const [cat] = await db.select().from(itemCategories).where(eq(itemCategories.orgId, actor.orgId));
    const [it] = await db.insert(items).values({ orgId: actor.orgId, name: `Jar ${run}`, sku: `JAR-${run}`, categoryId: cat.id, unit: "EACH" }).returning();
    const attachmentId = await scan("WHOLESALE_ORDER");
    const input = { attachmentId, customerId: cust.id, lines: [{ itemId: it.id, quantity: "2", unitPrice: "5" }] };
    const results = await Promise.allSettled([applyWholesaleOrder(owner, input), applyWholesaleOrder(owner, input)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.$count(orders, eq(orders.customerId, cust.id))).toBe(1);
  });
});
