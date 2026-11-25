/**
 * Project Apex II extension: manufacturing, promotions, rewards, label generation and Tally operations.
 *
 * Runs once a day inside the 365-day simulation, in its own organization so the main ledger's totals stay clean.
 * Every expectation below is computed here, with whole-cent BigInt arithmetic, without calling CannaTrace's own
 * math: if the application and this file disagree, the disagreement is recorded as a finding, never reconciled away.
 */
import { and, eq, sql } from "drizzle-orm";
import { facilities, itemCategories, items, locations, organizations, packages, users } from "@/db/schema";
import { db } from "@/lib/db";
import { addLabResult, receivePackage, type Actor } from "@/lib/inventory";
import { addToCart, checkInCustomer, closeDrawer, completeSale, joinRewards, openDrawer, returnSale, saveRetailSettings, setMenuItem } from "@/lib/pos";
import { createPromotion } from "@/lib/promotions";
import { saveProgram } from "@/lib/rewards";
import { addRunInput, completeRun, createRecipe, startRun } from "@/lib/manufacturing";
import { addDays, todayIn } from "@/lib/distribution-math";
import { loadLabelRecords } from "@/lib/labels/data";
import { starterTemplates } from "@/lib/labels/defaults";
import { renderLabelSvg } from "@/lib/labels/render-svg";
import { validateLabels } from "@/lib/labels/validate";
import { confirmProposal, runAssistant, type AssistantEvent } from "@/lib/assistant/engine";
import { permissionsFor } from "@/lib/rbac";
import type { Session } from "@/lib/session";
import type { Rng } from "./rng";
import { centsToString, divRound } from "./ledger";

export type ExtWorld = {
  orgId: string; facilityId: string; userId: string; locA: string; locB: string;
  bulk: string; jar: string; jarred: string; recipeId: string; counter: number;
  stats: Record<string, number>;
};

const EXCISE_MILLI = 15000n; // 15%
const SALES_MILLI = 7875n; // 7.875%
const PROMO_PCT = 20n;
const PRICE = 2000n; // $20.00 a jar
const POINTS_PER_DOLLAR = 1n;
const SIGNUP = 25n;

/** The money on a sale of `qty` jars with the 20% item promotion, computed independently. */
export function promoSale(qty: bigint) {
  const subtotal = qty * PRICE;
  const promo = divRound(subtotal * PROMO_PCT, 100n);
  const taxable = subtotal - promo;
  const excise = divRound(taxable * EXCISE_MILLI, 100_000n);
  const salesTax = divRound(taxable * SALES_MILLI, 100_000n);
  return { subtotal, promo, taxable, excise, salesTax, total: taxable + excise + salesTax, points: SIGNUP + taxable / 100n * POINTS_PER_DOLLAR };
}

/** Cost per unit to eight decimal places, round half up: (inputs + extra) cents over the output count. */
export function unitCost8(totalCents: bigint, outputUnits: bigint): string {
  const scaled = divRound(totalCents * 1_000_000n, outputUnits); // cents -> dollars is /100, x1e8 is x1e6 overall
  const whole = scaled / 100_000_000n;
  return `${whole}.${String(scaled % 100_000_000n).padStart(8, "0")}`;
}

