import "server-only";
import Decimal from "decimal.js";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { packages } from "@/db/schema";
import { expandTags, toGrams } from "@/lib/cultivation-math";
import { finishHarvest, logHarvestWaste, packageFromHarvest, recordDryWeight } from "@/lib/cultivation";
import { atomically, db, dryRun } from "@/lib/db";
import { addOrderLine, confirmOrder, createOrder } from "@/lib/distribution";
import { adjustPackage, movePackage, receivePackage, setPackageStatus, type Actor, ADJUST_REASONS } from "@/lib/inventory";
import { InventoryError, normalizeTag } from "@/lib/inventory-math";
import { createPrintJob, LabelError } from "@/lib/labels/service";
import { addRunInput, startRun } from "@/lib/manufacturing";
import { scaleRecipe } from "@/lib/manufacturing-math";
import { can, type Permission } from "@/lib/rbac";
import type { Session } from "@/lib/session";
import { convert, type UnitCode } from "@/lib/units";
import { templateFor } from "./label-tools";
import type { Proposal, Tool } from "./tools";

/**
 * Tally's plans: create the big records from plain English (receiving, wholesale orders, production
 * runs) and run multi-step jobs such as closing out a harvest. Each tool turns the request into a list
 * of steps, runs the whole list for real inside a transaction and rolls it back, so the card shows
 * exactly what Confirm will do and any problem shows up before anything is saved. On Confirm the same
 * steps run again as one all-or-nothing unit, recorded so the whole job can be undone in one click.
 */

const MAX_STEPS = 200;
const TZ = "America/Denver";
type Row = Record<string, unknown>;
type Input = Record<string, unknown>;
const rows = async (q: SQL) => (await db.execute<Row>(q)).rows;
const str = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");
const like = (v: string) => `%${v.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const text = (description: string) => ({ type: "string", description });
const arr = (items: Record<string, unknown>, description: string) => ({ type: "array", items, description });
const UNIT: Record<string, string> = { EACH: "ea", G: "g", KG: "kg", MG: "mg", OZ: "oz", LB: "lb", ML: "ml", L: "L" };
const qty = (amount: Decimal.Value, unit: string) => `${new Decimal(amount).toDecimalPlaces(4).toNumber().toLocaleString("en-US", { maximumFractionDigits: 4 })} ${UNIT[unit] ?? unit}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---------- Steps: plain data, signed into the proposal, run in order on Confirm ----------

export type JobStep = { say: string } & (
  | { k: "receive"; tag: string; itemId: string; quantity: string; locationId: string; vendorId: string | null; lot: string | null; cost: string | null }
  | { k: "order"; customerId: string; destinationId: string | null; notes: string | null }
  | { k: "line"; itemId: string; quantity: string; price: string | null }
  | { k: "confirm_order" }
  | { k: "run"; name: string; recipeId: string; batches: string }
  | { k: "input"; tag: string; quantity: string }
  | { k: "dry"; harvestId: string; grams: string }
  | { k: "pkg_harvest"; harvestId: string; tag: string; itemId: string; quantity: string; locationId: string }
  | { k: "waste"; harvestId: string; grams: string; reason: string }
  | { k: "rest_waste"; harvestId: string; reason: string }
  | { k: "finish"; harvestId: string }
  | { k: "move"; packageId: string; locationId: string }
  | { k: "status"; packageId: string; status: string; reason: string }
  | { k: "adjust"; packageId: string; quantity: string; reasonCode: string; note: string | null }
  | { k: "labels"; tags: string[]; templateId: string }
);

const STEP_PERMISSION: Record<JobStep["k"], Permission> = {
  receive: "inventory.write",
  order: "sales.write",
  line: "sales.write",
  confirm_order: "sales.write",
  run: "manufacturing.write",
  input: "manufacturing.write",
  dry: "cultivation.write",
  pkg_harvest: "cultivation.write",
  waste: "cultivation.write",
  rest_waste: "cultivation.write",
  finish: "cultivation.write",
  move: "inventory.write",
  status: "inventory.adjust",
  adjust: "inventory.adjust",
  labels: "labels.print",
};

/** Every permission a list of steps needs; checked when proposing and again on Confirm. */
export function permissionsFor(steps: JobStep[]): Permission[] {
  return [...new Set(steps.map((s) => STEP_PERMISSION[s.k]))];
}

export type JobResult = { lines: string[]; notes: string[]; orderNumber?: string; runName?: string };

