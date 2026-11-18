import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { facilities, itemCategories, items, labResults, locations, organizations, packages, users } from "@/db/schema";
import { parseCsv } from "@/lib/csv";
import { db, pool } from "@/lib/db";
import { amountWithUnit, planDutchie, planImport, unitFor, findHeader, sizeInName } from "@/lib/importers/dutchie-parse";
import { importDutchie, importInventory, previewDutchie, readReport } from "@/lib/importers/dutchie";
import type { Actor } from "@/lib/inventory";
import Decimal from "decimal.js";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `DT${Date.now().toString(36).toUpperCase()}`;
const report = () => parseCsv(readFileSync("tests/fixtures/dutchie-current-inventory.csv", "utf8"));

describe("reading a Dutchie inventory report", () => {
  it("skips the title lines and finds the header", () => {
    expect(findHeader(report())).toBe(2);
  });
  it("maps Dutchie's columns and prefers the state tag over Dutchie's own package ID", () => {
    const plan = planDutchie(report());
    expect(plan.problems).toEqual([]);
    expect(plan.matched).toMatchObject({ product: "Product Name", tag: "Package ID", externalTag: "External Package ID", batch: "Batch Number", room: "Inventory Location", quantity: "Quantity", thc: "THC %" });
    expect(plan.rows).toHaveLength(4); // the empty pre-roll package and the totals line are left out
    expect(plan.rows[0]).toMatchObject({ product: "Blue Dream 3.5g", tag: "1A40E0100000A1B000000101", lot: "BD-1104", room: "Sales Floor", quantity: "24", unit: "EACH", unitWeightGrams: "3.5", cost: "12.5", thc: "24.1" });
    expect(plan.rows[2]).toMatchObject({ product: "Bulk Blue Dream", tag: "DTC-0003", unit: "G", unitWeightGrams: null });
    expect(plan.rows[3]).toMatchObject({ product: "Prickly Pear Gummies 100mg", sku: "PPG-100", unit: "EACH", thc: null });
    expect(plan.warnings.join(" ")).toMatch(/quantity 0/);
    expect(plan.warnings.join(" ")).toMatch(/pending lab results/);
  });
  it("tells bulk weight from counted units", () => {
    expect(unitFor("", new Decimal(10), new Decimal(35))).toEqual({ unit: "EACH", unitWeightGrams: "3.5" });
    expect(unitFor("", new Decimal(453.6), new Decimal(453.6))).toEqual({ unit: "G", unitWeightGrams: null });
    expect(unitFor("g", new Decimal(10), null)).toEqual({ unit: "G", unitWeightGrams: null });
    expect(unitFor("", new Decimal(10), null)).toEqual({ unit: "EACH", unitWeightGrams: null });
  });
  it("reads the package size from the product name, so one-gram items aren't mistaken for bulk grams", () => {
    expect(unitFor("", new Decimal(36), new Decimal(36), "Desert Haze 1g Pre-Roll")).toEqual({ unit: "EACH", unitWeightGrams: "1" });
    expect(unitFor("", new Decimal(10), new Decimal(10), "Live Resin 1 g")).toEqual({ unit: "EACH", unitWeightGrams: "1" });
    expect(unitFor("", new Decimal(500), new Decimal(500), "Bulk Blue Dream 1g smalls")).toEqual({ unit: "G", unitWeightGrams: null });
    expect(sizeInName("Blue Dream 3.5g")?.toString()).toBe("3.5");
    expect(sizeInName("House Flower 1oz")?.toString()).toBe("28.35");
    expect(sizeInName("Prickly Pear Gummies 100mg")).toBeNull();
  });
  it("skips the totals line without a warning", () => {
    const plan = planDutchie(report());
    expect(plan.warnings.join(" ")).not.toMatch(/no product name/);
  });
  it("refuses a file that isn't an inventory report", () => {
    expect(planDutchie([["Date", "Total sales"], ["2026-11-01", "1200"]]).problems[0]).toMatch(/doesn't look like a Dutchie inventory report/);
  });
  it("reads the same report from an Excel file", async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Current Inventory");
    for (const row of report()) sheet.addRow(row.map((c) => (/^\d+(\.\d+)?$/.test(c) ? Number(c) : c)));
    const bytes = Buffer.from(await book.xlsx.writeBuffer());
    const table = await readReport("current-inventory.xlsx", bytes);
    expect(planDutchie(table).rows.map((r) => r.quantity)).toEqual(["24", "60", "453.6", "40"]);
  });
});

const flourish = () => parseCsv(readFileSync("tests/fixtures/flourish-all-packages.csv", "utf8"));