export async function buildExt(run: string): Promise<ExtWorld> {
  const [org] = await db.insert(organizations).values({ name: `Apex Ext ${run}` }).returning();
  const [fac] = await db.insert(facilities).values({ orgId: org.id, name: "Ext Shop", licenseNumber: `${run}-X1`, licenseType: "RETAIL", state: "NM" }).returning();
  const [u] = await db.insert(users).values({ orgId: org.id, name: "Ext Manager", email: `ext.${run.toLowerCase()}@test.invalid`, passwordHash: "x", role: "OWNER" }).returning();
  const [a] = await db.insert(locations).values({ orgId: org.id, facilityId: fac.id, name: "Floor", type: "ROOM" }).returning();
  const [b] = await db.insert(locations).values({ orgId: org.id, facilityId: fac.id, name: "Back", type: "ROOM" }).returning();
  const [cat] = await db.insert(itemCategories).values({ orgId: org.id, name: "Ext" }).returning();
  const mk = async (name: string, sku: string, unit: "G" | "EACH", unitWeightGrams?: string) =>
    (await db.insert(items).values({ orgId: org.id, name, sku: `${run}-${sku}`, categoryId: cat.id, unit, ...(unitWeightGrams ? { unitWeightGrams } : {}) }).returning())[0];
  const bulk = await mk("Ext bulk flower", "B", "G");
  const jar = await mk("Ext empty jar", "J", "EACH");
  const jarred = await mk("Ext jarred flower", "JF", "EACH", "3.5");
  const actor: Actor = { userId: u.id, userName: u.name, orgId: org.id, facilityId: fac.id };
  await saveRetailSettings(actor, { flowerLimitGrams: "5000", concentrateLimitGrams: "5000", edibleLimitMg: "500000", exciseTaxPercent: "15", salesTaxPercent: "7.875", medicalTaxExempt: true });
  await setMenuItem(actor, { itemId: jarred.id, price: centsToString(PRICE), limitCategory: "NONE" });
  await createPromotion(actor, { name: "Ext jar promo", kind: "PERCENT", amount: String(PROMO_PCT), scope: "ITEM", itemId: jarred.id }, []);
  await saveProgram(actor, { enabled: "on", pointsPerDollar: String(POINTS_PER_DOLLAR), redeemPoints: "100", redeemDollars: "5", signupBonus: String(SIGNUP), birthdayBonus: "0", expireMonths: "12", maxSharePercent: "50" });
  const recipe = await createRecipe(actor, { name: "Ext jar 3.5", outputItemId: jarred.id, outputQuantity: "100", lines: [{ itemId: bulk.id, quantity: "350" }, { itemId: jar.id, quantity: "100" }] });
  return { orgId: org.id, facilityId: fac.id, userId: u.id, locA: a.id, locB: b.id, bulk: bulk.id, jar: jar.id, jarred: jarred.id, recipeId: recipe.id, counter: 0, stats: {} };
}

const bump = (x: ExtWorld, k: string) => { x.stats[k] = (x.stats[k] ?? 0) + 1; };

