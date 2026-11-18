import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs, facilities, itemCategories, items, locations, organizations, packages, syncEvents, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import type { Actor } from "@/lib/inventory";
import { receiveShipment } from "@/lib/shipments";
import { parseManifest, reviewShipment } from "@/lib/shipments-parse";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `SH${Date.now().toString(36).toUpperCase()}`;

const manifest = (prefix: string) => [
  ["Manifest 0001234", "", ""],
  ["Package Tag", "Item Name", "Quantity", "Lot"],
  [`${prefix}-A`, "Blue Mesa 3.5 g Jar", "100", "BM-1"],
  [`${prefix}-B`, "Blue Mesa 3.5 g Jar", "50", "BM-1"],
  [`${prefix}-C`, "Desert Haze Pre-roll", "200", "DH-2"],
];

describe("reading a manifest and comparing it with what arrived", () => {
  it("reads tags, products, quantities, and lots", () => {
    const { lines, problems } = parseManifest(manifest("T"));
    expect(problems).toEqual([]);
    expect(lines.map((l) => [l.tag, l.product, l.quantity, l.lot])).toEqual([
      ["T-A", "Blue Mesa 3.5 g Jar", "100", "BM-1"],
      ["T-B", "Blue Mesa 3.5 g Jar", "50", "BM-1"],
      ["T-C", "Desert Haze Pre-roll", "200", "DH-2"],
    ]);
  });
  it("refuses a tag listed twice, a missing tag, and a quantity that isn't positive", () => {
    const { problems } = parseManifest([
      ["Package Tag", "Item Name", "Quantity"],
      ["X-1", "Jar", "5"],
      ["X-1", "Jar", "5"],
      ["", "Jar", "5"],
      ["X-2", "Jar", "0"],
    ]);
    expect(problems).toEqual([expect.stringMatching(/X-1 is on the manifest twice/), expect.stringMatching(/no package tag/), expect.stringMatching(/X-2.*above zero/)]);
  });
  it("marks each line arrived, short, or missing, needs a reason for every difference, and refuses more than listed", () => {
    const { lines } = parseManifest(manifest("T"));
    const noReasons = reviewShipment(lines, { "T-B": { quantity: "45" }, "T-C": { quantity: "0" } });
    expect(noReasons.lines.map((l) => l.status)).toEqual(["MATCH", "SHORT", "MISSING"]);
    expect(noReasons.problems).toEqual([expect.stringMatching(/T-B: 45 of 50 arrived\. Say why/), expect.stringMatching(/T-C: didn't arrive\. Say why/)]);
    const ok = reviewShipment(lines, { "T-B": { quantity: "45", reason: "5 jars crushed" }, "T-C": { quantity: "0", reason: "Not on the truck" } });
    expect(ok.problems).toEqual([]);
    expect(reviewShipment(lines, { "T-A": { quantity: "101" } }).problems[0]).toMatch(/101 arrived but the manifest lists 100/);
    expect(reviewShipment(lines, { "T-A": { quantity: "lots" } }).problems[0]).toMatch(/isn't a quantity/);
  });
});

describe.skipIf(!hasDb)("receiving a shipment (database)", () => {
  let actor: Actor;
  let room: string;
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Shipments ${run}` }).returning();
    const [facility] = await db
      .insert(facilities)
      .values({ orgId: org.id, name: "Store", licenseNumber: run, licenseType: "RETAIL", state: "NM", trackTraceSystem: "METRC" })
      .returning();
    const [user] = await db.insert(users).values({ orgId: org.id, name: "Dana", email: `${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "OWNER" }).returning();
    actor = { orgId: org.id, facilityId: facility.id, userId: user.id, userName: user.name };
    const [loc] = await db.insert(locations).values({ orgId: org.id, facilityId: facility.id, name: "Receiving", type: "ROOM" }).returning();
    room = loc.id;
    const [cat] = await db.insert(itemCategories).values({ orgId: org.id, name: "Flower" }).returning();
    await db.insert(items).values([
      { orgId: org.id, name: "Blue Mesa 3.5 g Jar", sku: `BM-${run}`, categoryId: cat.id, unit: "EACH" },
      { orgId: org.id, name: "Desert Haze Pre-roll", sku: `DH-${run}`, categoryId: cat.id, unit: "EACH" },
    ]);
  });
  afterAll(() => pool.end());

  const counted = { [`${run}-B`]: { quantity: "45", reason: "5 jars crushed" }, [`${run}-C`]: { quantity: "0", reason: "Not on the truck" } };

  it("checks without saving, and names products that aren't in CannaTrace", async () => {
    const table = [...manifest(run), [`${run}-D`, "Mystery Tincture", "10", ""]];
    const check = await receiveShipment(actor, { manifestNumber: "M-1", table, locationId: room, received: counted, commit: false });
    expect(check.problems).toEqual([expect.stringMatching(/1 product isn't in CannaTrace yet \(Mystery Tincture\)/)]);
    expect(await db.$count(packages, eq(packages.facilityId, actor.facilityId))).toBe(0);
  });

  it("receives what arrived in one go, records every difference, and queues one state record for the manifest", async () => {
    const result = await receiveShipment(actor, { manifestNumber: "m-1", table: manifest(run), locationId: room, received: counted, commit: true });
    expect(result).toMatchObject({ received: true, manifestNumber: "M-1", accepted: 2, short: 1, rejected: 1 });
    const got = await db.select().from(packages).where(eq(packages.facilityId, actor.facilityId));
    expect(Object.fromEntries(got.map((p) => [p.tag, Number(p.quantity)]))).toEqual({ [`${run}-A`]: 100, [`${run}-B`]: 45 });

    // The state hears about the shipment once, with what was short or didn't arrive; not package by package
    const queued = await db.select().from(syncEvents).where(eq(syncEvents.facilityId, actor.facilityId));
    expect(queued.map((e) => e.type)).toEqual(["TRANSFER_RECEIVED"]);
    expect(queued[0].summary).toBe("Accept manifest M-1: 2 packages received, 1 short, 1 rejected");

    // The audit trail has each package and the shipment, expected against received, with the reasons
    const [shipment] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.facilityId, actor.facilityId), eq(auditLogs.entityType, "Shipment")));
    expect(shipment.after).toMatchObject({
      manifestNumber: "M-1",
      accepted: 2,
      lines: [
        { tag: `${run}-A`, expected: "100", received: "100", status: "MATCH" },
        { tag: `${run}-B`, expected: "50", received: "45", status: "SHORT", reason: "5 jars crushed" },
        { tag: `${run}-C`, expected: "200", received: "0", status: "MISSING", reason: "Not on the truck" },
      ],
    });
    expect(await db.$count(auditLogs, and(eq(auditLogs.facilityId, actor.facilityId), eq(auditLogs.action, "RECEIVE_SHIPMENT")))).toBe(2);
  });

  it("won't receive the same manifest twice, even when two people press Receive at once", async () => {
    const again = await receiveShipment(actor, { manifestNumber: "M-1", table: manifest(`${run}X`), locationId: room, received: {}, commit: false });
    expect(again.problems[0]).toMatch(/Manifest M-1 was already received/);
    const both = await Promise.allSettled([
      receiveShipment(actor, { manifestNumber: "M-2", table: manifest(`${run}Y`), locationId: room, received: {}, commit: true }),
      receiveShipment(actor, { manifestNumber: "M-2", table: manifest(`${run}Y`), locationId: room, received: {}, commit: true }),
    ]);
    expect(both.filter((b) => b.status === "fulfilled" && b.value.received)).toHaveLength(1);
    expect(await db.$count(packages, and(eq(packages.facilityId, actor.facilityId), eq(packages.lotNumber, "DH-2")))).toBe(1);
  });

  it("refuses tags that are already in CannaTrace and saves nothing", async () => {
    const before = await db.$count(packages, eq(packages.facilityId, actor.facilityId));
    const reuse = await receiveShipment(actor, { manifestNumber: "M-3", table: manifest(run), locationId: room, received: counted, commit: true });
    expect(reuse.received).toBe(false);
    expect(reuse.problems).toEqual([expect.stringMatching(/-A is already in CannaTrace/), expect.stringMatching(/-B is already in CannaTrace/)]);
    expect(await db.$count(packages, eq(packages.facilityId, actor.facilityId))).toBe(before);
  });
});
