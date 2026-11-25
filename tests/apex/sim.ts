/**
 * Project Apex simulator. Drives the REAL Leaf2Sale business functions against a real PostgreSQL database and
 * checks every day against the independent reference ledger (ledger.ts). Not mocked: cultivation, inventory,
 * wholesale orders, register, returns, voids, drawers and offline sync all run through the production code.
 * "Simulated clock" means logical business days: database timestamps are real wall-clock time.
 */
import { and, eq, sql } from "drizzle-orm";
import fs from "node:fs";
import { drawerSessions, facilities, itemCategories, items, locations, organizations, users } from "@/db/schema";
import { db } from "@/lib/db";
import { changePlantPhase, createPlantBatch, createStrain, destroyPlants, finishHarvest, harvestPlants, logHarvestWaste, packageHarvestMany, recordDryWeight, tagPlants } from "@/lib/cultivation";
import { expandTags } from "@/lib/cultivation-math";
import { addLabResult, receivePackage, setPackagesStatus, type Actor } from "@/lib/inventory";
import { InventoryError } from "@/lib/inventory-math";
import { allocateToOrder, addOrderLine, confirmOrder, createCustomer, createDriver, createOrder, createVehicle, deliverOrder, packOrder, recordPayment, shipOrder, verifyCustomerLicense } from "@/lib/distribution";
import { addDays, todayIn } from "@/lib/distribution-math";
import { recordOfflineSale } from "@/lib/offline-sales";
import { addToCart, checkInCustomer, closeDrawer, completeSale, createDiscount, drawerSummary, openDrawer, returnSale, saveRetailSettings, setCartDiscount, setMenuItem, voidSale } from "@/lib/pos";
import { buildExt, extDay, type ExtWorld } from "./ext";
import { Ledger, U, centsToString, divRound, priceSale, units, unitsToString, type LedgerLine, type Rates } from "./ledger";
import { rng, type Rng } from "./rng";

export type SimOpts = { seed: number; days: number; salesPerStoreDay: number; checkpoint: string; budgetMs: number; plantsPerBatch?: number };
type ItemDef = { id: string; name: string; cls: "FLOWER" | "CONCENTRATE" | "EDIBLE" | "NONE"; per: number; priceCents: bigint };
type World = {
  run: string; orgId: string; cult: string; dist: string; mfg: string; stores: string[]; storeNames: string[];
  cultLoc: { veg: string; flower: string; dry: string }; distLoc: string; storeLoc: string[];
  managers: Record<string, string>; cashiers: Record<string, string[]>; catalog: ItemDef[]; bulkItem: string;
  strains: string[]; discounts: { id: string; name: string; pct: number }[];
  customers: string[]; internalCustomer: string; driverId: string; vehicleId: string; cultUser: string; distUser: string;
  nextTag: number; day: number; rates: { exciseMilli: number; salesMilli: number };
  batches: { id: string; day: number; plantIds: string[]; strainIdx: number; stage: number; harvestId?: string; pkgs: string[] }[];
  pendingTransfer: { tag: string; grams: number }[]; distBulk: { id: string; tag: string; grams: number }[];
  findings: string[]; timings: Record<string, number[]>;
  ext?: ExtWorld;
};
export type SimState = { world: World; ledger: Ledger };

const PACK = Number(process.env.APEX_PACK ?? 24);
const LIMITS = { FLOWER: 567, CONCENTRATE: 160, EDIBLE: 8000 }; // tenths of a gram / mg: 56.7 g, 16 g, 800 mg
const actorOf = (w: World, fac: string, userId: string, name = "Sim User"): Actor => ({ userId, userName: name, orgId: w.orgId, facilityId: fac });
const rateOf = (w: World): Rates => ({ exciseMilli: BigInt(w.rates.exciseMilli), salesMilli: BigInt(w.rates.salesMilli), medicalExempt: true });
const pctStr = (milli: number) => (milli / 1000).toString();

function timed<T>(w: World, name: string, f: () => Promise<T>): Promise<T> {
  const t = performance.now();
  return f().finally(() => { (w.timings[name] ??= []).push(performance.now() - t); });
}