/** One business day of the extension. Anything unexpected is pushed to `findings`. */
export async function extDay(x: ExtWorld, r: Rng, day: number, findings: string[]): Promise<void> {
  const a: Actor = { userId: x.userId, userName: "Ext Manager", orgId: x.orgId, facilityId: x.facilityId };
  const note = (m: string) => findings.push(`EXT day ${day}: ${m}`);
  const same = (what: string, want: string, got: string | null | undefined) => { if (want !== String(got)) note(`${what}: expected ${want}, app ${got}`); };
  const tag = (s: string) => `EXT${x.orgId.slice(0, 4).toUpperCase()}-${day}-${s}-${++x.counter}`;

  // ---- Manufacturing: a two-batch run from tested bulk flower and empty jars ----
  const bulkCents = BigInt(r.pick([95, 120, 135]));
  const jarCents = 35n;
  const extraDollars = BigInt(r.int(0, 90));
  const actual = BigInt(200 - r.int(0, 6));
  const bulkPkg = await receivePackage(a, { tag: tag("BULK"), itemId: x.bulk, quantity: "700", locationId: x.locA, lotNumber: `LOT-${day}`, costPerUnit: centsToString(bulkCents) });
  const jarPkg = await receivePackage(a, { tag: tag("JAR"), itemId: x.jar, quantity: "200", locationId: x.locA, lotNumber: `LOT-${day}`, costPerUnit: centsToString(jarCents) });
  const started = await startRun(a, { name: `EXT-${x.orgId.slice(0, 4)}-D${day}`, recipeId: x.recipeId, batches: "2" });
  await addRunInput(a, { runId: started.id, tag: bulkPkg.tag, quantity: "700" });
  await addRunInput(a, { runId: started.id, tag: jarPkg.tag, quantity: "200" });
  const inputCents = 700n * bulkCents + 200n * jarCents;
  const { run: done, output } = await completeRun(a, { runId: started.id, outputTag: tag("OUT"), actualQuantity: String(actual), locationId: x.locA, extraCost: String(extraDollars), lossNote: actual < 200n ? "Underweight jars" : undefined });
  same("production input cost", centsToString(inputCents), Number(done.inputCost).toFixed(2));
  same("production cost per unit", unitCost8(inputCents + extraDollars * 100n, actual), output.costPerUnit);
  same("production output quantity", `${actual}.0000`, output.quantity);
  const left = (await db.execute<{ q: string }>(sql`select coalesce(sum(quantity),0) q from packages where id in (${bulkPkg.id}, ${jarPkg.id})`)).rows[0].q;
  if (Number(left) !== 0) note(`production left ${left} of its inputs behind`);
  bump(x, "productionRuns");

  // The output is tested, then sold.
  await addLabResult(a, { packageId: output.id, labName: "Ext Lab", status: "PASS", thcPercent: "21.5" });

  // ---- Label generation and validation for the new package ----
  const [rec] = await loadLabelRecords(a, "PRODUCT", [output.id]);
  // A jarred-flower label describes one jar: 3.5 g, whatever the size of the package it came from.
  const want = "3.5 g";
  if (!rec) note("label record for the new package was not produced");
  else {
    same("label tag", output.tag, rec.values["package.tag"]);
    if (!String(rec.values["package.netQuantity"] ?? "").startsWith(want)) note(`label net quantity: expected it to start with ${want}, app ${rec.values["package.netQuantity"]}`);
    const design = starterTemplates("NM").find((t) => t.kind === "PRODUCT")!.design;
    const svg = renderLabelSvg(design, rec.values);
    if (!svg.includes(output.tag)) note("rendered label does not show the package tag");
    if (/\{\{|undefined|NaN/.test(svg)) note("rendered label has an unfilled field or a bad value");
    const verdict = validateLabels(design, "PRODUCT", "NM", [rec]);
    // A starter label may be blocked only by details this simulated item never had; any other block is a finding.
    const blocking = verdict.issues.filter((i) => i.severity === "block" && !/item\.|strain|pesticide|direction|ingredient|logo/i.test(`${i.code} ${i.message}`));
    // The state logo has to be uploaded once by the business; that is setup, not a defect.
    if (verdict.blocked) bump(x, "labelsBlockedBySetupOnly");
    if (blocking.length) note(`label blocked: ${blocking[0].message}`);
    bump(x, "labelsChecked");
  }

  // ---- Promotion, rewards and returns on a real sale ----
  const qty = BigInt(r.int(2, 6));
  const money = promoSale(qty);
  await openDrawer(a, { openingCash: "100.00" });
  const cart = await checkInCustomer(a, { birthDate: "1990-05-05", idExpires: addDays(todayIn(), 400), customerType: "ADULT_USE" });
  await addToCart(a, { saleId: cart.id, itemId: x.jarred, quantity: String(qty) });
  const phone = `505${String(100_0000 + x.counter).slice(-7)}`;
  await joinRewards(a, { saleId: cart.id, phone, firstName: "Ext", agreed: true });
  const sale = await completeSale(a, { saleId: cart.id, paymentMethod: "CASH", cashTendered: centsToString(money.total) });
  const row = (await db.execute<{ subtotal: string; promo_discount: string; discount_total: string; excise_tax: string; sales_tax: string; total: string; reward_member_id: string }>(
    sql`select subtotal, promo_discount, discount_total, excise_tax, sales_tax, total, reward_member_id from sales where id = ${cart.id}`)).rows[0];
  same("promo sale subtotal", centsToString(money.subtotal), Number(row.subtotal).toFixed(2));
  same("promo sale promo", centsToString(money.promo), Number(row.promo_discount).toFixed(2));
  same("promo sale discount total", centsToString(money.promo), Number(row.discount_total).toFixed(2));
  same("promo sale excise", centsToString(money.excise), Number(row.excise_tax).toFixed(2));
  same("promo sale sales tax", centsToString(money.salesTax), Number(row.sales_tax).toFixed(2));
  same("promo sale total", centsToString(money.total), sale.total);
  const points = async () => String((await db.execute<{ points: number }>(sql`select points from reward_members where id = ${row.reward_member_id}`)).rows[0].points);
  same("reward points after the sale", money.points.toString(), await points());

  // Return every jar one at a time: the refunds must add up to exactly what was paid, and the points must come back.
  const lineId = (await db.execute<{ id: string }>(sql`select id from sale_lines where sale_id = ${cart.id}`)).rows[0].id;
  let refunded = 0n;
  for (let i = 0n; i < qty; i++) {
    const res = await returnSale(a, { saleId: cart.id, lines: [{ saleLineId: lineId, quantity: "1" }], refundMethod: "CASH", disposition: "RESTOCK", reason: "Ext return" });
    const cents = BigInt(Math.round(Number(res.amount) * 100));
    refunded += cents;
    if (i === 0n && qty > 1n) {
      const fair = money.total / qty;
      if (cents < fair - qty || cents > fair + qty) note(`first partial refund ${centsToString(cents)} is not within a cent per unit of ${centsToString(fair)}`);
    }
  }
  same("refunds added up", centsToString(money.total), centsToString(refunded));
  same("reward points after returning everything", SIGNUP.toString(), await points());
  // The drawer took the sale in cash and gave it all back, so it should count exactly its opening cash.
  const closed = await closeDrawer(a, { countedCash: "100.00" });
  same("drawer variance after sale and full refund", "0.00", closed.variance);
  bump(x, "promoSales");

  // ---- Tally: propose a move, confirm it once, and try the attacks ----
  const session: Session = { userId: x.userId, orgId: x.orgId, facilityId: x.facilityId, name: "Ext Manager", role: "OWNER", permissions: permissionsFor("OWNER"), roleName: "Owner", customRoleId: null };
  const [p] = await db.select().from(packages).where(and(eq(packages.id, output.id)));
  const dest = p.locationId === x.locA ? x.locB : x.locA;
  const [destRow] = await db.select().from(locations).where(eq(locations.id, dest));
  const events: AssistantEvent[] = [];
  await runAssistant(session, [{ role: "user", content: `move ${output.tag} to ${destRow.name}` }], (e) => events.push(e), new AbortController().signal);
  const proposal = events.find((e) => e.type === "proposal") as Extract<AssistantEvent, { type: "proposal" }> | undefined;
  if (!proposal) note("Tally did not propose the move");
  else {
    const moved = async () => (await db.select({ l: packages.locationId }).from(packages).where(eq(packages.id, output.id)))[0].l;
    if ((await moved()) !== p.locationId) note("Tally moved the package before anyone confirmed");
    const reject = async (what: string, s: Session, token: string) => { try { await confirmProposal(s, token); note(`Tally accepted ${what}`); } catch { /* refused, as it should be */ } };
    await reject("a confirmation from a different person", { ...session, userId: "someone-else" }, proposal.token);
    await reject("a tampered token", session, `${proposal.token}x`);
    await reject("a confirmation from another business", { ...session, orgId: "00000000-0000-0000-0000-000000000000" }, proposal.token);
    await confirmProposal(session, proposal.token);
    if ((await moved()) !== dest) note("Tally's confirmed move did not happen");
    await confirmProposal(session, proposal.token).catch(() => undefined);
    if ((await moved()) !== dest) note("confirming the same card twice moved the package again");
    bump(x, "tallyMoves");
  }
}
