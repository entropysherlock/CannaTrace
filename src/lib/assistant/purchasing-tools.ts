import "server-only";
import Decimal from "decimal.js";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { InventoryError, parseCost, parsePositiveQty } from "@/lib/inventory-math";
import { addPurchaseOrderLine, changePurchaseOrder, createPurchaseOrder, receivePurchaseOrder } from "@/lib/purchasing";
import type { Session } from "@/lib/session";
import type { Tool } from "./tools";

/** Purchase orders for Tally and the AI connector: list them, start one from plain English, and receive against one. */

type Row = Record<string, unknown>;
type Input = Record<string, unknown>;
const rows = async (q: SQL) => (await db.execute<Row>(q)).rows;
const str = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");
const like = (v: string) => `%${v.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const text = (description: string) => ({ type: "string", description });
const num = (v: unknown) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 4 });

function pick<T extends Row>(kind: string, want: string, found: T[], label: (r: T) => string = (r) => String(r.name)): T {
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
  return (exactSku ?? pick("item", want, found)) as { id: string; name: string; unit: string };
}

async function findPo(s: Session, want: string) {
  const w = str(want, 40);
  if (!w) throw new InventoryError("Say which purchase order (its number, like PO-00003).");
  const found = await rows(sql`select po.id, po.number, po.status, c.name as vendor from purchase_orders po join customers c on c.id = po.vendor_id
    where po.org_id = ${s.orgId} and po.facility_id = ${s.facilityId} and po.number ilike ${like(w)} order by po.created_at desc limit 6`);
  return pick("purchase order", w, found, (r) => String(r.number)) as { id: string; number: string; status: string; vendor: string };
}

export const PURCHASING_TOOLS: Tool[] = [
  {
    kind: "read",
    name: "purchase_orders",
    label: "Looking at purchase orders",
    permission: "inventory.view",
    description: "Purchase orders at this facility: number, vendor, status (DRAFT, SENT, PARTIAL, RECEIVED, CANCELLED), expected date, total, and each line's ordered, received and still-due quantities. Filter by status or vendor.",
    schema: obj({
      status: { type: "string", enum: ["DRAFT", "SENT", "PARTIAL", "RECEIVED", "CANCELLED", "OPEN"], description: "OPEN means draft, sent or partly received." },
      vendor: text("Part of a vendor name."),
      limit: { type: "integer" },
    }),
    run: async (s, input) => {
      const status = str(input.status);
      const statusFilter = status === "OPEN" ? sql`and po.status in ('DRAFT','SENT','PARTIAL')` : status ? sql`and po.status = ${status}` : sql``;
      const vendor = str(input.vendor);
      const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
      const pos = await rows(sql`select po.id, po.number, c.name as vendor, po.status, po.expected_on, po.created_at::date::text as created
        from purchase_orders po join customers c on c.id = po.vendor_id
        where po.org_id = ${s.orgId} and po.facility_id = ${s.facilityId} ${statusFilter} ${vendor ? sql`and c.name ilike ${like(vendor)}` : sql``}
        order by po.created_at desc limit ${limit}`);
      if (!pos.length) return [];
      const lines = await rows(sql`select l.purchase_order_id, i.name as item, i.unit, l.quantity::text as ordered, l.quantity_received::text as received,
          greatest(l.quantity - l.quantity_received, 0)::text as due, l.unit_cost::text as unit_cost
        from purchase_order_lines l join items i on i.id = l.item_id
        where l.purchase_order_id in (${sql.join(pos.map((p) => sql`${p.id}`), sql`, `)}) order by i.name`);
      return pos.map((p) => {
        const mine = lines.filter((l) => l.purchase_order_id === p.id);
        const total = mine.reduce((t, l) => t.add(new Decimal(String(l.ordered)).mul(String(l.unit_cost ?? 0)).toDecimalPlaces(2)), new Decimal(0));
        return {
          number: p.number,
          vendor: p.vendor,
          status: p.status,
          expected: p.expected_on,
          created: p.created,
          total: total.toFixed(2),
          lines: mine.map((l) => ({ item: l.item, unit: l.unit, ordered: num(l.ordered), received: num(l.received), still_due: num(l.due), unit_cost: l.unit_cost ? new Decimal(String(l.unit_cost)).toString() : null })),
        };
      });
    },
  },
  {
    kind: "action",
    name: "create_purchase_order",
    label: "Planning the purchase order",
    permission: "inventory.write",
    description:
      "Create a purchase order to a vendor you buy from, from plain English, e.g. 'order 100 Blue Mesa 3.5 g jars at $12.50 from Green Valley, arriving Friday'. Leaves it a draft unless mark_sent is true. Nothing is saved until Confirm.",
    schema: obj(
      {
        vendor: text("Vendor name or license number (a business you buy from)."),
        lines: {
          type: "array",
          description: "What is being ordered.",
          items: { type: "object", properties: { item: text("Item name or SKU."), quantity: text("How many, in the item's unit."), unit_cost: text("Optional cost per unit.") }, required: ["item", "quantity"] },
        },
        expected_on: text("When it should arrive, YYYY-MM-DD. Optional."),
        notes: text("Optional notes."),
        mark_sent: { type: "boolean", description: "Also mark it sent to the vendor. Default false." },
      },
      ["vendor", "lines"],
    ),
    propose: async (s, input) => {
      const want = str(input.vendor);
      if (!want) throw new InventoryError("Say which vendor it's from.");
      const found = await rows(sql`select id, name, active, we_buy_from from customers where org_id = ${s.orgId}
        and (name ilike ${like(want)} or upper(license_number) = upper(${want})) order by name limit 10`);
      const vendor = pick("vendor", want, found) as { id: string; name: string; active: boolean; we_buy_from: boolean };
      if (!vendor.active) throw new InventoryError(`${vendor.name} is marked inactive.`);
      if (!vendor.we_buy_from) throw new InventoryError(`${vendor.name} isn't marked as a vendor you buy from. Turn on "We buy from them" on their page first.`);
      const expected = str(input.expected_on, 10);
      if (expected && !/^\d{4}-\d{2}-\d{2}$/.test(expected)) throw new InventoryError("Expected date must look like 2026-12-04.");
      const given = Array.isArray(input.lines) ? (input.lines as Input[]) : [];
      if (!given.length) throw new InventoryError("List what's being ordered.");
      const lines: { itemId: string; quantity: string; unitCost: string }[] = [];
      const shown: { label: string; value: string }[] = [];
      let total = new Decimal(0);
      const seen = new Set<string>();
      for (const [i, l] of given.entries()) {
        const item = await findItem(s, str(l.item));
        if (seen.has(item.id)) throw new InventoryError(`${item.name} is listed twice. Put it on one line.`);
        seen.add(item.id);
        const quantity = parsePositiveQty(str(l.quantity, 30));
        const costText = str(l.unit_cost, 30).replace("$", "");
        const cost = costText ? parseCost(costText) : null;
        if (cost) total = total.add(quantity.mul(cost).toDecimalPlaces(2));
        lines.push({ itemId: item.id, quantity: quantity.toString(), unitCost: cost ? cost.toString() : "" });
        shown.push({ label: `Line ${i + 1}`, value: `${num(quantity.toString())} ${item.unit.toLowerCase()} ${item.name}${cost ? ` at $${cost.toString()} = $${quantity.mul(cost).toFixed(2)}` : " (no cost)"}` });
      }
      return {
        title: `Purchase order to ${vendor.name}`,
        details: [
          { label: "Vendor", value: vendor.name },
          ...shown,
          { label: "Total", value: `$${total.toFixed(2)}` },
          ...(expected ? [{ label: "Expected", value: expected }] : []),
          { label: "Status after", value: input.mark_sent === true ? "Sent to the vendor" : "Draft" },
        ],
        action: {
          tool: "create_purchase_order",
          args: { vendorId: vendor.id, lines: JSON.stringify(lines), expectedOn: expected, notes: str(input.notes, 500), send: input.mark_sent === true ? "1" : "" },
        },
      };
    },
    execute: async (actor, a) => {
      const po = await createPurchaseOrder(actor, { vendorId: a.vendorId, expectedOn: a.expectedOn, notes: a.notes });
      for (const l of JSON.parse(a.lines) as { itemId: string; quantity: string; unitCost: string }[]) {
        await addPurchaseOrderLine(actor, { purchaseOrderId: po.id, itemId: l.itemId, quantity: l.quantity, unitCost: l.unitCost });
      }
      if (a.send) await changePurchaseOrder(actor, { purchaseOrderId: po.id, step: "send" });
      return `Purchase order ${po.number} created${a.send ? " and marked sent" : " as a draft"}. Open it under Inventory → Purchase orders.`;
    },
  },
  {
    kind: "action",
    name: "receive_purchase_order",
    label: "Planning the receipt",
    permission: "inventory.write",
    description:
      "Receive against a purchase order: with no lines, everything still due comes in (one new package per line, generated tags, at the line's cost). Or list what actually arrived per item, with optional tags and lots. Nothing is saved until Confirm. Never invent tags; leave them out to generate.",
    schema: obj(
      {
        purchase_order: text("The PO number, like PO-00003."),
        location: text("Where the packages are put away (room or vault name)."),
        lines: {
          type: "array",
          description: "Optional. What arrived, per item. Leave out to receive everything still due.",
          items: { type: "object", properties: { item: text("Item name or SKU on the PO."), quantity: text("How much arrived."), tag: text("Optional state tag."), lot: text("Optional lot number.") }, required: ["item", "quantity"] },
        },
      },
      ["purchase_order", "location"],
    ),
    propose: async (s, input) => {
      const po = await findPo(s, str(input.purchase_order));
      if (!["DRAFT", "SENT", "PARTIAL"].includes(po.status)) throw new InventoryError(`${po.number} is ${po.status.toLowerCase()}, so nothing more can be received on it.`);
      const wantLoc = str(input.location);
      if (!wantLoc) throw new InventoryError("Say where the packages go (room or vault).");
      const locs = await rows(sql`select id, name from locations where org_id = ${s.orgId} and facility_id = ${s.facilityId} and name ilike ${like(wantLoc)} order by name limit 10`);
      const location = pick("location", wantLoc, locs) as { id: string; name: string };
      const due = (await rows(sql`select l.id, i.id as item_id, i.name, i.sku, i.unit, greatest(l.quantity - l.quantity_received, 0)::text as due
        from purchase_order_lines l join items i on i.id = l.item_id where l.purchase_order_id = ${po.id} order by i.name`)) as {
        id: string;
        item_id: string;
        name: string;
        sku: string;
        unit: string;
        due: string;
      }[];
      const given = Array.isArray(input.lines) ? (input.lines as Input[]) : [];
      const plan: { lineId: string; quantity: string; tag: string; lot: string; name: string; unit: string }[] = [];
      if (!given.length) {
        for (const d of due) if (Number(d.due) > 0) plan.push({ lineId: d.id, quantity: new Decimal(d.due).toString(), tag: "", lot: "", name: d.name, unit: d.unit });
        if (!plan.length) throw new InventoryError(`Everything on ${po.number} has been received.`);
      } else {
        for (const g of given) {
          const want = str(g.item).toLowerCase();
          const matches = due.filter((d) => d.name.toLowerCase() === want || String(d.sku ?? "").toLowerCase() === want || d.name.toLowerCase().includes(want));
          const d = matches.length === 1 ? matches[0] : matches.find((m) => m.name.toLowerCase() === want);
          if (!d) throw new InventoryError(matches.length ? `Several lines on ${po.number} match "${str(g.item)}". Ask which one.` : `"${str(g.item)}" is not on ${po.number}.`);
          const quantity = parsePositiveQty(str(g.quantity, 30));
          if (quantity.gt(d.due)) throw new InventoryError(`${d.name}: ${quantity} is more than the ${num(d.due)} still due on ${po.number}.`);
          plan.push({ lineId: d.id, quantity: quantity.toString(), tag: str(g.tag, 60), lot: str(g.lot, 100), name: d.name, unit: d.unit });
        }
      }
      return {
        title: `Receive ${po.number} from ${po.vendor}`,
        details: [
          { label: "Purchase order", value: `${po.number} · ${po.vendor}` },
          { label: "Into", value: location.name },
          ...plan.map((p, i) => ({ label: `Package ${i + 1}`, value: `${num(p.quantity)} ${p.unit.toLowerCase()} ${p.name}${p.tag ? `, tag ${p.tag}` : ", new tag"}${p.lot ? `, lot ${p.lot}` : ""}` })),
          { label: "State reporting", value: "Each package is reported as received" },
        ],
        action: { tool: "receive_purchase_order", args: { purchaseOrderId: po.id, locationId: location.id, lines: JSON.stringify(plan.map(({ lineId, quantity, tag, lot }) => ({ lineId, quantity, tag, lot }))) } },
      };
    },
    execute: async (actor, a) => {
      const lines = (JSON.parse(a.lines) as { lineId: string; quantity: string; tag: string; lot: string }[]).map((l) => ({ lineId: l.lineId, quantity: l.quantity, tag: l.tag || null, lotNumber: l.lot || null }));
      const { po, packages } = await receivePurchaseOrder(actor, { purchaseOrderId: a.purchaseOrderId, locationId: a.locationId, lines });
      return `Received ${packages.length} package${packages.length === 1 ? "" : "s"} on ${po.number} (${packages.map((p) => p.tag).join(", ")}). It is now ${po.status.toLowerCase()}.`;
    },
  },
];