describe("reading a Flourish package export", () => {
  it("maps Flourish's columns: Item Name, Metrc Tag over Package ID, Lot, Area, UOM, and Unit Weight", () => {
    const plan = planImport("flourish", flourish());
    expect(plan.problems).toEqual([]);
    expect(plan.matched).toMatchObject({ product: "Item Name", tag: "Package ID", externalTag: "Metrc Tag", batch: "Lot", room: "Area", quantity: "Quantity", unit: "UOM", unitWeight: "Unit Weight" });
    expect(plan.rows).toHaveLength(5); // the empty package is left out
    expect(plan.rows[0]).toMatchObject({ product: "Blue Dream 3.5g Jar", tag: "NM0000000000000000000201", lot: "BD-1104", room: "Finished Goods Vault", unit: "EACH", unitWeightGrams: "3.5", cost: "12.5" });
    expect(plan.rows[2]).toMatchObject({ product: "Blue Dream Bulk Flower", unit: "G", quantity: "2268" });
    expect(plan.rows[3]).toMatchObject({ tag: "20261020-007", unit: "EACH", unitWeightGrams: null });
  });
  it("doesn't give packaging a product weight from its name", () => {
    const row = planImport("flourish", flourish()).rows.find((r) => r.product === "Empty 3.5g Jar")!;
    expect(row).toMatchObject({ unit: "EACH", unitWeightGrams: null });
  });
  it("says plainly when a file isn't a Flourish export", () => {
    expect(planImport("flourish", [["Date", "Sales"]]).problems[0]).toMatch(/Flourish package export/);
  });
});

const nms2s = () => parseCsv(readFileSync("tests/fixtures/nms2s-inventory-room.csv", "utf8"));

describe("reading an NMS2S inventory list", () => {
  it("maps the state system's columns: ID, Product Type, Strain Name, Total Cannabis Weight, Unit/Package Count", () => {
    const plan = planImport("nms2s", nms2s());
    expect(plan.problems).toEqual([]);
    expect(plan.matched).toMatchObject({ tag: "ID", category: "Product Type", product: "Product Name", strain: "Strain Name", grams: "Total Cannabis Weight", quantity: "Unit/Package Count", unitWeight: "Amount Per Unit/Package", thc: "Total THC", destroy: "Scheduled for Destruction?" });
    expect(plan.rows.map((r) => r.tag)).toEqual(["8831545407777526", "7227263414909548", "3269770487120449", "1651860785356584", "2537511780714947"]);
  });
  it("reads bulk weight with its unit, and packaged rows by count and amount per unit", () => {
    const rows = planImport("nms2s", nms2s()).rows;
    expect(rows[0]).toMatchObject({ product: "GeoForce", category: "Dry Flower", quantity: "440", unit: "G", unitWeightGrams: null, thc: "21.4", room: "Imported from NMS2S" });
    expect(rows[1]).toMatchObject({ product: "Green Chile OG 3.5g Jar", quantity: "20", unit: "EACH", unitWeightGrams: "3.5", thc: "22.8" });
    // An edible's 100 mg is its dose, not a weight or a percent
    expect(rows[4]).toMatchObject({ product: "Prickly Pear Gummies 10pk", quantity: "12", unit: "EACH", unitWeightGrams: null, thc: null });
  });
  it("names a product from its strain and type when NMS2S has no product name", () => {
    expect(planImport("nms2s", nms2s()).rows[2].product).toBe("GG#1 Infused Cannabis Material (Concentrate CO2) Unpackaged");
  });
  it("leaves out empty packages and ones scheduled for destruction, and says so", () => {
    const w = planImport("nms2s", nms2s()).warnings.join(" ");
    expect(w).toMatch(/1 package has nothing left/);
    expect(w).toMatch(/1 package is scheduled for destruction/);
  });
  it("catches IDs Excel turned into scientific notation", () => {
    const table = nms2s().slice(0, 2);
    table[1][0] = "8.83155E+15";
    expect(planImport("nms2s", table).problems[0]).toMatch(/scientific notation/);
  });
  it("reads amounts written with units", () => {
    expect(amountWithUnit("500.00 g")).toMatchObject({ unit: "G" });
    expect(amountWithUnit("1.2 kg")?.unit).toBe("KG");
    expect(amountWithUnit("20")).toMatchObject({ unit: null });
    expect(amountWithUnit("lots")).toBeNull();
  });
  it("says plainly when a file isn't an NMS2S list", () => {
    expect(planImport("nms2s", [["Date", "Sales"]]).problems[0]).toMatch(/NMS2S inventory list/);
  });
});