export async function buildWorld(seed: number): Promise<World> {
  const run = `AP${Date.now().toString(36).toUpperCase()}`;
  const r = rng(seed);
  const [org] = await db.insert(organizations).values({ name: `Apex Sim ${run}` }).returning();
  const mk = async (name: string, licenseType: "CULTIVATION" | "MANUFACTURING" | "DISTRIBUTION" | "RETAIL", n: number) =>
    (await db.insert(facilities).values({ orgId: org.id, name, licenseNumber: `${run}-${n}`, licenseType, state: "NM" }).returning())[0];
  const cult = await mk("Apex Cultivation", "CULTIVATION", 1);
  const mfg = await mk("Apex Manufacturing", "MANUFACTURING", 2);
  const dist = await mk("Apex Distribution", "DISTRIBUTION", 3);
  const stores = [await mk("Apex Retail Central", "RETAIL", 4), await mk("Apex Retail North", "RETAIL", 5), await mk("Apex Retail West", "RETAIL", 6)];
  // 50 employees: owner, 6 managers, 6 cultivation/inventory/sales, 18 cashiers, rest read-only.
  const roles: ("OWNER" | "MANAGER" | "CULTIVATION" | "INVENTORY" | "SALES" | "BUDTENDER" | "READ_ONLY")[] = [];
  roles.push("OWNER", "MANAGER", "MANAGER", "MANAGER", "MANAGER", "MANAGER", "MANAGER");
  for (let i = 0; i < 6; i++) roles.push("CULTIVATION", "INVENTORY", "SALES");
  for (let i = 0; i < 18; i++) roles.push("BUDTENDER");
  while (roles.length < 50) roles.push("READ_ONLY");
  const urows = await db.insert(users).values(roles.map((role, i) => ({ orgId: org.id, name: `Emp ${i + 1}`, email: `${run.toLowerCase()}${i}@test.invalid`, passwordHash: "x", role }))).returning();
  const byRole = (role: string) => urows.filter((u) => u.role === role);
  const cashiers: Record<string, string[]> = {};
  const managers: Record<string, string> = {};
  stores.forEach((s, i) => { cashiers[s.id] = byRole("BUDTENDER").slice(i * 6, i * 6 + 6).map((u) => u.id); managers[s.id] = byRole("MANAGER")[i].id; });
  const loc = async (fac: string, name: string) => (await db.insert(locations).values({ orgId: org.id, facilityId: fac, name, type: "ROOM" }).returning())[0].id;
  const cultLoc = { veg: await loc(cult.id, "Veg"), flower: await loc(cult.id, "Flower"), dry: await loc(cult.id, "Dry") };
  const distLoc = await loc(dist.id, "Vault");
  const storeLoc = [];
  for (const s of stores) storeLoc.push(await loc(s.id, "Floor"));
  const [cat] = await db.insert(itemCategories).values({ orgId: org.id, name: "All" }).returning();

  // 100 retail SKUs: 40 flower, 20 concentrate, 20 edible, 20 accessories. Every price has odd cents on purpose.
  const defs = [];
  for (let i = 0; i < 100; i++) {
    const cls = i < 40 ? "FLOWER" : i < 60 ? "CONCENTRATE" : i < 80 ? "EDIBLE" : "NONE";
    const per = cls === "FLOWER" ? r.pick([35, 70, 140]) : cls === "CONCENTRATE" ? r.pick([5, 10]) : cls === "EDIBLE" ? r.pick([100, 50, 200]) : 0;
    defs.push({ name: `SKU ${String(i).padStart(3, "0")} ${cls}`, cls, per, priceCents: BigInt(r.int(300, 12000) + (r.chance(0.5) ? 0 : r.int(1, 99)) % 100) });
  }
  const made = await db.insert(items).values([...defs.map((d, i) => ({ orgId: org.id, name: d.name, sku: `${run}-${i}`, categoryId: cat.id, unit: "EACH" as const })), { orgId: org.id, name: "Bulk Flower", sku: `${run}-BULK`, categoryId: cat.id, unit: "G" as const }]).returning();
  const catalog: ItemDef[] = defs.map((d, i) => ({ id: made[i].id, name: d.name, cls: d.cls as ItemDef["cls"], per: d.per, priceCents: d.priceCents }));
  const bulkItem = made[100].id;

  const rates = { exciseMilli: 14000, salesMilli: 7625 };
  for (const [i, s] of stores.entries()) {
    const a = actorOf({ orgId: org.id } as World, s.id, managers[s.id]);
    await saveRetailSettings(a, { flowerLimitGrams: "56.7", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "14", salesTaxPercent: "7.625", medicalTaxExempt: true });
    for (const d of catalog) {
      const cents = d.priceCents;
      await setMenuItem(a, { itemId: d.id, price: centsToString(cents), limitCategory: d.cls, limitPerUnit: d.cls === "NONE" ? undefined : String(d.per / 10) });
    }
    void i;
  }
  const mgr0 = actorOf({ orgId: org.id } as World, stores[0].id, managers[stores[0].id]);
  await createDiscount(mgr0, { name: "Veteran", percent: "10" });
  await createDiscount(mgr0, { name: "Senior", percent: "15" });
  const dRows = (await db.execute<{ id: string; name: string; percent: string }>(sql`select id, name, percent from discount_presets where org_id = ${org.id}`)).rows;
  const discounts = dRows.map((d) => ({ id: d.id, name: d.name, pct: Number(d.percent) }));

  const cultUser = byRole("CULTIVATION")[0].id;
  const distUser = byRole("SALES")[0].id;
  const ca = actorOf({ orgId: org.id } as World, cult.id, cultUser);
  const strains = [];
  for (const [n, t] of [["Alpha", "HYBRID"], ["Beta", "INDICA"], ["Gamma", "SATIVA"], ["Delta", "HYBRID"]] as const) strains.push((await createStrain(ca, { name: `${n} ${run}`, type: t, floweringDays: "63" })).id);

  const da = actorOf({ orgId: org.id } as World, dist.id, distUser);
  const ca2 = actorOf({ orgId: org.id } as World, cult.id, distUser);
  const exp = addDays(todayIn(), 900);
  const customers: string[] = [];
  for (let i = 0; i < 5; i++) {
    const c = await createCustomer(da, { name: `Wholesale Customer ${i + 1}`, licenseNumber: `${run}-W${i}`, licenseType: "Retailer", licenseExpires: exp, paymentTermsDays: "15" });
    await verifyCustomerLicense(da, { customerId: c.id });
    customers.push(c.id);
  }
  const ic = await createCustomer(ca2, { name: "Apex Distribution (own license)", licenseNumber: `${run}-INT`, licenseType: "Distributor", licenseExpires: exp, paymentTermsDays: "15" });
  await verifyCustomerLicense(ca2, { customerId: ic.id });
  const drv = await createDriver(ca2, { name: "Dana Driver", licenseNumber: `${run}-D` });
  const veh = await createVehicle(ca2, { make: "Ford", model: "Transit", plate: run.slice(0, 8) });
  void mfg;
  return {
    run, orgId: org.id, cult: cult.id, dist: dist.id, mfg: mfg.id, stores: stores.map((s) => s.id), storeNames: stores.map((s) => s.name), cultLoc, distLoc, storeLoc,
    managers, cashiers, catalog, bulkItem, strains, discounts, customers, internalCustomer: ic.id, driverId: drv.id, vehicleId: veh.id, cultUser, distUser,
    nextTag: 1, day: 0, rates, batches: [], pendingTransfer: [], distBulk: [], findings: [], timings: {},
  };
}