/** Run the steps in order. Must be called inside atomically() or dryRun(), so they save together or not at all. */
export async function runSteps(actor: Actor, steps: JobStep[], key: string): Promise<JobResult> {
  const out: JobResult = { lines: [], notes: [] };
  let orderId: string | null = null;
  let runId: string | null = null;
  for (const [i, step] of steps.entries()) {
    try {
      switch (step.k) {
        case "receive":
          await receivePackage(actor, { tag: step.tag, itemId: step.itemId, quantity: step.quantity, locationId: step.locationId, vendorId: step.vendorId, lotNumber: step.lot, costPerUnit: step.cost });
          break;
        case "order": {
          const order = await createOrder(actor, { customerId: step.customerId, destinationId: step.destinationId ?? undefined, notes: step.notes ?? undefined });
          orderId = order.id;
          out.orderNumber = order.number;
          break;
        }
        case "line": {
          if (!orderId) throw new InventoryError("There is no order to add this line to.");
          await addOrderLine(actor, { orderId, itemId: step.itemId, quantity: step.quantity, unitPrice: step.price ?? undefined });
          const [line] = await rows(sql`select ol.unit_price::text as price from order_lines ol where ol.order_id = ${orderId} and ol.item_id = ${step.itemId}`);
          out.lines.push(`${step.say} @ $${new Decimal(String(line?.price ?? 0)).toFixed(2)} = $${new Decimal(String(line?.price ?? 0)).mul(step.quantity).toFixed(2)}`);
          break;
        }
        case "confirm_order":
          if (!orderId) throw new InventoryError("There is no order to confirm.");
          await confirmOrder(actor, { orderId });
          break;
        case "run": {
          const run = await startRun(actor, { name: step.name, recipeId: step.recipeId, batches: step.batches });
          runId = run.id;
          out.runName = run.name;
          break;
        }
        case "input":
          if (!runId) throw new InventoryError("There is no production run to add this input to.");
          await addRunInput(actor, { runId, tag: step.tag, quantity: step.quantity });
          break;
        case "dry":
          await recordDryWeight(actor, { harvestId: step.harvestId, dryWeight: step.grams, unit: "G" });
          break;
        case "pkg_harvest":
          await packageFromHarvest(actor, { harvestId: step.harvestId, tag: step.tag, itemId: step.itemId, quantity: step.quantity, locationId: step.locationId });
          break;
        case "waste":
          await logHarvestWaste(actor, { harvestId: step.harvestId, weight: step.grams, unit: "G", reason: step.reason });
          break;
        case "rest_waste": {
          const [h] = await rows(sql`select (coalesce(dry_weight, wet_weight) - waste_weight - packaged_weight)::text as left from harvests where id = ${step.harvestId}`);
          const left = new Decimal(String(h?.left ?? "0"));
          if (left.gt(0)) {
            await logHarvestWaste(actor, { harvestId: step.harvestId, weight: left.toString(), unit: "G", reason: step.reason });
            out.lines.push(`Logged the remaining ${qty(left, "G")} as waste (${step.reason})`);
          } else out.lines.push("Nothing was left over to log as waste");
          break;
        }
        case "finish":
          await finishHarvest(actor, { harvestId: step.harvestId });
          break;
        case "move":
          await movePackage(actor, { packageId: step.packageId, toLocationId: step.locationId });
          break;
        case "status":
          await setPackageStatus(actor, { packageId: step.packageId, status: step.status, reason: step.reason });
          break;
        case "adjust":
          await adjustPackage(actor, { packageId: step.packageId, newQuantity: step.quantity, reasonCode: step.reasonCode, note: step.note });
          break;
        case "labels": {
          // Labels never change inventory, so a label problem doesn't stop the job: it runs in its own savepoint.
          try {
            await atomically(async () => {
              const found = await db
                .select({ id: packages.id })
                .from(packages)
                .where(and(eq(packages.orgId, actor.orgId), eq(packages.facilityId, actor.facilityId), inArray(packages.tag, step.tags)));
              const ids = found.map((r) => r.id);
              const { job } = await createPrintJob(actor, { templateId: step.templateId, sourceIds: ids, idempotencyKey: `${key}-labels`.slice(0, 80) });
              out.lines.push(`Print job ready: ${plural(job.labelCount, "label")}. Open SmartLabel AI → Print queue to print.`);
            });
          } catch (error) {
            if (!(error instanceof LabelError || error instanceof InventoryError)) throw error;
            const blocks = error instanceof LabelError ? error.issues.filter((x) => x.severity === "block").slice(0, 3).map((x) => x.message) : [];
            out.notes.push(`Labels were not prepared: ${error.message}${blocks.length ? ` ${blocks.join(" ")}` : ""} Everything else still goes through; fix the labels in SmartLabel AI.`);
          }
          break;
        }
      }
    } catch (error) {
      if (error instanceof InventoryError) throw new InventoryError(`Step ${i + 1} (${step.say}): ${error.message}`);
      throw error;
    }
  }
  return out;
}