describe.skipIf(!hasDb)("importing a Dutchie report (database)", () => {
  let actor: Actor;
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Dutchie switch ${run}` }).returning();
    const [facility] = await db.insert(facilities).values({ orgId: org.id, name: "Store", licenseNumber: run, licenseType: "RETAIL", state: "NM" }).returning();
    const [user] = await db.insert(users).values({ orgId: org.id, name: "Carly", email: `${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "OWNER" }).returning();
    actor = { orgId: org.id, facilityId: facility.id, userId: user.id, userName: user.name };
    // The store already has a Sales Floor and one of the products
    await db.insert(locations).values({ orgId: org.id, facilityId: facility.id, name: "Sales Floor", type: "ROOM" });
    const [cat] = await db.insert(itemCategories).values({ orgId: org.id, name: "Edibles" }).returning();
    await db.insert(items).values({ orgId: org.id, name: "Prickly Pear Gummies 100mg", sku: "PPG-100", categoryId: cat.id, unit: "EACH" });
  });
  afterAll(() => pool.end());

  it("previews exactly what will come in without saving anything", async () => {
    const preview = await previewDutchie(actor, report());
    expect(preview).toMatchObject({ problems: [], packages: 4, products: { created: 2, reused: 1 }, rooms: { created: 1, reused: 1 }, labResults: 3 });
    expect(await db.$count(packages, eq(packages.orgId, actor.orgId))).toBe(0);
    expect(await db.$count(locations, eq(locations.facilityId, actor.facilityId))).toBe(1);
  });

  it("imports products, rooms, packages with their state tags and batches, and pending lab results", async () => {
    const result = await importDutchie(actor, report());
    expect(result.packages).toBe(4);
    const pkgs = await db.select({ tag: packages.tag, lot: packages.lotNumber, qty: packages.quantity, unit: packages.unit, cost: packages.costPerUnit }).from(packages).where(eq(packages.orgId, actor.orgId));
    expect(pkgs.map((p) => p.tag).sort()).toEqual(["1A40E0100000A1B000000101", "1A40E0100000A1B000000102", "DTC-0003", "DTC-0004"]);
    expect(pkgs.find((p) => p.tag === "DTC-0003")).toMatchObject({ lot: "BD-1104", qty: "453.6000", unit: "G", cost: "1.1000" });
    const [jar] = await db.select().from(items).where(and(eq(items.orgId, actor.orgId), eq(items.name, "Blue Dream 3.5g")));
    expect(jar).toMatchObject({ sku: "BD-35", unit: "EACH", unitWeightGrams: "3.5000", strain: "Blue Dream" });
    const labs = await db.select().from(labResults).where(eq(labResults.orgId, actor.orgId));
    expect(labs).toHaveLength(3);
    expect(labs.every((l) => l.status === "PENDING" && l.thcPercent === "24.100")).toBe(true);
  });

  it("imports a Flourish export too, labelled as coming from Flourish", async () => {
    const result = await importInventory("flourish", actor, flourish());
    expect(result).toMatchObject({ packages: 5, rooms: { created: 3 } });
    const [jar] = await db.select().from(packages).where(and(eq(packages.orgId, actor.orgId), eq(packages.tag, "NM0000000000000000000201")));
    expect(jar).toMatchObject({ lotNumber: "BD-1104", quantity: "120.0000", unit: "EACH" });
    const [room] = await db.select().from(locations).where(and(eq(locations.facilityId, actor.facilityId), eq(locations.name, "Dry Room")));
    expect(room).toBeTruthy();
  });

  it("imports an NMS2S list with the 16-digit state IDs as package tags", async () => {
    const result = await importInventory("nms2s", actor, nms2s());
    expect(result).toMatchObject({ problems: [], packages: 5, labResults: 2 });
    const [flower] = await db.select().from(packages).where(and(eq(packages.orgId, actor.orgId), eq(packages.tag, "8831545407777526")));
    expect(flower).toMatchObject({ quantity: "440.0000", unit: "G" });
    const [room] = await db.select().from(locations).where(and(eq(locations.facilityId, actor.facilityId), eq(locations.name, "Imported from NMS2S")));
    expect(room).toBeTruthy();
  });

  it("saves nothing when a package is already in CannaTrace", async () => {
    const before = await db.$count(packages, eq(packages.orgId, actor.orgId));
    await expect(importDutchie(actor, report())).rejects.toThrow(/Nothing was imported[\s\S]*already in use/);
    expect(await db.$count(packages, eq(packages.orgId, actor.orgId))).toBe(before);
  });
});
