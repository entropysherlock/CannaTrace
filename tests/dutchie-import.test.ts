import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { facilities, itemCategories, items, labResults, locations, organizations, packages, users } from "@/db/schema";
import { parseCsv } from "@/lib/csv";
import { db, pool } from "@/lib/db";
import { planDutchie, unitFor, findHeader } from "@/lib/importers/dutchie-parse";
import { importDutchie, previewDutchie, readReport } from "@/lib/importers/dutchie";
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

  it("saves nothing when a package is already in CannaTrace", async () => {
    const before = await db.$count(packages, eq(packages.orgId, actor.orgId));
    await expect(importDutchie(actor, report())).rejects.toThrow(/Nothing was imported[\s\S]*already in use/);
    expect(await db.$count(packages, eq(packages.orgId, actor.orgId))).toBe(before);
  });
});
