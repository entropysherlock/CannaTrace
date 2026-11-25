import "server-only";
import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  customers,
  destinations,
  itemCategories,
  items,
  priceLists,
  retailPrices,
} from "@/db/schema";
import { cleanItemChanges, updateItems } from "@/lib/bulk-items";
import { db } from "@/lib/db";
import {
  cleanDestinationChanges,
  cleanVendorChanges,
  updateDestinations,
  updateVendors,
} from "@/lib/distribution";
import { InventoryError } from "@/lib/inventory-math";
import { can } from "@/lib/rbac";
import type { Session } from "@/lib/session";
import type { Tool } from "./tools";

/**
 * Bulk edits for Tally: find records by plain descriptions, show one card listing every record and
 * change, and apply them all (or none) when the person presses Confirm. Each tool needs the same
 * permission as the screen it replaces, and every record gets its own audit entry.
 */

export const BULK_MAX = 200;
type Input = Record<string, unknown>;
const str = (v: unknown, max = 100) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const list = (v: unknown, max = 200) =>
  (Array.isArray(v) ? v : typeof v === "string" && v ? v.split(",") : [])
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, max);
const like = (v: string) => `%${v.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
const bool = (v: unknown): boolean | undefined =>
  v === true || v === "true"
    ? true
    : v === false || v === "false"
      ? false
      : undefined;
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
});
const text = (description: string) => ({ type: "string", description });
const strings = (description: string) => ({
  type: "array",
  items: { type: "string" },
  description,
});
const flag = (description: string) => ({ type: "boolean", description });

/** "Alpha, Beta, Gamma … and 12 more" */
function preview(names: string[], shown = 12): string {
  return names.length <= shown
    ? names.join(", ")
    : `${names.slice(0, shown).join(", ")} … and ${names.length - shown} more`;
}

function checkCount<T>(rows: T[], what: string): T[] {
  if (rows.length === 0)
    throw new InventoryError(`No ${what} match that. Nothing to change.`);
  if (rows.length > BULK_MAX)
    throw new InventoryError(
      `That matches ${rows.length} ${what}, more than the ${BULK_MAX} Tally changes at once. Narrow it down.`,
    );
  return rows;
}

function changeLines(
  changes: Record<string, unknown>,
  labels: Record<string, string>,
): { label: string; value: string }[] {
  return Object.entries(changes).map(([k, v]) => ({
    label: labels[k] ?? k,
    value:
      v === null
        ? "→ (cleared)"
        : typeof v === "boolean"
          ? `→ ${v ? "yes" : "no"}`
          : `→ ${String(v)}`,
  }));
}

// ---------- Items ----------

const ITEM_MATCH = {
  skus: strings("Exact SKUs."),
  names: strings("Exact item names."),
  name_contains: text("Part of the item name, e.g. 'pre-roll'."),
  category: text("Current category name."),
  strain: text("Current strain name."),
  include_inactive: flag("Also match archived items."),
};

async function matchItems(s: Session, input: Input) {
  const m = (input.match ?? input) as Input;
  const where: SQL[] = [eq(items.orgId, s.orgId)];
  const skus = list(m.skus).map((x) => x.toUpperCase());
  const names = list(m.names);
  if (skus.length || names.length) {
    const any: SQL[] = [];
    if (skus.length) any.push(inArray(sql`upper(${items.sku})`, skus));
    if (names.length)
      any.push(
        inArray(
          sql`lower(${items.name})`,
          names.map((n) => n.toLowerCase()),
        ),
      );
    where.push(or(...any)!);
  }
  if (str(m.name_contains))
    where.push(ilike(items.name, like(str(m.name_contains))));
  if (str(m.strain)) where.push(ilike(items.strain, str(m.strain)));
  if (str(m.category)) where.push(ilike(itemCategories.name, str(m.category)));
  if (bool(m.include_inactive) !== true) where.push(eq(items.active, true));
  if (
    !skus.length &&
    !names.length &&
    !str(m.name_contains) &&
    !str(m.strain) &&
    !str(m.category)
  )
    throw new InventoryError(
      "Say which items: by name, SKU, part of the name, category, or strain.",
    );
  const rows = await db
    .select({ id: items.id, name: items.name, sku: items.sku })
    .from(items)
    .innerJoin(itemCategories, eq(itemCategories.id, items.categoryId))
    .where(and(...where))
    .orderBy(asc(items.name))
    .limit(BULK_MAX + 1);
  return checkCount(rows, "items");
}

const ITEM_LABELS = {
  category: "Category",
  strain: "Strain",
  active: "Active",
  limitCategory: "Counts toward limit",
  limitPerUnit: "Each unit counts",
  retailPrice: "Shelf price",
};

// ---------- Vendors ----------

const VENDOR_MATCH = {
  names: strings("Exact vendor names."),
  name_contains: text("Part of the vendor name."),
  license_numbers: strings("Vendor license numbers."),
  we_sell_to: flag("Only vendors you sell to."),
  we_buy_from: flag("Only vendors you buy from."),
  include_inactive: flag("Also match inactive vendors."),
  all: flag("Every vendor. Only when the person clearly means all of them."),
};

async function matchVendors(s: Session, input: Input) {
  const m = (input.match ?? input) as Input;
  const where: SQL[] = [eq(customers.orgId, s.orgId)];
  const names = list(m.names);
  const licenses = list(m.license_numbers).map((x) => x.toUpperCase());
  let narrowed = bool(m.all) === true;
  if (names.length) {
    where.push(
      inArray(
        sql`lower(${customers.name})`,
        names.map((n) => n.toLowerCase()),
      ),
    );
    narrowed = true;
  }
  if (licenses.length) {
    where.push(inArray(customers.licenseNumber, licenses));
    narrowed = true;
  }
  if (str(m.name_contains)) {
    where.push(ilike(customers.name, like(str(m.name_contains))));
    narrowed = true;
  }
  if (bool(m.we_sell_to) !== undefined) {
    where.push(eq(customers.weSellTo, bool(m.we_sell_to)!));
    narrowed = true;
  }
  if (bool(m.we_buy_from) !== undefined) {
    where.push(eq(customers.weBuyFrom, bool(m.we_buy_from)!));
    narrowed = true;
  }
  if (bool(m.include_inactive) !== true) where.push(eq(customers.active, true));
  if (!narrowed)
    throw new InventoryError(
      "Say which vendors: by name, part of the name, license, or whether you sell to or buy from them.",
    );
  const rows = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(and(...where))
    .orderBy(asc(customers.name))
    .limit(BULK_MAX + 1);
  return checkCount(rows, "vendors");
}

const VENDOR_LABELS = {
  contactName: "Contact",
  email: "Email",
  phone: "Phone",
  address: "Address",
  paymentTermsDays: "Payment terms (days)",
  priceListId: "Price list",
  active: "Active",
  weSellTo: "We sell to them",
  weBuyFrom: "We buy from them",
  name: "Name",
};

// ---------- Destinations ----------

const DESTINATION_MATCH = {
  vendor: text("Vendor name (or part of it) whose destinations to change."),
  names: strings("Exact destination names."),
  name_contains: text("Part of the destination name."),
  license_numbers: strings("Destination license numbers."),
  license_expires_before: text(
    "YYYY-MM-DD: destinations whose license expires on or before this date.",
  ),
  include_inactive: flag("Also match inactive destinations."),
};

async function matchDestinations(s: Session, input: Input) {
  const m = (input.match ?? input) as Input;
  const where: SQL[] = [eq(destinations.orgId, s.orgId)];
  let narrowed = false;
  if (str(m.vendor)) {
    where.push(ilike(customers.name, like(str(m.vendor))));
    narrowed = true;
  }
  const names = list(m.names);
  if (names.length) {
    where.push(
      inArray(
        sql`lower(${destinations.name})`,
        names.map((n) => n.toLowerCase()),
      ),
    );
    narrowed = true;
  }
  if (str(m.name_contains)) {
    where.push(ilike(destinations.name, like(str(m.name_contains))));
    narrowed = true;
  }
  const licenses = list(m.license_numbers).map((x) => x.toUpperCase());
  if (licenses.length) {
    where.push(inArray(destinations.licenseNumber, licenses));
    narrowed = true;
  }
  const before = str(m.license_expires_before, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(before)) {
    where.push(lte(destinations.licenseExpires, before));
    narrowed = true;
  }
  if (bool(m.include_inactive) !== true)
    where.push(eq(destinations.active, true));
  if (!narrowed)
    throw new InventoryError(
      "Say which destinations: by vendor, name, license number, or license expiry.",
    );
  const rows = await db
    .select({
      id: destinations.id,
      name: destinations.name,
      vendor: customers.name,
    })
    .from(destinations)
    .innerJoin(customers, eq(customers.id, destinations.vendorId))
    .where(and(...where))
    .orderBy(asc(customers.name), asc(destinations.name))
    .limit(BULK_MAX + 1);
  return checkCount(rows, "destinations");
}

const DESTINATION_LABELS = {
  name: "Name",
  licenseType: "License type",
  licenseExpires: "License expires",
  address: "Address",
  contactName: "Contact",
  phone: "Phone",
  email: "Email",
  active: "Active",
};

/** Turn the model's snake_case change fields into the engine's names. */
function pick(
  changes: Input,
  map: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [from, to] of Object.entries(map))
    if (from in changes && changes[from] !== undefined) out[to] = changes[from];
  return out;
}

const ids = (a: Record<string, string>) => JSON.parse(a.ids) as string[];
const changesOf = (a: Record<string, string>) =>
  JSON.parse(a.changes) as Record<string, unknown>;

export const BULK_TOOLS: Tool[] = [
  {
    kind: "action",
    name: "bulk_edit_items",
    label: "Preparing a bulk item change",
    permission: "catalog.manage",
    extraPermissions: (a) => {
      const c = JSON.parse(a.changes ?? "{}") as Record<string, unknown>;
      return "limitCategory" in c || "limitPerUnit" in c || "limit_category" in c || "limit_per_unit" in c ? ["pos.manage"] : [];
    },
    description: `Propose the same change to many catalog items at once (up to ${BULK_MAX}): category, strain, archive/unarchive, and how each unit counts toward purchase limits. Match items by SKUs, names, part of the name, category, or strain. One card lists every item; nothing changes until the user presses Confirm. For shelf prices use bulk_set_prices.`,
    schema: obj(
      {
        match: obj(ITEM_MATCH),
        changes: obj({
          category: text("New category name (created if new)."),
          strain: text("New strain, or empty to clear."),
          active: flag("false archives the items, true brings them back."),
          limit_category: {
            type: "string",
            enum: ["NONE", "FLOWER", "CONCENTRATE", "EDIBLE"],
          },
          limit_per_unit: text(
            "Grams (flower/concentrate) or mg THC (edible) each unit counts.",
          ),
        }),
      },
      ["match", "changes"],
    ),
    propose: async (s, input) => {
      const rows = await matchItems(s, input);
      const raw = pick((input.changes ?? {}) as Input, {
        category: "category",
        strain: "strain",
        active: "active",
        limit_category: "limitCategory",
        limit_per_unit: "limitPerUnit",
      });
      const changes = cleanItemChanges(raw);
      if (!Object.keys(changes).length)
        throw new InventoryError("Say what to change on these items.");
      // Purchase limits are store rules: the same permission as the Menu and store rules screen (APEX-24).
      if (("limitCategory" in changes || "limitPerUnit" in changes) && !can(s, "pos.manage"))
        throw new InventoryError("Changing how items count toward purchase limits needs the permission to run the store. Ask a manager.");
      return {
        title: `Change ${rows.length} item${rows.length === 1 ? "" : "s"}`,
        details: [
          {
            label: `Items (${rows.length})`,
            value: preview(rows.map((r) => r.name)),
          },
          ...changeLines(changes, ITEM_LABELS),
        ],
        action: {
          tool: "bulk_edit_items",
          args: {
            ids: JSON.stringify(rows.map((r) => r.id)),
            changes: JSON.stringify(raw),
          },
        },
      };
    },
    execute: async (actor, a) => {
      const n = await updateItems(actor, ids(a), changesOf(a));
      return `Updated ${n} item${n === 1 ? "" : "s"}.`;
    },
  },
  {
    kind: "action",
    name: "bulk_set_prices",
    label: "Preparing a price change",
    permission: "pos.manage",
    description: `Propose setting the register shelf price for many items at this facility at once (up to ${BULK_MAX}). Match items the same way as bulk_edit_items. Nothing changes until the user presses Confirm.`,
    schema: obj(
      {
        match: obj(ITEM_MATCH),
        price: text(
          "New shelf price in dollars, before tax, e.g. 10 or 34.99.",
        ),
      },
      ["match", "price"],
    ),
    propose: async (s, input) => {
      const rows = await matchItems(s, input);
      const changes = cleanItemChanges({ retailPrice: input.price });
      const current = await db
        .select({ itemId: retailPrices.itemId, price: retailPrices.price })
        .from(retailPrices)
        .where(
          and(
            eq(retailPrices.facilityId, s.facilityId),
            inArray(
              retailPrices.itemId,
              rows.map((r) => r.id),
            ),
          ),
        );
      const notOnMenu = rows.length - current.length;
      return {
        title: `Set price on ${rows.length} item${rows.length === 1 ? "" : "s"}`,
        details: [
          {
            label: `Items (${rows.length})`,
            value: preview(rows.map((r) => r.name)),
          },
          { label: "Shelf price", value: `→ $${changes.retailPrice}` },
          ...(notOnMenu
            ? [
                {
                  label: "Note",
                  value: `${notOnMenu} of them aren't on this store's menu yet; this adds them`,
                },
              ]
            : []),
        ],
        action: {
          tool: "bulk_set_prices",
          args: {
            ids: JSON.stringify(rows.map((r) => r.id)),
            changes: JSON.stringify({ retailPrice: changes.retailPrice }),
          },
        },
      };
    },
    execute: async (actor, a) => {
      const n = await updateItems(actor, ids(a), changesOf(a));
      return `Set the shelf price on ${n} item${n === 1 ? "" : "s"}.`;
    },
  },
  {
    kind: "action",
    name: "bulk_edit_vendors",
    label: "Preparing a bulk vendor change",
    permission: "sales.write",
    description: `Propose the same change to many vendors at once (up to ${BULK_MAX}): contact details, payment terms, price list, active, and whether you sell to and/or buy from them. Nothing changes until the user presses Confirm.`,
    schema: obj(
      {
        match: obj(VENDOR_MATCH),
        changes: obj({
          contact_name: text("Contact person."),
          email: text("Email."),
          phone: text("Phone."),
          address: text("Address."),
          payment_terms_days: {
            type: "integer",
            description: "Days to pay; 0 means on delivery.",
          },
          price_list: text("Price list name, or 'default' for default prices."),
          active: flag("false marks the vendors inactive."),
          we_sell_to: flag("Whether you sell to them."),
          we_buy_from: flag("Whether you buy from them."),
        }),
      },
      ["match", "changes"],
    ),
    propose: async (s, input) => {
      const rows = await matchVendors(s, input);
      const c = (input.changes ?? {}) as Input;
      const raw = pick(c, {
        contact_name: "contactName",
        email: "email",
        phone: "phone",
        address: "address",
        payment_terms_days: "paymentTermsDays",
        active: "active",
        we_sell_to: "weSellTo",
        we_buy_from: "weBuyFrom",
      });
      let listName: string | null = null;
      if (str(c.price_list)) {
        if (/^default/i.test(str(c.price_list))) raw.priceListId = null;
        else {
          const [l] = await db
            .select()
            .from(priceLists)
            .where(
              and(
                eq(priceLists.orgId, s.orgId),
                ilike(priceLists.name, str(c.price_list)),
              ),
            );
          if (!l)
            throw new InventoryError(
              `No price list is called "${str(c.price_list)}".`,
            );
          raw.priceListId = l.id;
          listName = l.name;
        }
      }
      const changes = await cleanVendorChanges(db, s.orgId, raw);
      if (!Object.keys(changes).length)
        throw new InventoryError("Say what to change on these vendors.");
      const shown = {
        ...changes,
        ...("priceListId" in changes
          ? { priceListId: listName ?? "Default prices" }
          : {}),
      };
      return {
        title: `Change ${rows.length} vendor${rows.length === 1 ? "" : "s"}`,
        details: [
          {
            label: `Vendors (${rows.length})`,
            value: preview(rows.map((r) => r.name)),
          },
          ...changeLines(shown, VENDOR_LABELS),
        ],
        action: {
          tool: "bulk_edit_vendors",
          args: {
            ids: JSON.stringify(rows.map((r) => r.id)),
            changes: JSON.stringify(raw),
          },
        },
      };
    },
    execute: async (actor, a) => {
      const n = await updateVendors(actor, ids(a), changesOf(a));
      return `Updated ${n} vendor${n === 1 ? "" : "s"}.`;
    },
  },
  {
    kind: "action",
    name: "bulk_edit_destinations",
    label: "Preparing a bulk destination change",
    permission: "sales.write",
    description: `Propose the same change to many destinations (vendors' licensed ship-to locations) at once (up to ${BULK_MAX}): license type, license expiry, address, contact, phone, email, active. A new license expiry means the license must be verified again before the next shipment. Nothing changes until the user presses Confirm.`,
    schema: obj(
      {
        match: obj(DESTINATION_MATCH),
        changes: obj({
          license_type: text("License type, e.g. Retailer."),
          license_expires: text("YYYY-MM-DD."),
          address: text("Address."),
          contact_name: text("Contact person."),
          phone: text("Phone."),
          email: text("Email."),
          active: flag("false stops shipping there."),
        }),
      },
      ["match", "changes"],
    ),
    propose: async (s, input) => {
      const rows = await matchDestinations(s, input);
      const raw = pick((input.changes ?? {}) as Input, {
        license_type: "licenseType",
        license_expires: "licenseExpires",
        address: "address",
        contact_name: "contactName",
        phone: "phone",
        email: "email",
        active: "active",
      });
      const changes = cleanDestinationChanges(raw);
      if (!Object.keys(changes).length)
        throw new InventoryError("Say what to change on these destinations.");
      return {
        title: `Change ${rows.length} destination${rows.length === 1 ? "" : "s"}`,
        details: [
          {
            label: `Destinations (${rows.length})`,
            value: preview(rows.map((r) => `${r.vendor} – ${r.name}`)),
          },
          ...changeLines(changes, DESTINATION_LABELS),
          ...(changes.licenseExpires
            ? [
                {
                  label: "Note",
                  value:
                    "Licenses must be verified again before the next shipment",
                },
              ]
            : []),
        ],
        action: {
          tool: "bulk_edit_destinations",
          args: {
            ids: JSON.stringify(rows.map((r) => r.id)),
            changes: JSON.stringify(raw),
          },
        },
      };
    },
    execute: async (actor, a) => {
      const n = await updateDestinations(actor, ids(a), changesOf(a));
      return `Updated ${n} destination${n === 1 ? "" : "s"}.`;
    },
  },
];