/** Turn steps into a proposal card after proving they work against today's data. */
async function propose(
  session: Session,
  tool: string,
  title: string,
  steps: JobStep[],
  details: { label: string; value: string }[],
  describe?: (r: JobResult) => { label: string; value: string }[],
): Promise<Proposal> {
  if (!steps.length) throw new InventoryError("There's nothing to do.");
  if (steps.length > MAX_STEPS) throw new InventoryError(`That's ${steps.length} steps; Tally runs at most ${MAX_STEPS} in one job. Split it up.`);
  const missing = permissionsFor(steps).filter((p) => !can(session, p));
  if (missing.length) throw new InventoryError(`${session.name}'s role doesn't include ${missing.join(", ")}, which this job needs.`);
  const actor: Actor = { userId: session.userId, userName: session.name, orgId: session.orgId, facilityId: session.facilityId };
  const result = await dryRun(() => runSteps(actor, steps, "dryrun00"));
  return {
    title,
    details: [
      ...details,
      ...(describe?.(result) ?? []),
      { label: "Steps", value: `${steps.length}, all or nothing` },
      ...result.notes.map((n) => ({ label: "Heads up", value: n })),
      { label: "Undo", value: "One click after it's done" },
    ],
    steps: steps.map((s) => s.say),
    action: { tool, args: { steps: JSON.stringify(steps) } },
  };
}

async function execute(actor: Actor, args: Record<string, string>, key: string, done: (r: JobResult) => string): Promise<string> {
  const steps = JSON.parse(args.steps) as JobStep[];
  const result = await runSteps(actor, steps, key);
  return [done(result), ...result.lines.filter((l) => l.startsWith("Print job") || l.startsWith("Logged") || l.startsWith("Nothing")), ...result.notes].join(" ");
}

// ---------- Finding things by what people call them ----------

async function pick(kind: string, want: string, found: Row[], label = (r: Row) => String(r.name)): Promise<Row> {
  if (!found.length) throw new InventoryError(`No ${kind} matches "${want}".`);
  const exact = found.filter((r) => label(r).toLowerCase() === want.toLowerCase());
  if (exact.length === 1) return exact[0];
  if (found.length > 1) throw new InventoryError(`Several ${kind}s match "${want}": ${found.slice(0, 8).map(label).join(", ")}. Ask which one.`);
  return found[0];
}

async function findItem(s: Session, want: string) {
  if (!want) throw new InventoryError("Every line needs an item.");
  const found = await rows(sql`select id, name, unit, sku from items where org_id = ${s.orgId} and active
    and (name ilike ${like(want)} or upper(coalesce(sku,'')) = upper(${want})) order by (lower(name) = lower(${want}) or upper(coalesce(sku,'')) = upper(${want})) desc, name limit 10`);
  const exactSku = found.find((r) => String(r.sku ?? "").toUpperCase() === want.toUpperCase());
  return (exactSku ?? (await pick("item", want, found))) as { id: string; name: string; unit: string };
}

async function findLocation(s: Session, want: string) {
  if (!want) throw new InventoryError("Say which location (room or vault) it goes in.");
  const found = await rows(sql`select id, name from locations where org_id = ${s.orgId} and facility_id = ${s.facilityId} and name ilike ${like(want)} order by name limit 10`);
  return (await pick("location", want, found)) as { id: string; name: string };
}

async function findVendor(s: Session, want: string) {
  const found = await rows(sql`select id, name, active, we_buy_from, we_sell_to from customers where org_id = ${s.orgId}
    and (name ilike ${like(want)} or upper(license_number) = upper(${want})) order by name limit 10`);
  return (await pick("vendor", want, found)) as { id: string; name: string; active: boolean; we_buy_from: boolean; we_sell_to: boolean };
}

async function findHarvest(s: Session, want: string) {
  if (!want) throw new InventoryError("Say which harvest (its name).");
  const found = await rows(sql`select id, name, status, location_id, wet_weight::text as wet, dry_weight::text as dry, waste_weight::text as waste, packaged_weight::text as packaged
    from harvests where org_id = ${s.orgId} and facility_id = ${s.facilityId} and name ilike ${like(want)} order by (status = 'DRYING') desc, created_at desc limit 10`);
  const h = (await pick("harvest", want, found)) as { id: string; name: string; status: string; location_id: string; wet: string; dry: string | null; waste: string; packaged: string };
  if (h.status === "FINISHED") throw new InventoryError(`Harvest ${h.name} is already finished.`);
  return h;
}

async function findPackage(s: Session, tag: string) {
  const t = str(tag, 60);
  if (!t) throw new InventoryError("Give the package tag.");
  const found = await rows(sql`select p.id, p.tag, p.quantity::text as quantity, p.unit, p.status, i.name as item from packages p join items i on i.id = p.item_id
    where p.org_id = ${s.orgId} and p.facility_id = ${s.facilityId} and p.tag ilike ${like(t)} order by (upper(p.tag) = upper(${t})) desc limit 6`);
  return (await pick("package", t, found, (r) => String(r.tag))) as { id: string; tag: string; quantity: string; unit: string; status: string; item: string };
}

