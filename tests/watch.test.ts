import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { facilities, harvests, itemCategories, items, labResults, locations, organizations, packages, plantBatches, plants, strains, users, watchFindings } from "@/db/schema";
import { confirmProposal, signProposal } from "@/lib/assistant/engine";
import { TOOLS } from "@/lib/assistant/tools";
import { db, pool } from "@/lib/db";
import { addDays, todayIn } from "@/lib/distribution-math";
import { createCustomer, createOrder } from "@/lib/distribution";
import { receivePackage, type Actor } from "@/lib/inventory";
import { ensureStarterTemplates } from "@/lib/labels/service";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { Session } from "@/lib/session";
import { dismissFinding, openFindings, parseStateReport, saveStateReport, sweepFacility } from "@/lib/watch";
import { CHECKS } from "@/lib/watch/checks";
import { prepareFix } from "@/lib/watch/fix";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `WT${Date.now().toString(36).toUpperCase()}`;

describe("reading a state package report", () => {
  it("finds the columns, splits '12.5 Grams', and refuses files it can't use", () => {
    const { rows } = parseStateReport('﻿Tag,Item,Quantity,Status\n1A4000000000000000000001,Flower,"1,250.5 Grams",Active\n1a4000000000000000000002,Jar,12 Each,Active\n');
    expect(rows).toEqual([
      { tag: "1A4000000000000000000001", quantity: "1250.5", unit: "Grams", item: "Flower", status: "Active", unreadableQuantity: null },
      { tag: "1A4000000000000000000002", quantity: "12", unit: "Each", item: "Jar", status: "Active", unreadableQuantity: null },
    ]);
    expect(parseStateReport("Package Label,Qty,UoM\nX1,3,Ounces\n").rows[0]).toMatchObject({ tag: "X1", quantity: "3", unit: "Ounces" });
    expect(() => parseStateReport("Name,Quantity\nA,1\n")).toThrow(/Couldn't find a Tag column/);
    expect(() => parseStateReport("Tag\nA\na\n")).toThrow(/appears twice/);
    // Text that isn't a number is kept aside, so it's reported rather than treated as a match.
    expect(parseStateReport("Tag,Quantity\nX2,abc\n").rows[0]).toMatchObject({ quantity: null, unreadableQuantity: "abc" });
  });
});

describe.skipIf(!hasDb)("Tally Watch (database)", () => {
  let actor: Actor;
  let owner: Session;
  const as = (role: Role): Session => ({ ...owner, role, permissions: permissionsFor(role), roleName: role, customRoleId: null });
  let vault: string;
  let jar: string;
  const fixAndConfirm = async (s: Session, findingId: string) => {
    const card = await prepareFix(s, findingId);
    return { card, ...(await confirmProposal(s, card.token)) };
  };
  const finding = async (check: string) => (await openFindings(owner)).find((f) => f.check === check);

  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Watch ${run}` }).returning();
    const [fac] = await db.insert(facilities).values({ orgId: org.id, name: "Mesa", licenseNumber: `${run}-F`, licenseType: "RETAIL", state: "NM" }).returning();
    const [u] = await db.insert(users).values({ orgId: org.id, name: "Wes Watch", email: `w-${run}@t.invalid`, passwordHash: "x", role: "OWNER" }).returning();
    actor = { userId: u.id, userName: u.name, orgId: org.id, facilityId: fac.id };
    owner = { userId: u.id, orgId: org.id, facilityId: fac.id, name: u.name, role: "OWNER", permissions: permissionsFor("OWNER"), roleName: "Owner", customRoleId: null };
    const [v] = await db.insert(locations).values({ orgId: org.id, facilityId: fac.id, name: "Vault", type: "ROOM" }).returning();
    vault = v.id;
    const [cat] = await db.insert(itemCategories).values({ orgId: org.id, name: "Jars" }).returning();
    const [i] = await db.insert(items).values({ orgId: org.id, name: "Haze Jar", sku: `${run}-J`, categoryId: cat.id, unit: "EACH" }).returning();
    jar = i.id;
  });
  afterAll(() => pool.end());

  it("runs every check without an error on the seeded demo business", async () => {
    const [demo] = await db.select().from(facilities).where(eq(facilities.licenseNumber, "DEMO-CULT-0001"));
    expect(demo).toBeDefined();
    for (const check of CHECKS) await expect(check.run({ orgId: demo.orgId, facilityId: demo.id }), check.name).resolves.toBeInstanceOf(Array);
    expect((await sweepFacility({ orgId: demo.orgId, facilityId: demo.id })).failedChecks).toEqual([]);
  });

  it("finds a failed-lab package still for sale, fixes it with one approved hold, and won't Undo it back on sale until a retest passes", async () => {
    const pkg = await receivePackage(actor, { tag: `${run}-FAIL`, itemId: jar, quantity: "10", locationId: vault });
    await db.insert(labResults).values({ orgId: actor.orgId, facilityId: actor.facilityId, packageId: pkg.id, labName: "Mesa Labs", status: "FAIL", sampleDate: "2026-11-10", userId: actor.userId });
    await sweepFacility(owner);
    const f = await finding("lab_fail");
    expect(f).toMatchObject({ severity: "critical", title: `Package ${run}-FAIL failed its lab test but can still be sold` });
    expect(f!.fix?.label).toBe("Hold it");

    const done = await fixAndConfirm(owner, f!.id);
    expect(done.card.steps).toEqual([`Hold ${run}-FAIL (Failed lab test (Mesa Labs, sampled 2026-11-10))`]);
    expect((await db.select().from(packages).where(eq(packages.id, pkg.id)))[0].status).toBe("ON_HOLD");
    expect((await sweepFacility(owner)).resolved).toBeGreaterThanOrEqual(1);
    expect(await finding("lab_fail")).toBeUndefined();

    // Undo would put failed product back on sale, so it is refused until a retest passes.
    await expect(fetchUndo(owner, done.changeId!)).rejects.toThrow(/failed its most recent lab test/);
    await db.insert(labResults).values({ orgId: actor.orgId, facilityId: actor.facilityId, packageId: pkg.id, labName: "Mesa Labs", status: "PASS", sampleDate: "2026-11-12", userId: actor.userId });
    const res = await fetchUndo(owner, done.changeId!);
    expect(res).toMatch(/^Undone/);
    expect((await db.select().from(packages).where(eq(packages.id, pkg.id)))[0].status).toBe("ACTIVE");
    await sweepFacility(owner);
    expect(await finding("lab_fail")).toBeUndefined();
  });

  it("drafts the close-out for a weighed harvest: package everything left as the strain's bulk item, then finish", async () => {
    const [strain] = await db.insert(strains).values({ orgId: actor.orgId, name: `Draft Haze ${run}`, type: "HYBRID" }).returning();
    const [cat] = await db.insert(itemCategories).values({ orgId: actor.orgId, name: `Bulk ${run}` }).returning();
    await db.insert(items).values({ orgId: actor.orgId, name: `Draft Haze Flower (bulk) ${run}`, sku: `${run}-DH`, categoryId: cat.id, unit: "G", strain: `Draft Haze ${run}` });
    const [h] = await db
      .insert(harvests)
      .values({ orgId: actor.orgId, facilityId: actor.facilityId, name: `DH-${run}`, strainId: strain.id, locationId: vault, plantCount: 6, wetWeight: "9000", dryWeight: "7490", userId: actor.userId, harvestedAt: new Date(Date.now() - 2 * 86400_000) })
      .returning();
    await sweepFacility(owner);
    const f = (await openFindings(owner)).find((x) => x.check === "harvest_open" && x.title.includes(`DH-${run}`));
    expect(f?.fix?.label).toBe("Review the drafted close-out");
    expect(f?.detail).toContain("7,490 g");
    const done = await fixAndConfirm(owner, f!.id);
    expect(done.card.steps).toEqual([`Package the remaining 7,490 g as Draft Haze Flower (bulk) ${run} (the tag is made for you)`, `Finish harvest DH-${run}`]);
    const closed = (await db.select().from(harvests).where(eq(harvests.id, h.id)))[0];
    expect(closed.status).toBe("FINISHED");
    expect(Number(closed.packagedWeight)).toBe(7490);
    const made = await db.select().from(packages).where(eq(packages.lotNumber, `DH-${run}`));
    expect(made).toHaveLength(1);
    expect(Number(made[0].quantity)).toBe(7490);
    expect(made[0].tag).toBeTruthy();
  });

  it("doesn't draft a close-out when the strain has no single bulk item to package into", async () => {
    const [strain] = await db.insert(strains).values({ orgId: actor.orgId, name: `No Bulk ${run}`, type: "INDICA" }).returning();
    await db.insert(harvests).values({ orgId: actor.orgId, facilityId: actor.facilityId, name: `NB-${run}`, strainId: strain.id, locationId: vault, plantCount: 2, wetWeight: "900", dryWeight: "300", userId: actor.userId, harvestedAt: new Date(Date.now() - 2 * 86400_000) });
    await sweepFacility(owner);
    const f = (await openFindings(owner)).find((x) => x.check === "harvest_open" && x.title.includes(`NB-${run}`));
    expect(f).toBeTruthy();
    expect(f?.fix).toBeFalsy();
    expect(f?.detail).toContain(`Add one bulk item for No Bulk ${run}`);
  });

  const undoChange = async (changeId: string) => {
    const tool = TOOLS.find((t) => t.name === "undo_tally_change") as unknown as { propose: (s: Session, i: Record<string, unknown>) => Promise<Parameters<typeof signProposal>[1]> };
    return confirmProposal(owner, await signProposal(owner, await tool.propose(owner, { change: changeId })));
  };
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

  it("drafts the tags for a batch that has none, and Undo takes them back", async () => {
    const [strain] = await db.insert(strains).values({ orgId: actor.orgId, name: `Tag Kush ${run}`, type: "INDICA" }).returning();
    const [b] = await db
      .insert(plantBatches)
      .values({ orgId: actor.orgId, facilityId: actor.facilityId, name: `TB-${run}`, strainId: strain.id, source: "CLONE", locationId: vault, initialCount: 3, untaggedCount: 3, userId: actor.userId, createdAt: hoursAgo(3) })
      .returning();
    await sweepFacility(owner);
    const f = (await openFindings(owner)).find((x) => x.check === "batch_untagged" && x.title.includes(`TB-${run}`));
    expect(f?.fix?.label).toBe("Review the drafted tags");
    const done = await fixAndConfirm(owner, f!.id);
    expect(done.card.steps).toEqual([`Tag 3 plants in TB-${run} (the tags are made for you)`]);
    expect(await db.$count(plants, eq(plants.batchId, b.id))).toBe(3);
    expect((await db.select().from(plantBatches).where(eq(plantBatches.id, b.id)))[0]).toMatchObject({ untaggedCount: 0, status: "CLOSED" });
    await undoChange(done.changeId!);
    expect(await db.$count(plants, eq(plants.batchId, b.id))).toBe(0);
    expect((await db.select().from(plantBatches).where(eq(plantBatches.id, b.id)))[0]).toMatchObject({ untaggedCount: 3, status: "ACTIVE" });
  });

  it("drafts the move to the flower room once plants have been in veg as long as their strain says, and Undo puts them back", async () => {
    const [flowerRm] = await db.insert(locations).values({ orgId: actor.orgId, facilityId: actor.facilityId, name: `Flower Room ${run}`, type: "ROOM" }).returning();
    const [vegRm] = await db.insert(locations).values({ orgId: actor.orgId, facilityId: actor.facilityId, name: `Veg Room ${run}`, type: "ROOM" }).returning();
    const [strain] = await db.insert(strains).values({ orgId: actor.orgId, name: `Veg Haze ${run}`, type: "SATIVA", vegDays: 30 }).returning();
    const [b] = await db
      .insert(plantBatches)
      .values({ orgId: actor.orgId, facilityId: actor.facilityId, name: `VB-${run}`, strainId: strain.id, source: "SEED", locationId: vegRm.id, initialCount: 3, untaggedCount: 0, status: "CLOSED", userId: actor.userId })
      .returning();
    const longAgo = new Date(Date.now() - 40 * 86400_000);
    const base = { orgId: actor.orgId, facilityId: actor.facilityId, strainId: strain.id, batchId: b.id };
    await db.insert(plants).values([
      { ...base, tag: `${run}-V1`, locationId: vegRm.id, phaseChangedAt: longAgo },
      { ...base, tag: `${run}-V2`, locationId: vegRm.id, phaseChangedAt: longAgo },
      { ...base, tag: `${run}-F1`, locationId: flowerRm.id, phase: "FLOWERING" as const },
    ]);
    await sweepFacility(owner);
    const f = (await openFindings(owner)).find((x) => x.check === "plants_ready_flower" && x.title.includes(`VB-${run}`));
    expect(f?.title).toMatch(/^2 plants in VB-/);
    expect(f?.detail).toContain(`Flower Room ${run}`);
    const done = await fixAndConfirm(owner, f!.id);
    expect(done.card.steps).toEqual([`Change 2 plants in VB-${run} to flowering`, `Move 2 plants to Flower Room ${run}`]);
    const now = await db.select().from(plants).where(eq(plants.batchId, b.id));
    expect(now.filter((p) => p.phase === "FLOWERING" && p.locationId === flowerRm.id)).toHaveLength(3);
    await undoChange(done.changeId!);
    const back = await db.select().from(plants).where(and(eq(plants.batchId, b.id), eq(plants.status, "ACTIVE")));
    const v = back.filter((p) => p.tag.startsWith(`${run}-V`));
    expect(v.every((p) => p.phase === "VEGETATIVE" && p.locationId === vegRm.id)).toBe(true);
    // Not due yet: a strain with longer veg days isn't flagged
    await db.update(strains).set({ vegDays: 90 }).where(eq(strains.id, strain.id));
    await sweepFacility(owner);
    expect((await openFindings(owner)).find((x) => x.check === "plants_ready_flower" && x.title.includes(`VB-${run}`))).toBeUndefined();
  });

  it("flags new packages with no label and prepares one print job for all of them", async () => {
    await sweepFacility(owner);
    const f = await finding("unlabeled");
    expect(f?.title).toMatch(/new packages? (has|have) no label printed/);
    await ensureStarterTemplates(actor, "NM");
    const done = await fixAndConfirm(owner, f!.id);
    expect(done.message).toMatch(/Print job ready|Labels were not prepared/);
    if (done.message.includes("Print job ready")) {
      await sweepFacility(owner);
      expect(await finding("unlabeled")).toBeUndefined();
    }
  });

  it("matches CannaTrace against an uploaded state report and fixes a quantity mismatch", async () => {
    await receivePackage(actor, { tag: `${run}-SAME`, itemId: jar, quantity: "5", locationId: vault });
    await receivePackage(actor, { tag: `${run}-DIFF`, itemId: jar, quantity: "8", locationId: vault });
    await receivePackage(actor, { tag: `${run}-HERE`, itemId: jar, quantity: "2", locationId: vault });
    const csv = ["Tag,Item,Quantity,UoM,Status", `${run}-SAME,Haze,5,Each,Active`, `${run}-DIFF,Haze,7,Each,Active`, `${run}-THERE,Haze,4,Each,Active`, `${run}-FAIL,Haze,10,Each,Active`].join("\n");
    await expect(saveStateReport(owner, { fileName: "metrc.csv", text: "Name\nx" })).rejects.toThrow(/Tag column/);
    expect(await saveStateReport(owner, { fileName: "metrc.csv", text: csv })).toEqual({ packages: 4 });
    const open = await openFindings(owner);
    const titles = open.map((f) => f.title);
    expect(titles).toContain(`Package ${run}-DIFF: CannaTrace has 8 ea, the state has 7 ea`);
    expect(titles).toContain(`Package ${run}-HERE is in stock here but missing in the state system`);
    expect(titles).toContain(`Package ${run}-THERE is open in the state system but not in CannaTrace`);
    expect(titles.some((t) => t.includes(`${run}-SAME`))).toBe(false);

    // A budtender doesn't see compliance findings, and can't run their fixes.
    const diff = open.find((f) => f.check === "state_qty")!;
    expect((await openFindings(as("BUDTENDER"))).some((f) => f.check.startsWith("state"))).toBe(false);
    await expect(prepareFix(as("BUDTENDER"), diff.id)).rejects.toThrow(/not found/);

    const done = await fixAndConfirm(owner, diff.id);
    expect(done.card.steps![0]).toMatch(/Set .*-DIFF from 8 ea to 7 ea \(Cycle count correction\)/);
    expect(Number((await db.select().from(packages).where(eq(packages.tag, `${run}-DIFF`)))[0].quantity)).toBe(7);
    await sweepFacility(owner);
    expect((await openFindings(owner)).some((f) => f.check === "state_qty")).toBe(false);
  });

  it("warns about open orders shipping to a license about to expire, and remembers dismissals", async () => {
    const shop = await createCustomer(actor, { name: "Soon Expiring Co", licenseNumber: `${run}-SE`, licenseType: "Retailer", licenseExpires: addDays(todayIn(), 5) });
    await createOrder(actor, { customerId: shop.id });
    await sweepFacility(owner);
    const f = await finding("license");
    expect(f).toMatchObject({ severity: "warning" });
    expect(f!.title).toMatch(/expires in 5 days/);
    expect(f!.fix).toBeNull();
    await dismissFinding(owner, f!.id);
    await sweepFacility(owner);
    expect(await finding("license")).toBeUndefined();
    const [row] = await db.select().from(watchFindings).where(and(eq(watchFindings.id, f!.id)));
    expect(row).toMatchObject({ status: "DISMISSED", dismissedByName: "Wes Watch" });
  });
});

/** Undo through the same function the one-click button uses. */
async function fetchUndo(s: Session, changeId: string): Promise<string> {
  const { undoChange } = await import("@/lib/assistant/changes");
  return undoChange({ userId: s.userId, userName: `${s.name} (undo via assistant)`, orgId: s.orgId, facilityId: s.facilityId }, changeId);
}