const tagFor = (w: World, p: string) => `${w.run}-${p}${String(w.nextTag++).padStart(7, "0")}`;

async function stockStore(w: World, L: Ledger, si: number, item: ItemDef, packs: number) {
  const fac = w.stores[si];
  const a = actorOf(w, fac, w.managers[fac], "Manager");
  for (let k = 0; k < packs; k++) {
    const pkg = await receivePackage(a, { tag: tagFor(w, "R"), itemId: item.id, quantity: String(PACK), locationId: w.storeLoc[si] });
    await addLabResult(a, { packageId: pkg.id, labName: "Apex Lab", status: "PASS", thcPercent: "20" });
    L.addStock(fac, item.id, units(PACK));
    L.counters.packagesMade++;
  }
  L.counters.restocks++;
}

/** Cultivation, lab and internal transfer for one day. */
async function cultivationDay(w: World, L: Ledger, r: Rng, day: number, plantsPerBatch: number) {
  const a = actorOf(w, w.cult, w.cultUser, "Grower");
  if (day % 7 === 0 && day <= 270) {
    const si = (day / 7) % w.strains.length;
    const batch = await createPlantBatch(a, { name: `${w.run}-B${day}`, strainId: w.strains[si], source: "CLONE", count: plantsPerBatch, locationId: w.cultLoc.veg });
    const tags = expandTags(`${w.run}-P${String(day).padStart(3, "0")}-0001`, plantsPerBatch);
    const plants = await tagPlants(a, { batchId: batch.id, tags });
    L.plants.tagged += plants.length;
    w.batches.push({ id: batch.id, day, plantIds: plants.map((p) => p.id), strainIdx: si, stage: 0, pkgs: [] });
  }
  for (const b of w.batches) {
    const age = day - b.day;
    if (b.stage === 0 && age >= 28) {
      // A few plants die in veg; the rest flower.
      const dead = b.plantIds.splice(0, r.int(0, 3));
      if (dead.length) { await destroyPlants(a, { plantIds: dead, reason: "Mold", wasteGrams: "50", wasteUnit: "G" }); L.plants.destroyed += dead.length; }
      await changePlantPhase(a, { plantIds: b.plantIds, phase: "FLOWERING" });
      b.stage = 1;
    } else if (b.stage === 1 && age >= 91) {
      const wetG = BigInt(b.plantIds.length) * BigInt(r.int(250, 330));
      const h = await harvestPlants(a, { plantIds: b.plantIds, name: `${w.run}-H${b.day}`, wetWeight: wetG.toString(), unit: "G", locationId: w.cultLoc.dry });
      L.plants.harvested += b.plantIds.length;
      b.harvestId = h.id;
      L.harvests.set(h.id, { wet: wetG * units(1), dry: 0n, waste: 0n, packaged: 0n });
      b.stage = 2;
    } else if (b.stage === 2 && age >= 101) {
      const hv = L.harvests.get(b.harvestId!)!;
      const dryG = (hv.wet * 22n) / 100n / units(1); // ~22% of wet weight, whole grams
      await recordDryWeight(a, { harvestId: b.harvestId!, dryWeight: dryG.toString(), unit: "G" });
      const wasteG = BigInt(r.int(20, 90));
      await logHarvestWaste(a, { harvestId: b.harvestId!, weight: wasteG.toString(), unit: "G", reason: "Stems" });
      hv.dry = dryG * units(1); hv.waste = wasteG * units(1);
      const n = Math.max(1, Math.min(60, Number((dryG - wasteG) / 1000n)));
      const per = (dryG - wasteG) / BigInt(n);
      const pk = await packageHarvestMany(a, { harvestId: b.harvestId!, tag: expandTags(`${w.run}-K${String(b.day).padStart(3, "0")}-0001`, n).join(","), itemId: w.bulkItem, quantity: per.toString(), locationId: w.cultLoc.dry, count: n });
      hv.packaged = per * BigInt(n) * units(1);
      // Whatever does not divide evenly into packages is logged as waste, so the harvest balances to the gram.
      const left = dryG - wasteG - per * BigInt(n);
      if (left > 0n) { await logHarvestWaste(a, { harvestId: b.harvestId!, weight: left.toString(), unit: "G", reason: "Trim remainder" }); hv.waste += left * units(1); }
      L.counters.packagesMade += n;
      for (const p of pk) {
        b.pkgs.push(p.tag);
        // 10% fail the lab; a failed package must not ship until a retest passes.
        const fail = r.chance(0.1);
        await addLabResult(a, { packageId: p.id, labName: "Apex Lab", status: fail ? "FAIL" : "PASS", thcPercent: "21" });
        if (fail) {
          let blocked = false;
          try { await transferBulk(w, L, [{ tag: p.tag, grams: Number(per) }]); } catch (e) { blocked = e instanceof InventoryError; }
          if (!blocked) w.findings.push(`FAILED-LAB package ${p.tag} was not blocked from transfer`);
          L.counters.rejectedAttempts++;
          await addLabResult(a, { packageId: p.id, labName: "Apex Lab retest", status: "PASS", thcPercent: "21" });
          // A failed package stays in quarantine after a passing retest until someone releases it.
          await setPackagesStatus(a, { packageIds: [p.id], status: "ACTIVE", reason: "Retest passed" });
        }
        w.pendingTransfer.push({ tag: p.tag, grams: Number(per) });
      }
      await finishHarvest(a, { harvestId: b.harvestId! }).catch((e) => w.findings.push(`finishHarvest ${b.harvestId}: ${(e as Error).message}`));
      b.stage = 3;
    }
  }
  // Weekly: ship tested bulk to the distribution facility under a manifest.
  if (day % 7 === 3 && w.pendingTransfer.length) {
    const batch = w.pendingTransfer.splice(0, 40);
    await transferBulk(w, L, batch);
  }
}

