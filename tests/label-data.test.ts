import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { facilities, itemCategories, items, locations, organizations, users } from "@/db/schema";
import { changePlantPhase, createPlantBatch, createStrain, harvestPlants, packageFromHarvest, recordDryWeight, tagPlants } from "@/lib/cultivation";
import { expandTags } from "@/lib/cultivation-math";
import { db, pool } from "@/lib/db";
import { addLabResult, splitPackage, type Actor } from "@/lib/inventory";
import { cleanItemDetails, saveItemDetails } from "@/lib/item-details";
import { loadLabelRecords } from "@/lib/labels/data";
import { starterTemplates } from "@/lib/labels/defaults";
import { fieldsFor, fill, placeholders, sampleValues } from "@/lib/labels/fields";
import { mg, mgInPackage, mgPerPackage, netQuantity, profileLine } from "@/lib/labels/quantities";
import type { LabelRecord } from "@/lib/labels/types";
import { checkJurisdiction, checkRecord, validateLabels } from "@/lib/labels/validate";
import { trim } from "@/lib/labels/quantities";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `LD${Date.now().toString(36).toUpperCase()}`;
const nm = (name: string) => starterTemplates("NM").find((t) => t.name.includes(name))!;

describe("label quantities", () => {
  it("prints net quantity in metric and U.S. units", () => {
    expect(netQuantity("3.5", "G", null)?.both).toBe("3.5 g (0.12 oz)");
    expect(netQuantity("1", "OZ", null)?.both).toBe("28.35 g (1 oz)");
    expect(netQuantity("2.5", "KG", null)?.both).toBe("2.5 kg (5.51 lb)");
    expect(netQuantity("500", "MG", null)?.both).toBe("500 mg (0.018 oz)");
    expect(netQuantity("30", "ML", null)?.both).toBe("30 mL (1.01 fl oz)");
  });
  it("needs the item's unit weight for items counted each", () => {
    expect(netQuantity("5", "EACH", null)).toBeNull();
    expect(netQuantity("5", "EACH", "1")?.both).toBe("5 g (0.18 oz)");
    expect(netQuantity("0", "G", null)).toBeNull();
  });
  it("prints <1 mg the way New Mexico allows", () => {
    expect(mg("0.4")).toBe("<1 mg");
    expect(mg("10")).toBe("10 mg");
    expect(mg("12.46")).toBe("12.5 mg");
    expect(mg("749.7")).toBe("750 mg");
    expect(mg(null)).toBeNull();
    // 20% of 3.5 g is 700 mg
    expect(trim(mgInPackage("20", netQuantity("3.5", "G", null)!.grams)!)).toBe("700");
    // Under 1 mg per serving: the container total is stated the same way ("<5 mg" for five servings).
    expect(mgPerPackage("0.5", 5, "1")).toBe("<5 mg");
    expect(mgPerPackage("10", 10, "2")).toBe("200 mg");
    expect(mgPerPackage("10", null, "1")).toBeNull();
  });
  it("builds a one-line cannabinoid profile from what the lab reported", () => {
    expect(profileLine([["THCa", "23.900"], ["CBD", null], ["CBG", "1.1"]])).toBe("THCa 23.9% · CBG 1.1%");
    expect(profileLine([["THCa", null]])).toBeNull();
  });
  it("accepts field names with digits, such as Δ9-THC", () => {
    expect(placeholders("{{lab.d9thc}}")).toEqual(["lab.d9thc"]);
    expect(fill("{{lab.d9thc}}", { "lab.d9thc": "0.4%" }).text).toBe("0.4%");
  });
  it("offers every field Carly asked for on product labels", () => {
    const keys = fieldsFor("PRODUCT").map((f) => f.key);
    for (const k of ["package.lot", "package.harvest", "package.tag", "lab.profile", "lab.thca", "item.name", "item.unitWeight", "item.strain", "package.netQuantity"]) expect(keys).toContain(k);
  });
});

describe("item label details", () => {
  it("checks numbers and requires servings with a per-serving dose", () => {
    expect(cleanItemDetails({ unitWeightGrams: "1", shelfLifeDays: "365", pesticides: "  None  " })).toMatchObject({ unitWeightGrams: "1.0000", shelfLifeDays: 365, pesticides: "None" });
    expect(() => cleanItemDetails({ thcMgPerServing: "10" })).toThrow(/servings per unit/);
    expect(() => cleanItemDetails({ servingsPerUnit: "2.5" })).toThrow(/whole number/);
    expect(() => cleanItemDetails({ unitWeightGrams: "-1" })).toThrow(/more than 0/);
  });
});

