import { and, eq, inArray } from "drizzle-orm";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditLogs,
  facilities,
  harvests,
  itemCategories,
  items,
  locations,
  orders,
  organizations,
  packages,
  printJobs,
  productionRuns,
  strains,
  syncEvents,
  tallyChanges,
  users,
  wasteLogs,
} from "@/db/schema";
import { confirmProposal } from "@/lib/assistant/engine";
import { TOOLS, toolsFor } from "@/lib/assistant/tools";
import { db, pool } from "@/lib/db";
import { addDays, todayIn } from "@/lib/distribution-math";
import { createCustomer, createPriceList, setPrice } from "@/lib/distribution";
import { movePackage, type Actor } from "@/lib/inventory";
import { ensureStarterTemplates } from "@/lib/labels/service";
import { createRecipe } from "@/lib/manufacturing";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { Session } from "@/lib/session";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `TJ${Date.now().toString(36).toUpperCase()}`;
type Card = { title: string; details: { label: string; value: string }[]; steps?: string[]; action: { tool: string; args: Record<string, string> } };
const propose = (name: string, s: Session, input: Record<string, unknown>) =>
  (TOOLS.find((t) => t.name === name) as unknown as { propose: (s: Session, i: Record<string, unknown>) => Promise<Card> }).propose(s, input);

/** Sign a card the way the engine does, then confirm it. */
async function confirm(s: Session, card: Card) {
  const token = await new SignJWT({ action: card.action, title: card.title, uid: s.userId, org: s.orgId, fac: s.facilityId })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(crypto.randomUUID().replace(/-/g, ""))
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(`assistant:${process.env.AUTH_SECRET}`));
  return { token, ...(await confirmProposal(s, token)) };
}
async function undo(s: Session, changeId: string) {
  const card = await propose("undo_tally_change", s, { change: changeId });
  return { card, ...(await confirm(s, card)) };
}