async function transferBulk(w: World, L: Ledger, list: { tag: string; grams: number }[]) {
  const a = actorOf(w, w.cult, w.cultUser, "Grower");
  const order = await createOrder(a, { customerId: w.internalCustomer });
  await addOrderLine(a, { orderId: order.id, itemId: w.bulkItem, quantity: String(list.reduce((s, p) => s + p.grams, 0)), unitPrice: "0.00" });
  await confirmOrder(a, { orderId: order.id });
  const lineId = (await db.execute<{ id: string }>(sql`select id from order_lines where order_id = ${order.id}`)).rows[0].id;
  for (const p of list) await allocateToOrder(a, { orderId: order.id, lineId, tag: p.tag });
  await packOrder(a, { orderId: order.id });
  await shipOrder(a, { orderId: order.id, driverId: w.driverId, vehicleId: w.vehicleId, departAt: `${todayIn()}T09:00` });
  await deliverOrder(a, { orderId: order.id, receivedBy: "Vault clerk" });
  const da = actorOf(w, w.dist, w.distUser, "Vault clerk");
  for (const p of list) {
    L.transfers.outUnits += units(p.grams);
    const pkg = await receivePackage(da, { tag: `${p.tag}-D`, itemId: w.bulkItem, quantity: String(p.grams), locationId: w.distLoc, note: `Manifest from cultivation, package ${p.tag}` });
    await addLabResult(da, { packageId: pkg.id, labName: "Apex Lab", status: "PASS", thcPercent: "21" });
    L.transfers.inUnits += units(p.grams);
    L.addStock(w.dist, w.bulkItem, units(p.grams));
    w.distBulk.push({ id: pkg.id, tag: pkg.tag, grams: p.grams });
  }
  L.transfers.count++;
}