/** One line can name its tags, or the first tag of a roll and a count. */
function tagsOf(line: Input, fallbackCount = 1): string[] {
  const tags = Array.isArray(line.tags) ? line.tags.map((t) => normalizeTag(t)) : [];
  if (str(line.tag)) tags.push(normalizeTag(line.tag));
  if (str(line.first_tag)) tags.push(...expandTags(line.first_tag, Math.trunc(Number(line.count ?? fallbackCount))));
  return tags;
}

function checkTags(tags: string[]) {
  const seen = new Set<string>();
  for (const t of tags) {
    if (seen.has(t)) throw new InventoryError(`Tag ${t} is listed twice. Every package needs its own tag.`);
    seen.add(t);
  }
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });

async function uniqueRunName(s: Session, base: string): Promise<string> {
  const taken = new Set((await rows(sql`select name from production_runs where facility_id = ${s.facilityId} and name like ${`${base}%`}`)).map((r) => String(r.name)));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  throw new InventoryError("Give the run a name.");
}

const LINE = { type: "object" };

export const JOB_TOOLS: Tool[] = [
  {
    kind: "action",
    name: "receive_packages",
    label: "Planning the receiving",
    permission: "inventory.write",
    description:
      "Receive new packages into inventory from plain English, e.g. 'receive these 12 packages from Green Valley'. Each package needs its own state tag: give tags one by one, or a first_tag and count for a roll of consecutive tags. Shows one card with every package; nothing is saved until Confirm. If the person said how many packages, pass expected_count.",
    schema: obj(
      {
        vendor: text("Who it came from (vendor name or license number). Optional."),
        location: text("Where it is going (room or vault name)."),
        packages: arr(
          {
            ...LINE,
            properties: {
              item: text("Item name or SKU."),
              quantity: text("Quantity in EACH package, in the item's unit."),
              tag: text("One package's tag."),
              tags: { type: "array", items: { type: "string" }, description: "Several packages of this item, one tag each." },
              first_tag: text("First tag of a roll of consecutive tags."),
              count: { type: "integer", description: "How many packages, counting up from first_tag." },
              cost_per_unit: text("Optional cost per unit."),
              lot: text("Optional lot or batch number."),
            },
            required: ["item", "quantity"],
          },
          "One entry per item (with its tags).",
        ),
        expected_count: { type: "integer", description: "How many packages the person said they are receiving." },
      },
      ["location", "packages"],
    ),
    propose: async (s, input) => {
      const location = await findLocation(s, str(input.location));
      const vendor = str(input.vendor) ? await findVendor(s, str(input.vendor)) : null;
      const lines = Array.isArray(input.packages) ? (input.packages as Input[]) : [];
      if (!lines.length) throw new InventoryError("List what is being received.");
      const steps: JobStep[] = [];
      const totals = new Map<string, Decimal>();
      for (const line of lines) {
        const item = await findItem(s, str(line.item));
        const tags = tagsOf(line);
        if (!tags.length)
          throw new InventoryError(`${item.name} has no tags. Every package needs its own state tag: ask for the tags, or the first tag of the roll and how many.`);
        const quantity = str(line.quantity, 30);
        if (!/^\d+(\.\d+)?$/.test(quantity) || Number(quantity) <= 0) throw new InventoryError(`Quantity for ${item.name} must be a number above zero, per package.`);
        for (const tag of tags) {
          steps.push({ k: "receive", say: `Receive ${tag} · ${item.name} · ${qty(quantity, item.unit)}`, tag, itemId: item.id, quantity, locationId: location.id, vendorId: vendor?.id ?? null, lot: str(line.lot) || null, cost: str(line.cost_per_unit, 30) || null });
        }
        totals.set(`${item.name}|${item.unit}`, (totals.get(`${item.name}|${item.unit}`) ?? new Decimal(0)).add(new Decimal(quantity).mul(tags.length)));
      }
      checkTags(steps.map((x) => (x as { tag: string }).tag));
      if (input.expected_count !== undefined && Number(input.expected_count) !== steps.length)
        throw new InventoryError(`The person said ${Number(input.expected_count)} packages, but the tags given make ${steps.length}. Don't pad or trim; tell them and ask which is right.`);
      return propose(s, "receive_packages", `Receive ${plural(steps.length, "package")}`, steps, [
        ...(vendor ? [{ label: "From", value: `${vendor.name}${vendor.we_buy_from ? "" : " (not marked as a vendor you buy from)"}` }] : []),
        { label: "Into", value: location.name },
        ...[...totals].map(([k, v]) => ({ label: k.split("|")[0], value: qty(v, k.split("|")[1]) })),
        { label: "State reporting", value: "Each package is reported as received" },
      ]);
    },
    execute: (actor, args, ctx) => execute(actor, args, ctx?.key ?? "", () => `Received ${plural((JSON.parse(args.steps) as JobStep[]).length, "package")}.`),
  },
  {
    kind: "action",
    name: "create_wholesale_order",
    label: "Planning the order",
    permission: "sales.write",
    description:
      "Create a wholesale order from plain English, e.g. 'make a wholesale order for Dispensary X with 50 Blue Dream 1g and 20 gummy packs'. Prices come from the vendor's price list unless the person gives one. Leaves the order as a draft unless confirm is true. Nothing is saved until Confirm.",
    schema: obj(
      {
        vendor: text("Who the order is for (vendor you sell to)."),
        destination: text("Which of their licensed locations it ships to. Optional; defaults to their first active one."),
        lines: arr({ ...LINE, properties: { item: text("Item name or SKU."), quantity: text("How many, in the item's unit."), unit_price: text("Optional price per unit.") }, required: ["item", "quantity"] }, "The items."),
        notes: text("Optional order notes."),
        confirm: { type: "boolean", description: "Also confirm the order (ready to pick). Default false: stays a draft." },
      },
      ["vendor", "lines"],
    ),
    propose: async (s, input) => {
      const vendor = await findVendor(s, str(input.vendor));
      if (!vendor.we_sell_to) throw new InventoryError(`${vendor.name} isn't marked as a vendor you sell to.`);
      let destinationId: string | null = null;
      let destinationName = "Their first active location";
      if (str(input.destination)) {
        const found = await rows(sql`select id, name from destinations where vendor_id = ${vendor.id} and org_id = ${s.orgId} and name ilike ${like(str(input.destination))} limit 10`);
        const d = (await pick("destination", str(input.destination), found)) as { id: string; name: string };
        destinationId = d.id;
        destinationName = d.name;
      }
      const lines = Array.isArray(input.lines) ? (input.lines as Input[]) : [];
      if (!lines.length) throw new InventoryError("List the items for the order.");
      const steps: JobStep[] = [{ k: "order", say: `Create a draft order for ${vendor.name}`, customerId: vendor.id, destinationId, notes: str(input.notes, 500) || null }];
      for (const line of lines) {
        const item = await findItem(s, str(line.item));
        const quantity = str(line.quantity, 30);
        steps.push({ k: "line", say: `Add ${qty(quantity, item.unit)} ${item.name}`, itemId: item.id, quantity, price: str(line.unit_price, 30).replace("$", "") || null });
      }
      if (input.confirm === true) steps.push({ k: "confirm_order", say: "Confirm the order" });
      return propose(
        s,
        "create_wholesale_order",
        `Wholesale order for ${vendor.name}`,
        steps,
        [
          { label: "Vendor", value: vendor.name },
          { label: "Ships to", value: destinationName },
        ],
        (r) => [
          ...r.lines.map((l, i) => ({ label: `Line ${i + 1}`, value: l.replace(/^Add /, "") })),
          { label: "Total", value: `$${r.lines.reduce((t, l) => t.add(l.split("= $")[1] ?? "0"), new Decimal(0)).toFixed(2)}` },
          { label: "Status after", value: input.confirm === true ? "Confirmed, ready to pick" : "Draft" },
        ],
      );
    },
    execute: (actor, args, ctx) => execute(actor, args, ctx?.key ?? "", (r) => `Order ${r.orderNumber} created. Open it under Distribution → Orders.`),
  },
  {
    kind: "action",
    name: "start_production_run",
    label: "Planning the production run",
    permission: "manufacturing.write",
    description:
      "Start a manufacturing production run from plain English, e.g. 'start a production run of 200 gummy packs'. Finds the recipe by its name or output product, works out batches from the quantity wanted, and by default picks input packages oldest-first and takes them out of stock. Use inputs 'none' to start without taking inputs, or list exact tags. Nothing is saved until Confirm.",
    schema: obj(
      {
        product: text("The recipe name or the product it makes."),
        quantity: text("How much to make, in the output item's unit (e.g. 200). Or give batches instead."),
        batches: text("Number of recipe batches, if the person said batches."),
        name: text("Optional run name; one is made up if left out."),
        inputs: { type: "string", enum: ["auto", "none"], description: "auto (default): pick input packages oldest first. none: start without inputs." },
        input_packages: arr({ ...LINE, properties: { tag: text("Package tag."), quantity: text("How much to use.") }, required: ["tag", "quantity"] }, "Exact inputs, if the person named them."),
      },
      ["product"],
    ),
    propose: async (s, input) => {
      const want = str(input.product);
      const found = await rows(sql`select b.id, b.name, b.output_quantity::text as output, i.name as item, i.unit from boms b join items i on i.id = b.output_item_id
        where b.org_id = ${s.orgId} and b.active and (b.name ilike ${like(want)} or i.name ilike ${like(want)}) order by b.name limit 10`);
      const recipe = (await pick("recipe", want, found)) as { id: string; name: string; output: string; item: string; unit: string };
      let batches: Decimal;
      if (str(input.batches)) batches = new Decimal(str(input.batches));
      else if (str(input.quantity)) batches = new Decimal(str(input.quantity)).div(recipe.output).toDecimalPlaces(4, Decimal.ROUND_UP);
      else throw new InventoryError("Say how much to make, or how many batches.");
      const lines = (await rows(sql`select l.item_id, l.quantity::text as quantity, i.name, i.unit from bom_lines l join items i on i.id = l.item_id where l.bom_id = ${recipe.id}`)) as {
        item_id: string;
        quantity: string;
        name: string;
        unit: string;
      }[];
      const scaled = scaleRecipe({ outputQuantity: recipe.output, lines: lines.map((l) => ({ itemId: l.item_id, quantity: l.quantity })) }, batches);
      const name = str(input.name) || (await uniqueRunName(s, `RUN-${today().replaceAll("-", "").slice(2)}`));
      const steps: JobStep[] = [{ k: "run", say: `Start run ${name}: ${batches.toString()} batch${batches.eq(1) ? "" : "es"} of ${recipe.name}`, name, recipeId: recipe.id, batches: batches.toString() }];
      const given = Array.isArray(input.input_packages) ? (input.input_packages as Input[]) : [];
      if (given.length) {
        for (const g of given) {
          const pkg = await findPackage(s, str(g.tag));
          steps.push({ k: "input", say: `Use ${qty(str(g.quantity), pkg.unit)} from ${pkg.tag} (${pkg.item})`, tag: pkg.tag, quantity: str(g.quantity, 30) });
        }
      } else if (str(input.inputs) !== "none") {
        const short: string[] = [];
        for (const [itemId, needed] of scaled.needs) {
          const line = lines.find((l) => l.item_id === itemId)!;
          let left = new Decimal(needed);
          const stock = (await rows(sql`select tag, quantity::text as quantity, unit from packages where org_id = ${s.orgId} and facility_id = ${s.facilityId}
            and item_id = ${itemId} and status = 'ACTIVE' and quantity > 0 order by created_at, tag limit 100`)) as { tag: string; quantity: string; unit: string }[];
          for (const p of stock) {
            if (left.lte(0)) break;
            const take = Decimal.min(left, p.quantity);
            steps.push({ k: "input", say: `Use ${qty(take, p.unit)} from ${p.tag} (${line.name})`, tag: p.tag, quantity: take.toString() });
            left = left.sub(take);
          }
          if (left.gt(0)) short.push(`${line.name}: short ${qty(left, line.unit)}`);
        }
        if (short.length)
          throw new InventoryError(`Not enough active stock for this run (${short.join("; ")}). Ask whether to make less, or start the run without inputs (inputs: none) and add them later.`);
      }
      return propose(s, "start_production_run", `Start production run ${name}`, steps, [
        { label: "Recipe", value: recipe.name },
        { label: "Makes", value: `${qty(scaled.plannedOutput, recipe.unit)} ${recipe.item} (planned)` },
        { label: "Inputs", value: steps.length > 1 ? `${plural(steps.length - 1, "package")}, taken out of stock now` : "None yet; add them on the run's page" },
      ]);
    },
    execute: (actor, args, ctx) => execute(actor, args, ctx?.key ?? "", (r) => `Production run ${r.runName} started. Finish it under Manufacturing when it's done.`),
  },
  {
    kind: "action",
    name: "close_out_harvest",
    label: "Planning the harvest close-out",
    permission: "cultivation.write",
    description:
      "Close out a harvest in one go: record the dry weight, package it into new tagged packages, log the waste, prepare package labels, and finish the harvest. Shows the whole plan with the weight math; one Confirm runs it all or nothing. If weight would be left over, ask whether it's waste (rest_is_waste) before proposing.",
    schema: obj(
      {
        harvest: text("Harvest name."),
        dry_weight: text("Final dry weight, if not already recorded."),
        unit: { type: "string", enum: ["G", "KG", "OZ", "LB"], description: "Unit for dry_weight and waste weights. Default G." },
        packages: arr(
          {
            ...LINE,
            properties: {
              item: text("Item (tracked by weight), e.g. bulk flower or trim."),
              quantity: text("Quantity in each package, in the item's unit."),
              tag: text("One package's tag."),
              tags: { type: "array", items: { type: "string" } },
              first_tag: text("First tag of a roll."),
              count: { type: "integer" },
            },
            required: ["item", "quantity"],
          },
          "Packages to make.",
        ),
        location: text("Where the new packages go. Default: the harvest's room."),
        waste: arr({ ...LINE, properties: { weight: text("Waste weight."), reason: text("What it is, e.g. stems.") }, required: ["weight", "reason"] }, "Waste to log."),
        rest_is_waste: text("If whatever weight is left over is waste, say what it is (e.g. 'stems and trim'). Leave out otherwise."),
        labels: { type: "boolean", description: "Prepare package labels for the new packages. Default true." },
        label_template: text("Label template name; default template if left out."),
        finish: { type: "boolean", description: "Finish the harvest at the end. Default true." },
      },
      ["harvest"],
    ),
    propose: async (s, input) => {
      const h = await findHarvest(s, str(input.harvest));
      const unit = (str(input.unit) || "G").toUpperCase();
      const steps: JobStep[] = [];
      let dry = h.dry ? new Decimal(h.dry) : null;
      if (str(input.dry_weight)) {
        const grams = toGrams(str(input.dry_weight), unit, "Dry weight");
        steps.push({ k: "dry", say: `Record dry weight ${qty(grams, "G")}`, harvestId: h.id, grams: grams.toString() });
        dry = grams;
      }
      if (!dry) throw new InventoryError(`Harvest ${h.name} has no dry weight yet. Ask for the final dry weight.`);
      const location = str(input.location) ? await findLocation(s, str(input.location)) : { id: h.location_id, name: "the harvest's room" };
      let packagedG = new Decimal(0);
      const newTags: string[] = [];
      for (const line of Array.isArray(input.packages) ? (input.packages as Input[]) : []) {
        const item = await findItem(s, str(line.item));
        const tags = tagsOf(line);
        if (!tags.length) throw new InventoryError(`${item.name} has no tags. Every package needs its own state tag.`);
        const quantity = str(line.quantity, 30);
        if (!/^\d+(\.\d+)?$/.test(quantity)) throw new InventoryError(`Quantity for ${item.name} must be a number, per package.`);
        for (const tag of tags) {
          steps.push({ k: "pkg_harvest", say: `Package ${qty(quantity, item.unit)} ${item.name} as ${tag}`, harvestId: h.id, tag, itemId: item.id, quantity, locationId: location.id });
          newTags.push(tag);
          packagedG = packagedG.add(convert(new Decimal(quantity), item.unit as UnitCode, "G"));
        }
      }
      checkTags(newTags);
      let wasteG = new Decimal(0);
      for (const w of Array.isArray(input.waste) ? (input.waste as Input[]) : []) {
        const grams = toGrams(str(w.weight), unit, "Waste weight");
        steps.push({ k: "waste", say: `Log ${qty(grams, "G")} waste: ${str(w.reason, 200)}`, harvestId: h.id, grams: grams.toString(), reason: str(w.reason, 200) });
        wasteG = wasteG.add(grams);
      }
      const left = dry.sub(h.waste).sub(h.packaged).sub(packagedG).sub(wasteG).toDecimalPlaces(4);
      if (left.lt(0)) throw new InventoryError(`That's ${qty(left.neg(), "G")} more than the harvest has (dry ${qty(dry, "G")}, already used ${qty(new Decimal(h.waste).add(h.packaged), "G")}). Check the numbers.`);
      if (left.gt(0) && str(input.rest_is_waste)) steps.push({ k: "rest_waste", say: `Log the remaining ${qty(left, "G")} as waste: ${str(input.rest_is_waste, 200)}`, harvestId: h.id, reason: str(input.rest_is_waste, 200) });
      const finish = input.finish !== false;
      if (finish && left.gt(0) && !str(input.rest_is_waste))
        throw new InventoryError(`${qty(left, "G")} of ${h.name} would be unaccounted for, so it can't be finished. Ask whether that's waste (and what kind), or another package.`);
      if (finish) steps.push({ k: "finish", say: `Finish harvest ${h.name}`, harvestId: h.id });
      let labelNote: string | null = null;
      if (input.labels !== false && newTags.length) {
        if (!can(s, "labels.print")) labelNote = "Skipped: your role can't print labels";
        else {
          try {
            steps.push({ k: "labels", say: `Prepare ${plural(newTags.length, "package label")}`, tags: newTags, templateId: await templateFor(s, "PACKAGE", str(input.label_template)) });
          } catch (error) {
            if (!(error instanceof InventoryError) || str(input.label_template)) throw error;
            labelNote = "Skipped: no package label template yet (SmartLabel AI → Templates)";
          }
        }
      }
      return propose(s, "close_out_harvest", `Close out harvest ${h.name}`, steps, [
        { label: "Dry weight", value: qty(dry, "G") },
        { label: "Into packages", value: `${qty(packagedG, "G")} in ${plural(newTags.length, "package")}${new Decimal(h.packaged).gt(0) ? ` (+${qty(h.packaged, "G")} already)` : ""}` },
        { label: "Waste", value: qty(wasteG.add(h.waste).add(left.gt(0) && str(input.rest_is_waste) ? left : 0), "G") },
        { label: "Left over", value: left.gt(0) && !str(input.rest_is_waste) ? qty(left, "G") : "0 g" },
        ...(labelNote ? [{ label: "Labels", value: labelNote }] : []),
      ]);
    },
    execute: (actor, args, ctx) => execute(actor, args, ctx?.key ?? "", () => "Harvest closed out."),
  },
  {
    kind: "action",
    name: "run_job",
    label: "Planning the job",
    permission: "inventory.write",
    description:
      "Run several package changes as one job with one Confirm: moves, holds and releases, quantity adjustments, and package labels, in order. Use for requests like 'move these 6 packages to Vault B, put 1A4..0003 on hold for a retest, and print labels'. For receiving, orders, production runs, or harvest close-outs, use their own tools instead.",
    schema: obj(
      {
        title: text("Short name for the job, e.g. 'Restock the vault'."),
        steps: arr(
          {
            ...LINE,
            properties: {
              action: { type: "string", enum: ["move", "hold", "quarantine", "release", "adjust", "labels"] },
              tag: text("Package tag (all but labels)."),
              tags: { type: "array", items: { type: "string" }, description: "Several package tags: the same action applies to each (labels: the packages to label)." },
              to_location: text("move: destination location."),
              reason: text("hold/quarantine/release: why (required). adjust: optional note."),
              new_quantity: text("adjust: the corrected total."),
              reason_code: { type: "string", enum: ADJUST_REASONS.map((r) => r.code) },
              template: text("labels: template name, optional."),
            },
            required: ["action"],
          },
          "The steps, in order.",
        ),
      },
      ["steps"],
    ),
    propose: async (s, input) => {
      const steps: JobStep[] = [];
      for (const raw of Array.isArray(input.steps) ? (input.steps as Input[]) : []) {
        const action = str(raw.action);
        const tags = [...(Array.isArray(raw.tags) ? raw.tags.map((t) => str(t, 60)) : []), ...(str(raw.tag) ? [str(raw.tag, 60)] : [])].filter(Boolean);
        if (!tags.length) throw new InventoryError(`The ${action || "unnamed"} step needs at least one package tag.`);
        if (action === "labels") {
          const pkgs = await Promise.all(tags.map((t) => findPackage(s, t)));
          steps.push({ k: "labels", say: `Prepare ${plural(pkgs.length, "package label")}`, tags: pkgs.map((p) => p.tag), templateId: await templateFor(s, "PACKAGE", str(raw.template)) });
          continue;
        }
        const to = action === "move" ? await findLocation(s, str(raw.to_location)) : null;
        for (const t of tags) {
          const pkg = await findPackage(s, t);
          if (action === "move") steps.push({ k: "move", say: `Move ${pkg.tag} (${pkg.item}) to ${to!.name}`, packageId: pkg.id, locationId: to!.id });
          else if (action === "hold" || action === "quarantine" || action === "release") {
            const reason = str(raw.reason, 300);
            if (!reason) throw new InventoryError(`Say why ${pkg.tag} is being ${action === "release" ? "released" : action === "hold" ? "held" : "quarantined"}. It goes in the audit trail.`);
            const status = action === "hold" ? "ON_HOLD" : action === "quarantine" ? "QUARANTINE" : "ACTIVE";
            steps.push({ k: "status", say: `${action === "release" ? "Release" : action === "hold" ? "Hold" : "Quarantine"} ${pkg.tag} (${reason})`, packageId: pkg.id, status, reason });
          } else if (action === "adjust") {
            const q = str(raw.new_quantity, 30);
            const code = ADJUST_REASONS.find((r) => r.code === str(raw.reason_code));
            if (!code) throw new InventoryError(`Adjusting ${pkg.tag} needs a reason code.`);
            steps.push({ k: "adjust", say: `Set ${pkg.tag} from ${qty(pkg.quantity, pkg.unit)} to ${qty(q || "0", pkg.unit)} (${code.label})`, packageId: pkg.id, quantity: q, reasonCode: code.code, note: str(raw.reason, 300) || null });
          } else throw new InventoryError(`Unknown step "${action}".`);
        }
      }
      return propose(s, "run_job", str(input.title, 80) || "Job", steps, []);
    },
    execute: (actor, args, ctx) => execute(actor, args, ctx?.key ?? "", () => "Job done."),
  },
];