describe("New Mexico starter labels", () => {
  const record = (over: Record<string, string | null> = {}): LabelRecord => ({
    ref: "CT-1",
    sourceId: "p",
    values: { ...sampleValues("PRODUCT"), "_package.status": "ACTIVE", "_package.quantity": "3.5", "_lab.status": "PASS", ...over },
  });
  for (const name of ["flower", "edible"]) {
    it(`the ${name} label fits real-length data and passes every automatic rule except the logo upload`, () => {
      const t = nm(name);
      expect(t.design.heightMm).toBeCloseTo(101.6);
      // Sample values fill every field; a flower product has no per-serving dose, ingredients, or refrigeration.
      const flowerOnly = { "item.thcPerServing": null, "item.cbdPerServing": null, "item.refrigerate": null, "item.ingredients": null, "item.allergens": null, "item.solvents": null };
      const r = validateLabels(t.design, "PRODUCT", "NM", [record(name === "flower" ? flowerOnly : {})]);
      const blocks = r.issues.filter((i) => i.severity === "block").map((i) => i.code);
      expect(blocks).toEqual(["RULE_nm-logo_FILE"]);
      expect(r.issues.filter((i) => i.code === "OVERFLOW")).toEqual([]);
    });
  }
  it("blocks a flower template for a product that needs per-serving dose or refrigeration", () => {
    const r = validateLabels(nm("flower").design, "PRODUCT", "NM", [record({ "item.refrigerate": "Keep refrigerated.", "item.thcPerServing": "10 mg" })]);
    const codes = r.issues.filter((i) => i.severity === "block").map((i) => i.code);
    expect(codes).toContain("RULE_nm-refrigerate");
    expect(codes).toContain("RULE_nm-serving");
  });
  it("lets product-specific rules wait until print time when only the design is checked", () => {
    const r = checkJurisdiction(nm("flower").design, "PRODUCT", "NM");
    expect(r.issues.find((i) => i.code === "RULE_nm-refrigerate")?.message).toMatch(/Checked when you print/);
  });
  it("doesn't flag optional blanks (no allergens) but does flag a missing expiration date", () => {
    const issues = checkRecord(nm("edible").design, "PRODUCT", record({ "item.allergens": null, "package.expires": null }));
    const missing = issues.filter((i) => i.code === "MISSING").map((i) => i.message);
    expect(missing.some((m) => m.includes("Allergens"))).toBe(false);
    expect(missing.some((m) => m.includes("Expiration date"))).toBe(true);
  });
  it("still accepts a poison center number typed as plain text", () => {
    const t = nm("flower");
    const design = { ...t.design, elements: t.design.elements.map((e) => (e.text === "{{state.poisonCenter}}" ? { ...e, text: "Poison control 1-800-222-1222" } : e)) };
    expect(checkJurisdiction(design, "PRODUCT", "NM").issues.some((i) => i.code === "RULE_nm-poison")).toBe(false);
  });
});

