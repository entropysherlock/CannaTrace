import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { facilities, itemCategories, items, labResults, locations, organizations, packages, users, watchFindings } from "@/db/schema";
import { confirmProposal } from "@/lib/assistant/engine";
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
      { tag: "1A4000000000000000000001", quantity: "1250.5", unit: "Grams", item: "Flower", status: "Active" },
      { tag: "1A4000000000000000000002", quantity: "12", unit: "Each", item: "Jar", status: "Active" },
    ]);
    expect(parseStateReport("Package Label,Qty,UoM\nX1,3,Ounces\n").rows[0]).toMatchObject({ tag: "X1", quantity: "3", unit: "Ounces" });
    expect(() => parseStateReport("Name,Quantity\nA,1\n")).toThrow(/Couldn't find a Tag column/);
    expect(() => parseStateReport("Tag\nA\na\n")).toThrow(/appears twice/);
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

  it("finds a failed-lab package still for sale, fixes it with one approved hold, resolves, and reopens on Undo", async () => {
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

    // Undo puts it back on sale, so the next sweep raises it again.
    const res = await fetchUndo(owner, done.changeId!);
    expect(res).toMatch(/^Undone/);
    await sweepFacility(owner);
    expect(await finding("lab_fail")).toBeDefined();
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