/** Wholesale orders from the distribution facility: whole packages at an odd per-gram price. */
async function wholesaleDay(w: World, L: Ledger, r: Rng, day: number) {
  if (day % 3 !== 1 || !w.distBulk.length) return;
  const a = actorOf(w, w.dist, w.distUser, "Sales rep");
  const take = w.distBulk.splice(0, r.int(1, Math.min(3, w.distBulk.length)));
  const grams = take.reduce((s, p) => s + p.grams, 0);
  const priceMilli = BigInt(r.int(2000, 4000)); // $/g in thousandths? keep to cents: price per gram in cents
  const priceCents = priceMilli / 10n;
  const customerId = r.pick(w.customers);
  const o = await createOrder(a, { customerId });
  await addOrderLine(a, { orderId: o.id, itemId: w.bulkItem, quantity: String(grams), unitPrice: centsToString(priceCents) });
  await confirmOrder(a, { orderId: o.id });
  const lineId = (await db.execute<{ id: string }>(sql`select id from order_lines where order_id = ${o.id}`)).rows[0].id;
  for (const p of take) await allocateToOrder(a, { orderId: o.id, lineId, tag: p.tag });
  await packOrder(a, { orderId: o.id });
  const shipped = await shipOrder(a, { orderId: o.id, driverId: w.driverId, vehicleId: w.vehicleId, departAt: `${todayIn()}T10:00` });
  await deliverOrder(a, { orderId: o.id, receivedBy: "Buyer" });
  const expected = BigInt(grams) * priceCents;
  const inv = (await db.execute<{ id: string; total: string }>(sql`select id, total from invoices where number = ${shipped.invoiceNumber} and facility_id = ${w.dist}`)).rows[0];
  if (centsToString(expected) !== Number(inv.total).toFixed(2)) w.findings.push(`INVOICE ${shipped.invoiceNumber}: ledger ${centsToString(expected)} vs app ${inv.total}`);
  L.wholesaleCents += expected;
  L.addStock(w.dist, w.bulkItem, -units(grams));
  if (r.chance(0.8)) {
    await recordPayment(a, { invoiceId: inv.id, amount: centsToString(expected), method: "ACH", paidOn: todayIn() });
    L.wholesalePaidCents += expected;
  }
}

function cartFor(w: World, L: Ledger, r: Rng, fac: string): { lines: { item: ItemDef; qty: number }[] } | null {
  const n = r.int(1, 4);
  const used = { FLOWER: 0, CONCENTRATE: 0, EDIBLE: 0, NONE: 0 };
  const lines: { item: ItemDef; qty: number }[] = [];
  for (let k = 0; k < n * 3 && lines.length < n; k++) {
    const item = r.pick(w.catalog);
    if (lines.some((l) => l.item.id === item.id)) continue;
    const qty = r.chance(0.8) ? 1 : r.int(2, 3);
    const left = L.stockOf(fac, item.id) / units(1);
    if (left < BigInt(qty)) continue;
    if (item.cls !== "NONE") {
      const add = item.per * qty; // tenths of g / mg
      if (used[item.cls] + add > LIMITS[item.cls]) continue;
      used[item.cls] += add;
    }
    lines.push({ item, qty });
  }
  return lines.length ? { lines } : null;
}

type Counter = { open: boolean; drawerId: string; key: string; cashierId: string; cashKept: bigint; cashRefunds: bigint; opening: bigint };