describe.skipIf(!hasDb)("Tally: create from plain English, multi-step jobs, and undo (database)", () => {
  let actor: Actor;
  let owner: Session;
  const as = (role: Role): Session => ({ ...owner, role, permissions: permissionsFor(role), roleName: role, customRoleId: null });
  let vault: string;
  let room: string;

  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Tally ${run}` }).returning();
    const [fac] = await db.insert(facilities).values({ orgId: org.id, name: "Mesa", licenseNumber: `${run}-F`, licenseType: "CULTIVATION", state: "NM" }).returning();
    const [u] = await db.insert(users).values({ orgId: org.id, name: "Tess Tally", email: `t-${run}@t.invalid`, passwordHash: "x", role: "OWNER" }).returning();
    actor = { userId: u.id, userName: u.name, orgId: org.id, facilityId: fac.id };
    owner = { userId: u.id, orgId: org.id, facilityId: fac.id, name: u.name, role: "OWNER", permissions: permissionsFor("OWNER"), roleName: "Owner", customRoleId: null };
    const [v, r] = await db
      .insert(locations)
      .values([
        { orgId: org.id, facilityId: fac.id, name: "Vault A", type: "ROOM" },
        { orgId: org.id, facilityId: fac.id, name: "Dry Room", type: "ROOM" },
      ])
      .returning();
    vault = v.id;
    room = r.id;
    const [cat] = await db.insert(itemCategories).values({ orgId: org.id, name: "Stuff" }).returning();
    await db.insert(items).values([
      { orgId: org.id, name: "Blue Dream 3.5g Jar", sku: `${run}-BD`, categoryId: cat.id, unit: "EACH" },
      { orgId: org.id, name: "Gummy 10pk", sku: `${run}-GUM`, categoryId: cat.id, unit: "EACH" },
      { orgId: org.id, name: "Distillate", sku: `${run}-DIS`, categoryId: cat.id, unit: "G" },
      { orgId: org.id, name: "Gummy Base", sku: `${run}-BASE`, categoryId: cat.id, unit: "EACH" },
      { orgId: org.id, name: "Bulk Flower", sku: `${run}-BF`, categoryId: cat.id, unit: "G" },
    ]);
    const exp = addDays(todayIn(), 200);
    await createCustomer(actor, { name: "Green Valley Farms", licenseNumber: `${run}-GV`, licenseType: "Producer", licenseExpires: exp, weBuyFrom: true, weSellTo: false });
    const shop = await createCustomer(actor, { name: "Dispensary X", licenseNumber: `${run}-DX`, licenseType: "Retailer", licenseExpires: exp });
    const list = await createPriceList(actor, { name: "Wholesale" });
    const itemId = async (sku: string) => (await db.select().from(items).where(eq(items.sku, `${run}-${sku}`)))[0].id;
    await setPrice(actor, { priceListId: list.id, itemId: await itemId("BD"), price: "12.50" });
    void shop;
    await createRecipe(actor, {
      name: "Gummies 10pk",
      outputItemId: await itemId("GUM"),
      outputQuantity: "100",
      lines: [
        { itemId: await itemId("DIS"), quantity: "50" },
        { itemId: await itemId("BASE"), quantity: "100" },
      ],
    });
  });
  afterAll(() => pool.end());

  it("only offers the new tools to roles that could do the same on screen", () => {
    const names = (r: Role) => toolsFor(as(r)).map((t) => t.name);
    expect(names("OWNER")).toEqual(expect.arrayContaining(["receive_packages", "create_wholesale_order", "start_production_run", "close_out_harvest", "run_job", "undo_tally_change"]));
    expect(names("READ_ONLY")).not.toContain("receive_packages");
    expect(names("BUDTENDER")).not.toContain("close_out_harvest");
  });

  it("receives 12 packages from plain English, checks the whole plan first, saves once, and undoes in one go", async () => {
    const input = { vendor: "green valley", location: "vault a", packages: [{ item: "Blue Dream", quantity: "40", first_tag: `${run}-P0001`, count: 12 }], expected_count: 12 };
    await expect(propose("receive_packages", owner, { ...input, expected_count: 11 })).rejects.toThrow(/said 11 packages, but the tags given make 12/);
    await expect(propose("receive_packages", owner, { ...input, packages: [{ item: "Blue Dream", quantity: "40" }] })).rejects.toThrow(/needs its own state tag/);

    const card = await propose("receive_packages", owner, input);
    expect(card.title).toBe("Receive 12 packages");
    expect(card.steps).toHaveLength(12);
    expect(card.steps![11]).toContain(`${run}-P0012`);
    expect(card.details).toEqual(expect.arrayContaining([{ label: "From", value: "Green Valley Farms" }, { label: "Blue Dream 3.5g Jar", value: "480 ea" }]));
    // The plan was run and rolled back: nothing exists yet, and no state report was queued.
    expect(await db.$count(packages, eq(packages.orgId, actor.orgId))).toBe(0);
    expect(await db.$count(syncEvents, eq(syncEvents.orgId, actor.orgId))).toBe(0);

    const done = await confirm(owner, card);
    expect(done.message).toBe("Received 12 packages.");
    expect(done.undoable).toBe(true);
    expect(await db.$count(packages, and(eq(packages.orgId, actor.orgId), eq(packages.status, "ACTIVE")))).toBe(12);
    // Confirming the same card again (double click, retry) does nothing.
    const again = await confirmProposal(owner, done.token);
    expect(again.message).toMatch(/^Already done/);
    expect(await db.$count(packages, eq(packages.orgId, actor.orgId))).toBe(12);

    const before = await db.$count(auditLogs, eq(auditLogs.orgId, actor.orgId));
    const { card: undoCard, message } = await undo(owner, done.changeId!);
    expect(undoCard.steps).toHaveLength(12);
    expect(message).toMatch(/^Undone: Receive 12 packages. 12 steps reversed/);
    const left = await db.select().from(packages).where(eq(packages.orgId, actor.orgId));
    expect(left.every((p) => p.status === "FINISHED" && Number(p.quantity) === 0)).toBe(true);
    // Nothing was erased: 12 new reversing entries, each reported to the state as an entry-error adjustment.
    expect(await db.$count(auditLogs, eq(auditLogs.orgId, actor.orgId))).toBe(before + 12);
    expect(await db.$count(syncEvents, and(eq(syncEvents.orgId, actor.orgId), eq(syncEvents.type, "PACKAGE_ADJUSTED")))).toBe(12);
    await expect(propose("undo_tally_change", owner, { change: done.changeId })).rejects.toThrow(/already undone/);
  });

  it("is all or nothing: a bad step stops the plan before the card, naming the step", async () => {
    await db.insert(packages).values({ orgId: actor.orgId, facilityId: actor.facilityId, tag: `${run}-TAKEN`, itemId: (await db.select().from(items).where(eq(items.sku, `${run}-BD`)))[0].id, quantity: "1", unit: "EACH", locationId: vault });
    await expect(
      propose("receive_packages", owner, { location: "Vault A", packages: [{ item: "Blue Dream", quantity: "1", tags: [`${run}-NEW1`, `${run}-TAKEN`] }] }),
    ).rejects.toThrow(/Step 2 \(Receive .*TAKEN.*\): Tag .* is already in use/);
    expect(await db.$count(packages, eq(packages.tag, `${run}-NEW1`))).toBe(0);
  });

  it("refuses to undo once something it touched was changed again by someone else", async () => {
    const done = await confirm(owner, await propose("receive_packages", owner, { location: "Vault A", packages: [{ item: "Blue Dream", quantity: "5", tag: `${run}-LATER` }] }));
    const [pkg] = await db.select().from(packages).where(eq(packages.tag, `${run}-LATER`));
    await new Promise((r) => setTimeout(r, 5));
    await movePackage({ ...actor, userName: "Jo Floor" }, { packageId: pkg.id, toLocationId: room });
    await expect(propose("undo_tally_change", owner, { change: done.changeId })).rejects.toThrow(/has changed since \(move by Jo Floor/);
  });

  it("makes a wholesale order with price-list and typed prices, and Undo cancels it", async () => {
    const card = await propose("create_wholesale_order", owner, {
      vendor: "Dispensary X",
      lines: [
        { item: "Blue Dream", quantity: "50" },
        { item: "Gummy 10pk", quantity: "20", unit_price: "$8" },
      ],
    });
    expect(card.details).toEqual(expect.arrayContaining([{ label: "Total", value: "$785.00" }, { label: "Status after", value: "Draft" }]));
    await expect(propose("create_wholesale_order", owner, { vendor: "Dispensary X", lines: [{ item: "Gummy 10pk", quantity: "1" }] })).rejects.toThrow(/not on this customer's price list/);
    await expect(propose("create_wholesale_order", owner, { vendor: "Green Valley", lines: [{ item: "Gummy 10pk", quantity: "1", unit_price: "1" }] })).rejects.toThrow(/isn't marked as a vendor you sell to/);
    const done = await confirm(owner, card);
    expect(done.message).toMatch(/^Order SO-\d{5} created/);
    const [order] = await db.select().from(orders).where(eq(orders.orgId, actor.orgId));
    expect(order.status).toBe("DRAFT");
    await undo(owner, done.changeId!);
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0].status).toBe("CANCELLED");
  });

  it("starts a run of 200 gummy packs, picking inputs oldest first; Undo puts the product back and cancels the run", async () => {
    const id = async (sku: string) => (await db.select().from(items).where(eq(items.sku, `${run}-${sku}`)))[0].id;
    await expect(propose("start_production_run", owner, { product: "gummy 10pk", quantity: "200" })).rejects.toThrow(/^Not enough active stock(?=.*Distillate: short 100 g)(?=.*Gummy Base: short 200 ea)/);
    await confirm(
      owner,
      await propose("receive_packages", owner, {
        location: "Vault A",
        packages: [
          { item: "Distillate", quantity: "60", tags: [`${run}-D1`, `${run}-D2`] },
          { item: "Gummy Base", quantity: "500", tag: `${run}-B1` },
        ],
      }),
    );
    const card = await propose("start_production_run", owner, { product: "gummy 10pk", quantity: "200" });
    expect(card.details).toEqual(expect.arrayContaining([{ label: "Makes", value: "200 ea Gummy 10pk (planned)" }]));
    expect(card.steps).toEqual([
      expect.stringMatching(/^Start run RUN-\d{6}: 2 batches of Gummies 10pk$/),
      `Use 60 g from ${run}-D1 (Distillate)`,
      `Use 40 g from ${run}-D2 (Distillate)`,
      `Use 200 ea from ${run}-B1 (Gummy Base)`,
    ]);
    const done = await confirm(owner, card);
    const qtyOf = async (tag: string) => Number((await db.select().from(packages).where(eq(packages.tag, tag)))[0].quantity);
    expect([await qtyOf(`${run}-D1`), await qtyOf(`${run}-D2`), await qtyOf(`${run}-B1`)]).toEqual([0, 20, 300]);
    await undo(owner, done.changeId!);
    expect([await qtyOf(`${run}-D1`), await qtyOf(`${run}-D2`), await qtyOf(`${run}-B1`)]).toEqual([60, 60, 500]);
    expect((await db.select().from(packages).where(eq(packages.tag, `${run}-D1`)))[0].status).toBe("ACTIVE");
    const [r] = await db.select().from(productionRuns).where(eq(productionRuns.orgId, actor.orgId));
    expect(r.status).toBe("CANCELLED");
    // A test id, not just three package ids: the needs map and the input picks agree.
    void id;
  });

  it("closes out a harvest in one go (weigh, package, waste, finish) and undoes the whole thing", async () => {
    const [strain] = await db.insert(strains).values({ orgId: actor.orgId, name: "Mesa Haze", type: "SATIVA" }).returning();
    const [h] = await db
      .insert(harvests)
      .values({ orgId: actor.orgId, facilityId: actor.facilityId, name: `MH-${run}`, strainId: strain.id, locationId: room, plantCount: 10, wetWeight: "5000", userId: actor.userId })
      .returning();
    const base = { harvest: `MH-${run}`, dry_weight: "1200", packages: [{ item: "Bulk Flower", quantity: "450", first_tag: `${run}-H01`, count: 2 }], waste: [{ weight: "150", reason: "stems" }], labels: false };
    await expect(propose("close_out_harvest", owner, base)).rejects.toThrow(/150 g of MH-.* would be unaccounted for/);
    await expect(propose("close_out_harvest", owner, { ...base, dry_weight: "1000" })).rejects.toThrow(/That's 50 g more than the harvest has/);

    const card = await propose("close_out_harvest", owner, { ...base, rest_is_waste: "trim" });
    expect(card.steps).toEqual([
      "Record dry weight 1,200 g",
      `Package 450 g Bulk Flower as ${run}-H01`,
      `Package 450 g Bulk Flower as ${run}-H02`,
      "Log 150 g waste: stems",
      "Log the remaining 150 g as waste: trim",
      `Finish harvest MH-${run}`,
    ]);
    expect(card.details).toEqual(expect.arrayContaining([{ label: "Waste", value: "300 g" }, { label: "Left over", value: "0 g" }]));
    expect((await db.select().from(harvests).where(eq(harvests.id, h.id)))[0].dryWeight).toBeNull();

    const done = await confirm(owner, card);
    expect(done.message).toMatch(/^Harvest closed out. Logged the remaining 150 g as waste/);
    const closed = (await db.select().from(harvests).where(eq(harvests.id, h.id)))[0];
    expect(closed).toMatchObject({ status: "FINISHED" });
    expect([Number(closed.dryWeight), Number(closed.packagedWeight), Number(closed.wasteWeight)]).toEqual([1200, 900, 300]);

    const { card: undoCard } = await undo(owner, done.changeId!);
    expect(undoCard.steps![0]).toBe("Reopen the harvest");
    const reopened = (await db.select().from(harvests).where(eq(harvests.id, h.id)))[0];
    expect(reopened.status).toBe("DRYING");
    expect([reopened.dryWeight, Number(reopened.packagedWeight), Number(reopened.wasteWeight)]).toEqual([null, 0, 0]);
    const made = await db.select().from(packages).where(inArray(packages.tag, [`${run}-H01`, `${run}-H02`]));
    expect(made.every((p) => p.status === "FINISHED" && Number(p.quantity) === 0)).toBe(true);
    // The waste log keeps both the waste and its reversal.
    const logs = await db.select().from(wasteLogs).where(eq(wasteLogs.sourceId, h.id));
    expect(logs.map((l) => Number(l.weightGrams)).sort((a, b) => a - b)).toEqual([-150, -150, 150, 150]);
    expect(await db.$count(syncEvents, and(eq(syncEvents.orgId, actor.orgId), eq(syncEvents.type, "HARVEST_UNFINISHED")))).toBe(1);
  });

  it("prepares labels as part of a close-out when a template exists, without letting a label problem stop the job", async () => {
    const [strain] = await db.insert(strains).values({ orgId: actor.orgId, name: `Label Kush ${run}`, type: "INDICA" }).returning();
    await db.insert(harvests).values({ orgId: actor.orgId, facilityId: actor.facilityId, name: `LK-${run}`, strainId: strain.id, locationId: room, plantCount: 2, wetWeight: "1000", userId: actor.userId });
    const input = { harvest: `LK-${run}`, dry_weight: "200", packages: [{ item: "Bulk Flower", quantity: "200", tag: `${run}-L01` }] };
    const noTemplate = await propose("close_out_harvest", owner, input);
    expect(noTemplate.details).toContainEqual({ label: "Labels", value: expect.stringMatching(/^Skipped: no package label template/) });
    await ensureStarterTemplates(actor, "NM");
    const card = await propose("close_out_harvest", owner, input);
    expect(card.steps!.at(-1)).toBe("Prepare 1 package label");
    const done = await confirm(owner, card);
    expect(done.message).toMatch(/^Harvest closed out\. (Print job ready: 1 label|Labels were not prepared)/);
    expect((await db.select().from(harvests).where(eq(harvests.name, `LK-${run}`)))[0].status).toBe("FINISHED");
    const jobs = await db.select().from(printJobs).where(eq(printJobs.orgId, actor.orgId));
    if (done.message.includes("Print job ready")) {
      expect(jobs).toHaveLength(1);
      await undo(owner, done.changeId!);
      expect((await db.select().from(printJobs).where(eq(printJobs.id, jobs[0].id)))[0].status).toBe("CANCELLED");
    } else expect(jobs.filter((j) => j.status === "QUEUED")).toHaveLength(0);
  });

  it("runs a custom job and can undo older single-step Tally actions too", async () => {
    const tags = [`${run}-J1`, `${run}-J2`];
    await confirm(owner, await propose("receive_packages", owner, { location: "Vault A", packages: [{ item: "Blue Dream", quantity: "10", tags }] }));
    const card = await propose("run_job", owner, {
      title: "Hold for retest",
      steps: [
        { action: "move", tags, to_location: "Dry Room" },
        { action: "hold", tag: tags[0], reason: "retest" },
        { action: "adjust", tag: tags[1], new_quantity: "9", reason_code: "DAMAGE" },
      ],
    });
    expect(card.steps).toHaveLength(4);
    await expect(propose("run_job", as("INVENTORY"), { steps: [{ action: "hold", tag: tags[0] }] })).rejects.toThrow(/Say why/);
    const done = await confirm(owner, card);
    const get = async (t: string) => (await db.select().from(packages).where(eq(packages.tag, t)))[0];
    expect(await get(tags[0])).toMatchObject({ status: "ON_HOLD", locationId: room });
    await undo(owner, "last");
    expect(await get(tags[0])).toMatchObject({ status: "ACTIVE", locationId: vault });
    expect(Number((await get(tags[1])).quantity)).toBe(10);
    const [row] = await db.select().from(tallyChanges).where(eq(tallyChanges.id, done.changeId!));
    expect(row.status).toBe("UNDONE");

    // An existing single action (adjust to zero) is undoable as well, refilling the package.
    const zero = await confirm(owner, await propose("adjust_package", owner, { tag: tags[1], new_quantity: "0", reason_code: "ENTRY_ERROR" }));
    expect((await get(tags[1])).status).toBe("FINISHED");
    await undo(owner, zero.changeId!);
    expect(await get(tags[1])).toMatchObject({ status: "ACTIVE" });
    expect(Number((await get(tags[1])).quantity)).toBe(10);
  });
});