describe.skipIf(!hasDb)("label data from real records (database)", () => {
  let actor: Actor;
  let jarItem: string;
  let child: string;
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Label Data ${run}` }).returning();
    const [facility] = await db.insert(facilities).values({ orgId: org.id, name: "Rio Grow", licenseNumber: `${run}-A`, licenseType: "CULTIVATION", state: "NM" }).returning();
    const [user] = await db.insert(users).values({ orgId: org.id, name: "Carly", email: `${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "OWNER" }).returning();
    const [room] = await db.insert(locations).values({ orgId: org.id, facilityId: facility.id, name: "Flower 1", type: "ROOM" }).returning();
    const [category] = await db.insert(itemCategories).values({ orgId: org.id, name: "Flower" }).returning();
    const [jar] = await db.insert(items).values({ orgId: org.id, name: "Alpha 3.5g", sku: `${run}-35`, categoryId: category.id, unit: "G", strain: "Alpha" }).returning();
    actor = { userId: user.id, userName: user.name, orgId: org.id, facilityId: facility.id };
    jarItem = jar.id;
    const strain = await createStrain(actor, { name: "Alpha", type: "HYBRID" });
    const batch = await createPlantBatch(actor, { name: `${run}-CLONES`, strainId: strain.id, source: "CLONE", count: "2", locationId: room.id });
    const tagged = await tagPlants(actor, { batchId: batch.id, tags: expandTags(`${run}-0001`, 2) });
    await changePlantPhase(actor, { plantIds: tagged.map((p) => p.id), phase: "FLOWERING" });
    const harvest = await harvestPlants(actor, { plantIds: tagged.map((p) => p.id), name: `${run}-H1`, wetWeight: "1000", unit: "G", locationId: room.id });
    await recordDryWeight(actor, { harvestId: harvest.id, dryWeight: "200", unit: "G" });
    const bulk = await packageFromHarvest(actor, { harvestId: harvest.id, tag: `${run}-BULK`, itemId: jarItem, quantity: "10", locationId: room.id });
    // A retail package split off the bulk: its harvest is found through the split.
    const { children } = await splitPackage(actor, { packageId: bulk.id, parts: [{ tag: `${run}-JAR1`, quantity: "3.5" }] });
    child = children[0].id;
    await saveItemDetails({ orgId: org.id, userId: user.id, userName: user.name }, jarItem, {
      directions: "For inhalation.",
      pesticides: "None",
      shelfLifeDays: "365",
    });
  });
  afterAll(() => pool.end());

  it("pulls lot, harvest batch, net weight, strain type, and the state poison center from records", async () => {
    const [r] = await loadLabelRecords(actor, "PRODUCT", [child]);
    expect(r.values).toMatchObject({
      "package.tag": `${run}-JAR1`,
      "package.harvest": `${run}-H1`,
      "package.plantBatch": `${run}-CLONES`,
      "package.netQuantity": "3.5 g (0.12 oz)",
      "item.strain": "Alpha",
      "item.strainType": "Hybrid",
      "item.pesticides": "None",
      "item.directions": "For inhalation.",
      "state.poisonCenter": "NM Poison & Drug Information Center 1-800-222-1222",
    });
    expect(r.values["package.expires"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // No lab result yet: no potency at all.
    expect(r.values["lab.thc"]).toBeNull();
    expect(r.values["lab.profile"]).toBeNull();
  });

  it("prints the cannabinoid profile only from a passed result", async () => {
    await addLabResult(actor, { packageId: child, labName: "Scepter", status: "PENDING", thcPercent: "20", profile: { thcaPercent: "22.5" } });
    let [r] = await loadLabelRecords(actor, "PRODUCT", [child]);
    expect(r.values["lab.thca"]).toBeNull();
    await addLabResult(actor, {
      packageId: child,
      labName: "Scepter",
      status: "PASS",
      thcPercent: "20",
      cbdPercent: "0.5",
      profile: { thcaPercent: "22.5", d9ThcPercent: "0.3", cbgPercent: "1.1", totalCannabinoidsPercent: "24.2" },
      terpenes: "Myrcene 0.82%, Limonene 0.41%",
    });
    [r] = await loadLabelRecords(actor, "PRODUCT", [child]);
    expect(r.values).toMatchObject({
      "lab.thc": "20%",
      "lab.thca": "22.5%",
      "lab.d9thc": "0.3%",
      "lab.thcMg": "700 mg",
      "lab.cbdMg": "17.5 mg",
      "lab.terpenes": "Myrcene 0.82%, Limonene 0.41%",
      "lab.profile": "Total THC 20% · THCa 22.5% · Δ9-THC 0.3% · CBD 0.5% · CBG 1.1% · Total cannabinoids 24.2%",
    });
  });

  it("refuses a cannabinoid value outside 0–100%", async () => {
    await expect(addLabResult(actor, { packageId: child, labName: "Scepter", status: "PASS", profile: { cbnPercent: "140" } })).rejects.toThrow(/CBN %/);
  });

  it("blocks printing a refrigerated product on the flower template", async () => {
    await saveItemDetails({ orgId: actor.orgId, userId: actor.userId, userName: actor.userName }, jarItem, { directions: "For inhalation.", pesticides: "None", shelfLifeDays: "365", mustRefrigerate: true });
    const records = await loadLabelRecords(actor, "PRODUCT", [child]);
    const r = validateLabels(nm("flower").design, "PRODUCT", "NM", records);
    expect(r.issues.find((i) => i.code === "RULE_nm-refrigerate")?.severity).toBe("block");
  });
});

describe("New Mexico starter layout", () => {
  it("keeps text clear of the barcode and the net quantity at the bottom", () => {
    for (const t of starterTemplates("NM").filter((s) => s.kind === "PRODUCT")) {
      const barcode = t.design.elements.find((e) => e.type === "barcode")!;
      const above = t.design.elements.filter((e) => e.type === "text" && e.y < barcode.y);
      for (const e of above) expect(e.y + e.h).toBeLessThanOrEqual(barcode.y);
    }
  });
  it("leaves out a blank part with its wording instead of printing a dangling label", () => {
    expect(fill("Lot {{package.lot}} · Harvest {{package.harvest}}", { "package.lot": "LOT-7", "package.harvest": null }).text).toBe("Lot LOT-7");
    expect(fill("Solvents: {{item.solvents}}", { "item.solvents": null }).text).toBe("");
  });
});