async function storeDay(w: World, L: Ledger, r: Rng, si: number, day: number, perDay: number) {
  const fac = w.stores[si];
  const mgr = actorOf(w, fac, w.managers[fac], "Manager");
  // Replenish anything running low.
  for (const item of w.catalog) if (L.stockOf(fac, item.id) < units(Math.max(8, Math.floor(PACK * 1.25)))) await stockStore(w, L, si, item, 2);
  const shifts = 2;
  const idCard = { birthDate: "1990-05-05", idExpires: addDays(todayIn(), 400) };
  for (let sh = 0; sh < shifts; sh++) {
    const cashierId = r.pick(w.cashiers[fac]);
    const a = actorOf(w, fac, cashierId, "Cashier");
    const opening = BigInt(r.int(10000, 30000));
    const drawer = await timed(w, "openDrawer", () => openDrawer(a, { openingCash: centsToString(opening) }));
    const c: Counter = { open: true, drawerId: drawer.id, key: drawer.id, cashierId, cashKept: 0n, cashRefunds: 0n, opening };
    const doneKeys: string[] = [];
    const count = Math.round(perDay / shifts);
    for (let i = 0; i < count; i++) {
      const cart = cartFor(w, L, r, fac);
      if (!cart) continue;
      const medical = r.chance(0.1);
      const disc = r.chance(0.15) ? r.pick(w.discounts) : null;
      const lines: LedgerLine[] = cart.lines.map((l) => ({ itemId: l.item.id, qty: BigInt(l.qty), priceCents: l.item.priceCents }));
      const calc = priceSale(lines, BigInt(disc?.pct ?? 0), rateOf(w), medical);
      const offline = r.chance(0.04);
      let key = "";
      if (offline) {
        // Rung up with no internet: carries the rates it was charged, synced later in the day.
        const tendered = calc.total + BigInt(r.int(0, 2000));
        const sold = new Date(Date.now() - 60_000);
        const sale = await timed(w, "offlineSale", () => recordOfflineSale(a, {
          offlineId: crypto.randomUUID(), localNumber: `OFF-${day}-${i}`, facilityId: fac, sellerId: cashierId, sellerName: "Cashier", drawerId: c.drawerId, soldAt: sold.toISOString(),
          customerType: medical ? "MEDICAL" : "ADULT_USE", ...idCard,
          lines: cart.lines.map((l) => ({ itemId: l.item.id, name: l.item.name, quantity: String(l.qty), unitPrice: centsToString(l.item.priceCents), limitCategory: l.item.cls, limitPerUnit: l.item.cls === "NONE" ? null : String(l.item.per / 10) })),
          discount: disc ? { name: disc.name, percent: String(disc.pct) } : null,
          rates: { exciseTaxPercent: pctStr(w.rates.exciseMilli), salesTaxPercent: pctStr(w.rates.salesMilli), medicalTaxExempt: true },
          total: centsToString(calc.total), cashTendered: centsToString(tendered), changeDue: centsToString(tendered - calc.total),
        }));
        key = sale.saleId;
        L.counters.offlineSales++;
        L.recordSale({ key, fac, calc, lines, cashKept: calc.total, debit: 0n, refunded: 0n, voided: false, drawer: c.drawerId, offline: true });
        c.cashKept += calc.total;
      } else {
        const sale = await timed(w, "checkIn", () => checkInCustomer(a, { ...idCard, customerType: medical ? "MEDICAL" : "ADULT_USE" }));
        for (const l of cart.lines) await timed(w, "addToCart", () => addToCart(a, { saleId: sale.id, itemId: l.item.id, quantity: String(l.qty) }));
        if (disc) await setCartDiscount(a, { saleId: sale.id, discountId: disc.id });
        const m = r.pick(["CASH", "CASH", "DEBIT", "SPLIT"] as const);
        let debit = 0n; let cashTend = 0n;
        if (m === "CASH") cashTend = calc.total + BigInt(r.int(0, 2000));
        else if (m === "DEBIT") debit = calc.total;
        else { debit = divRound(calc.total, 2n); cashTend = calc.total - debit + BigInt(r.int(0, 500)); }
        const out = await timed(w, "completeSale", () => completeSale(a, { saleId: sale.id, paymentMethod: m, cashTendered: centsToString(cashTend), debitAmount: centsToString(debit) }));
        if (out.total !== centsToString(calc.total)) w.findings.push(`SALE ${out.number}: ledger total ${centsToString(calc.total)} vs app ${out.total} (cart ${JSON.stringify(lines.map((l) => [l.qty.toString(), l.priceCents.toString()]))} disc ${disc?.pct ?? 0} medical ${medical})`);
        key = sale.id;
        const kept = calc.total - debit;
        L.recordSale({ key, fac, calc, lines, cashKept: kept, debit, refunded: 0n, voided: false, drawer: c.drawerId, offline: false });
        c.cashKept += kept;
      }
      doneKeys.push(key);
      // After-sale events: a return, or a void while the drawer is still open.
      const roll = r.next();
      if (roll < 0.02) {
        const s = L.sales.get(key)!;
        const lineRows = (await db.execute<{ id: string; item_id: string; quantity: string }>(sql`select id, item_id, quantity from sale_lines where sale_id = ${key}`)).rows;
        const first = lineRows[0];
        const full = lineRows.length === 1 && r.chance(0.5);
        const q = full ? first.quantity : "1";
        const retQty = BigInt(Math.floor(Number(q)));
        const isLast = lineRows.length === 1 && retQty === s.lines[0].qty;
        const expected = L.refundFor(key, [{ itemId: first.item_id, qty: retQty }], isLast);
        const disposition = r.chance(0.5) ? "RESTOCK" : "DISPOSE";
        const res = await returnSale(a, { saleId: key, lines: [{ saleLineId: first.id, quantity: String(retQty) }], refundMethod: "CASH", disposition, reason: "Apex return" }).catch((e) => ({ error: e as Error }));
        if ("error" in res) w.findings.push(`RETURN on ${key}: ${res.error.message}`);
        else {
          if (res.amount !== centsToString(expected)) w.findings.push(`RETURN ${res.number}: ledger refund ${centsToString(expected)} vs app ${res.amount}`);
          s.refunded += expected; c.cashRefunds += expected; L.counters.returns++;
          // Sealed product goes back on the shelf; opened or damaged product is written off, so stock stays down.
          if (disposition === "RESTOCK") L.addStock(fac, first.item_id, retQty * U);
        }
      } else if (roll < 0.025) {
        await voidSale(a, { saleId: key, reason: "Apex void" });
        L.voidSale(key);
        const s = L.sales.get(key)!;
        c.cashKept -= s.cashKept;
      }
    }
    // Close: counted cash is the ledger's expectation plus a known injected variance on some days.
    const expected = c.opening + c.cashKept - c.cashRefunds;
    const delta = r.chance(0.05) ? BigInt(r.int(-500, 500)) : 0n;
    const counted = expected + delta;
    const sum = await drawerSummary(db, (await db.select().from(drawerSessions).where(eq(drawerSessions.id, c.drawerId)))[0]);
    if (centsToString(expected) !== sum.expectedCash.toFixed(2)) w.findings.push(`DRAWER ${c.drawerId}: ledger expects ${centsToString(expected)} vs app ${sum.expectedCash.toFixed(2)}`);
    const closed = await timed(w, "closeDrawer", () => closeDrawer(a, { countedCash: centsToString(counted) }));
    if (closed.variance !== centsToString(delta)) w.findings.push(`DRAWER ${c.drawerId}: injected variance ${centsToString(delta)} vs app ${closed.variance}`);
    L.drawerVariance.set(c.drawerId, delta);
    void mgr;
  }
}

/** Compare the database to the ledger for one facility. Returns human-readable mismatches. */
export async function reconcile(w: World, L: Ledger): Promise<string[]> {
  const bad: string[] = [];
  for (let i = 0; i < w.stores.length; i++) {
    const fac = w.stores[i];
    const t = L.salesTotals(fac);
    const row = (await db.execute<{ n: string; sub: string; disc: string; ex: string; st: string; tot: string }>(sql`
      select count(*) n, coalesce(sum(subtotal),0) sub, coalesce(sum(discount_total),0) disc, coalesce(sum(excise_tax),0) ex, coalesce(sum(sales_tax),0) st, coalesce(sum(total),0) tot
      from sales where facility_id = ${fac} and status = 'COMPLETED'`)).rows[0];
    const cmp = (what: string, ledger: string, app: string) => { if (ledger !== Number(app).toFixed(2)) bad.push(`${w.storeNames[i]} ${what}: ledger ${ledger} vs app ${app}`); };
    if (Number(row.n) !== t.count) bad.push(`${w.storeNames[i]} sale count: ledger ${t.count} vs app ${row.n}`);
    cmp("subtotal", centsToString(t.subtotal), row.sub); cmp("discounts", centsToString(t.discount), row.disc);
    cmp("excise", centsToString(t.excise), row.ex); cmp("sales tax", centsToString(t.salesTax), row.st); cmp("total", centsToString(t.total), row.tot);
    const ref = (await db.execute<{ s: string }>(sql`select coalesce(sum(amount),0) s from sale_returns where facility_id = ${fac}`)).rows[0].s;
    cmp("refunds", centsToString(t.refunded), ref);
  }
  // Stock on hand by facility and item.
  const stock = (await db.execute<{ facility_id: string; item_id: string; q: string }>(sql`
    select facility_id, item_id, sum(quantity) q from packages where org_id = ${w.orgId} and status in ('ACTIVE','ON_HOLD','QUARANTINE','ALLOCATED') group by 1, 2`)).rows;
  const seen = new Set<string>();
  for (const s of stock) {
    if (s.facility_id === w.cult) continue;
    const k = `${s.facility_id}:${s.item_id}`; seen.add(k);
    const mine = L.stockOf(s.facility_id, s.item_id);
    // Returned-and-written-off units are not in the ledger's sellable view, so allow ledger >= app only when that explains it.
    if (units(0) + BigInt(Math.round(Number(s.q) * 10000)) !== mine) bad.push(`stock ${k}: ledger ${unitsToString(mine)} vs app ${s.q}`);
  }
  for (const [k, v] of L.stock) if (!seen.has(k) && v !== 0n && !k.startsWith(`${w.cult}:`)) bad.push(`stock ${k}: ledger ${unitsToString(v)} vs app (no packages)`);
  // Plants and harvest weights.
  const pl = (await db.execute<{ status: string; n: string }>(sql`select status::text status, count(*) n from plants where org_id = ${w.orgId} group by 1`)).rows;
  const total = pl.reduce((s, p) => s + Number(p.n), 0);
  if (total !== L.plants.tagged) bad.push(`plants tagged: ledger ${L.plants.tagged} vs app ${total}`);
  for (const [id, h] of L.harvests) {
    const r = (await db.execute<{ wet: string; dry: string; waste: string; packaged: string }>(sql`select wet_weight wet, dry_weight dry, waste_weight waste, packaged_weight packaged from harvests where id = ${id}`)).rows[0];
    const same = (a: bigint, b: string | null) => BigInt(Math.round(Number(b ?? 0) * 10000)) === a;
    if (!same(h.wet, r.wet) || !same(h.dry, r.dry) || !same(h.waste, r.waste) || !same(h.packaged, r.packaged)) bad.push(`harvest ${id}: ledger wet/dry/waste/pkg ${[h.wet, h.dry, h.waste, h.packaged].map(unitsToString)} vs app ${[r.wet, r.dry, r.waste, r.packaged]}`);
  }
  return bad;
}

/** Whole-database invariants that need no ledger at all. */
export async function invariants(w: World): Promise<string[]> {
  const bad: string[] = [];
  const q = async (name: string, query: ReturnType<typeof sql>) => { const rows = (await db.execute<{ n: string }>(query)).rows; if (Number(rows[0]?.n ?? 0) > 0) bad.push(`${name}: ${rows[0].n} violations`); };
  await q("negative package quantity", sql`select count(*) n from packages where org_id = ${w.orgId} and quantity < 0`);
  await q("package quantity != sum of its movements", sql`select count(*) n from (select p.id from packages p left join inventory_transactions t on t.package_id = p.id where p.org_id = ${w.orgId} group by p.id, p.quantity having p.quantity <> coalesce(sum(t.quantity_delta), 0)) x`);
  await q("sale line sources != line quantity", sql`select count(*) n from (select l.id from sale_lines l join sales s on s.id = l.sale_id left join sale_line_packages p on p.sale_line_id = l.id where s.org_id = ${w.orgId} and s.status = 'COMPLETED' group by l.id, l.quantity having l.quantity <> coalesce(sum(p.quantity), 0)) x`);
  await q("completed sale total != subtotal - discount + taxes", sql`select count(*) n from sales where org_id = ${w.orgId} and status = 'COMPLETED' and total <> subtotal - discount_total + excise_tax + sales_tax`);
  await q("duplicate sale numbers", sql`select count(*) n from (select facility_id, number from sales where org_id = ${w.orgId} group by 1, 2 having count(*) > 1) x`);
  await q("package without audit entry", sql`select count(*) n from packages p where p.org_id = ${w.orgId} and not exists (select 1 from audit_logs a where a.entity_id = p.id)`);
  await q("completed sale without audit entry", sql`select count(*) n from sales s where s.org_id = ${w.orgId} and s.status = 'COMPLETED' and not exists (select 1 from audit_logs a where a.entity_id = s.id)`);
  await q("open drawers left behind", sql`select count(*) n from drawer_sessions where org_id = ${w.orgId} and status = 'OPEN'`);
  return bad;
}

export function save(opts: SimOpts, st: SimState) { fs.writeFileSync(opts.checkpoint, JSON.stringify({ world: st.world }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) + "\n@@LEDGER@@\n" + st.ledger.serialize()); }
export function load(opts: SimOpts): SimState | null {
  if (!fs.existsSync(opts.checkpoint)) return null;
  const [a, b] = fs.readFileSync(opts.checkpoint, "utf8").split("\n@@LEDGER@@\n");
  const world = JSON.parse(a).world as World;
  // The world was saved with bigint prices as text; turn them back.
  for (const d of world.catalog) d.priceCents = BigInt(d.priceCents as unknown as string);
  return { world, ledger: Ledger.fromJSON(b) };
}

export async function runSim(opts: SimOpts): Promise<{ state: SimState; finished: boolean; mismatches: string[] }> {
  let st = load(opts);
  if (!st) st = { world: await buildWorld(opts.seed), ledger: new Ledger() };
  const { world: w, ledger: L } = st;
  const started = Date.now();
  const mismatches: string[] = [];
  while (w.day < opts.days && Date.now() - started < opts.budgetMs) {
    const day = w.day;
    const r = rng(opts.seed * 100003 + day);
    // A mid-year tax change; sales after it use the new rates.
    if (day === Math.floor(opts.days * 0.55) && w.rates.exciseMilli === 14000) {
      for (const [i, fac] of w.stores.entries()) {
        const a = actorOf(w, fac, w.managers[fac]);
        await saveRetailSettings(a, { flowerLimitGrams: "56.7", concentrateLimitGrams: "16", edibleLimitMg: "800", exciseTaxPercent: "15", salesTaxPercent: "7.875", medicalTaxExempt: true });
        void i;
      }
      w.rates = { exciseMilli: 15000, salesMilli: 7875 };
    }
    await cultivationDay(w, L, r, day, opts.plantsPerBatch ?? 130);
    await wholesaleDay(w, L, r, day);
    for (let si = 0; si < w.stores.length; si++) await storeDay(w, L, r, si, day, opts.salesPerStoreDay);
    // Manufacturing, promotions, rewards, labels and Tally run in their own organization with their own expectations.
    w.ext ??= await buildExt(w.run);
    await timed(w, "extensionDay", () => extDay(w.ext!, r, day, w.findings));
    const bad = await reconcile(w, L);
    mismatches.push(...bad.map((m) => `day ${day}: ${m}`));
    w.day++;
    save(opts, st);
    if (bad.length || w.findings.length) { /* keep going so the full picture is recorded */ }
  }
  return { state: st, finished: w.day >= opts.days, mismatches };
}
