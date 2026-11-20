import "server-only";
import Decimal from "decimal.js";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { customers, destinations, facilities, harvests, items, itemCategories, locations, orders, packages, plants, priceLists, scanReads, strains } from "@/db/schema";
import { db } from "@/lib/db";
import { cleanNumber } from "./doc-math";
import { audit, type Actor } from "@/lib/inventory";
import { InventoryError } from "@/lib/inventory-math";
import { harvestPlants } from "@/lib/cultivation";
import { addOrderLine, createOrder, createPriceList, setPrice } from "@/lib/distribution";
import { parseDate, parsePrice } from "@/lib/distribution-math";
import { findItemByName, quickAddItem } from "@/lib/quick-item";
import { can, type Permission } from "@/lib/rbac";
import type { Session } from "@/lib/session";
import { unitLabel } from "@/lib/units";
import { licenseKey, matchBusiness, pickCostPackage, tagKey, unitFromText } from "./apply-math";
import { matchItem, matchVendor } from "./manifest-math";
import { getScan } from "./read";
import type { DocProposal } from "./types";

const actorOf = (s: Session): Actor => ({ userId: s.userId, userName: s.name, orgId: s.orgId, facilityId: s.facilityId });
const val = (p: DocProposal, key: string) => p.fields.find((f) => f.key === key)?.value ?? "";
const LINE_LIMIT = 200;

/** The read document, checked: the right kind, not saved yet, and the person may do what saving it does. */
async function claim(session: Session, attachmentId: string, docType: string, permission: Permission | Permission[], what: string) {
  if (![permission].flat().some((p) => can(session, p))) throw new InventoryError(`Your role can't ${what}. Ask someone who can to open this document.`);
  const scan = await getScan(session, attachmentId);
  if (!scan || scan.proposal.kind !== "DOC" || scan.proposal.docType !== docType) throw new InventoryError("That document hasn't been read yet.");
  if (scan.status === "APPLIED") throw new InventoryError("This document was already saved.");
  return { scan, proposal: scan.proposal };
}
const finish = (scanId: string, ref: string) => db.update(scanReads).set({ status: "APPLIED", resultRef: ref, appliedAt: new Date() }).where(eq(scanReads.id, scanId));

const orgItems = (session: Session) =>
  db.select({ id: items.id, name: items.name, sku: items.sku, unit: items.unit }).from(items).where(and(eq(items.orgId, session.orgId), eq(items.active, true))).orderBy(asc(items.name)).limit(3000);
const itemOptions = (rows: { id: string; name: string; unit: string }[]) => rows.map((i) => ({ id: i.id, label: `${i.name} (${unitLabel(i.unit as never)})` }));

/* ------------------------------------------------------------------ Invoice: record costs on what was received */

export type InvoiceContext = {
  vendorName: string;
  lines: {
    description: string;
    quantity: string;
    unitPrice: string;
    itemId: string;
    packageId: string;
    candidates: { id: string; label: string; cost: string | null }[];
    currentCost: string | null;
  }[];
};

export async function invoiceContext(session: Session, proposal: DocProposal): Promise<InvoiceContext> {
  const [itemRows, vendors] = await Promise.all([
    orgItems(session),
    db.select({ id: customers.id, name: customers.name }).from(customers).where(and(eq(customers.orgId, session.orgId), eq(customers.active, true), eq(customers.weBuyFrom, true))),
  ]);
  const vendorName = val(proposal, "vendor");
  const vendorId = matchVendor(vendorName, vendors)?.id ?? "";
  const lines: InvoiceContext["lines"] = [];
  for (const r of proposal.items.slice(0, LINE_LIMIT)) {
    const item = matchItem(`${r.description ?? ""} ${r.sku ?? ""}`, itemRows) ?? matchItem(r.description ?? "", itemRows);
    const pkgs = item
      ? await db
          .select({ id: packages.id, tag: packages.tag, quantity: packages.quantity, costPerUnit: packages.costPerUnit, vendorId: packages.vendorId, status: packages.status })
          .from(packages)
          .where(and(eq(packages.orgId, session.orgId), eq(packages.facilityId, session.facilityId), eq(packages.itemId, item.id), ne(packages.status, "DESTROYED")))
          .orderBy(desc(packages.createdAt))
          .limit(10)
      : [];
    const pick = pickCostPackage(pkgs, vendorId);
    lines.push({
      description: r.description ?? "",
      quantity: r.quantity ?? "",
      unitPrice: r.unitPrice ?? "",
      itemId: item?.id ?? "",
      packageId: pick?.id ?? "",
      candidates: pkgs.map((p) => ({ id: p.id, label: `${p.tag} · ${p.quantity} on hand`, cost: p.costPerUnit })),
      currentCost: pick?.costPerUnit ?? null,
    });
  }
  return { vendorName, lines };
}

export async function applyInvoice(session: Session, input: { attachmentId: string; lines: { packageId: string; costPerUnit: string }[] }): Promise<{ count: number }> {
  const { scan, proposal } = await claim(session, input.attachmentId, "INVOICE", "inventory.write", "record costs");
  if (!input.lines.length) throw new InventoryError("Check at least one line to record its cost.");
  if (input.lines.length > LINE_LIMIT) throw new InventoryError(`Record at most ${LINE_LIMIT} lines at a time.`);
  const actor = actorOf(session);
  const number = val(proposal, "invoiceNumber");
  const seen = new Set<string>();
  await db.transaction(async (tx) => {
    for (const [i, l] of input.lines.entries()) {
      if (!l.packageId) throw new InventoryError(`Line ${i + 1}: pick the package it was for.`);
      if (seen.has(l.packageId)) throw new InventoryError(`Line ${i + 1}: that package is on more than one line. Each package gets one cost.`);
      seen.add(l.packageId);
      const cost = parsePrice(l.costPerUnit, `Line ${i + 1} cost`);
      if (cost.lte(0)) throw new InventoryError(`Line ${i + 1}: the cost must be more than zero.`);
      const [pkg] = await tx.select().from(packages).where(and(eq(packages.id, l.packageId), eq(packages.orgId, actor.orgId), eq(packages.facilityId, actor.facilityId))).for("update");
      if (!pkg) throw new InventoryError(`Line ${i + 1}: that package wasn't found at this location.`);
      await tx.update(packages).set({ costPerUnit: cost.toString() }).where(eq(packages.id, pkg.id));
      await audit(tx, actor, { entityType: "Package", entityId: pkg.id, action: "SET_COST", before: { costPerUnit: pkg.costPerUnit }, after: { costPerUnit: cost.toString(), invoice: number || null } });
    }
    await tx.update(scanReads).set({ status: "APPLIED", resultRef: `COSTED:${input.lines.length}`, appliedAt: new Date() }).where(eq(scanReads.id, scan.id));
  });
  return { count: input.lines.length };
}

/* ------------------------------------------------------------------ Harvest sheet: create the harvest */

export type HarvestContext = {
  name: string;
  unit: string;
  rooms: { id: string; name: string }[];
  rows: { tag: string; weight: string; plantId: string; note: string }[];
  strain: string;
};

export async function harvestContext(session: Session, proposal: DocProposal): Promise<HarvestContext> {
  const tags = proposal.items.map((r) => tagKey(r.plantTag)).filter(Boolean);
  const [found, rooms] = await Promise.all([
    tags.length
      ? db
          .select({ id: plants.id, tag: plants.tag, phase: plants.phase, status: plants.status, strain: strains.name, strainId: plants.strainId })
          .from(plants)
          .innerJoin(strains, eq(strains.id, plants.strainId))
          .where(and(eq(plants.orgId, session.orgId), eq(plants.facilityId, session.facilityId), inArray(plants.tag, tags)))
      : [],
    db.select({ id: locations.id, name: locations.name }).from(locations).where(and(eq(locations.orgId, session.orgId), eq(locations.facilityId, session.facilityId))).orderBy(asc(locations.name)),
  ]);
  const byTag = new Map(found.map((p) => [p.tag, p]));
  const units = proposal.items.map((r) => unitFromText(r.unit)).filter((u): u is NonNullable<typeof u> => Boolean(u));
  const unit = unitFromText(val(proposal, "unit")) ?? units[0] ?? "G";
  const rows = proposal.items.map((r) => {
    const tag = tagKey(r.plantTag);
    const p = byTag.get(tag);
    let note = "";
    if (!p) note = "No plant with this tag here.";
    else if (p.status !== "ACTIVE") note = "Already harvested or removed.";
    else if (p.phase !== "FLOWERING") note = "Still vegetative. Only flowering plants can be harvested.";
    return { tag, weight: r.wetWeight ?? "", plantId: p && !note ? p.id : "", note };
  });
  const strain = found[0]?.strain ?? val(proposal, "strain");
  const date = val(proposal, "harvestDate");
  return { name: val(proposal, "harvestName") || [strain, date].filter(Boolean).join(" ") || "", unit, rooms, rows, strain };
}

export async function applyHarvestSheet(session: Session, input: { attachmentId: string; name: string; unit: string; locationId: string; rows: { plantId: string; weight: string }[] }): Promise<{ harvestId: string; plants: number }> {
  const { scan } = await claim(session, input.attachmentId, "HARVEST_SHEET", "cultivation.write", "record a harvest");
  if (!input.rows.length) throw new InventoryError("Check at least one plant that was harvested.");
  let total = new Decimal(0);
  for (const [i, r] of input.rows.entries()) {
    const w = cleanNumber(r.weight);
    if (w === null || new Decimal(w).lte(0)) throw new InventoryError(`Row ${i + 1}: enter the wet weight.`);
    total = total.plus(w);
  }
  const harvest = await harvestPlants(actorOf(session), { plantIds: input.rows.map((r) => r.plantId), name: input.name, wetWeight: total.toString(), unit: input.unit, locationId: input.locationId });
  await finish(scan.id, `HARVEST:${harvest.id}`);
  return { harvestId: harvest.id, plants: input.rows.length };
}

/* ------------------------------------------------------------------ License: track the expiry date */

export type LicenseContext = {
  number: string;
  expires: string;
  targets: { key: string; label: string; current: string | null }[];
  matched: string;
};

export async function licenseContext(session: Session, proposal: DocProposal): Promise<LicenseContext> {
  const [facs, cust, dests] = await Promise.all([
    db.select({ id: facilities.id, name: facilities.name, licenseNumber: facilities.licenseNumber, expires: facilities.licenseExpires }).from(facilities).where(eq(facilities.orgId, session.orgId)),
    db.select({ id: customers.id, name: customers.name, licenseNumber: customers.licenseNumber, expires: customers.licenseExpires }).from(customers).where(and(eq(customers.orgId, session.orgId), eq(customers.active, true))).orderBy(asc(customers.name)).limit(500),
    db.select({ id: destinations.id, name: destinations.name, licenseNumber: destinations.licenseNumber, expires: destinations.licenseExpires }).from(destinations).where(and(eq(destinations.orgId, session.orgId), eq(destinations.active, true))).limit(500),
  ]);
  const number = val(proposal, "licenseNumber");
  const holder = val(proposal, "holder");
  const targets = [
    ...facs.map((f) => ({ key: `F:${f.id}`, label: `${f.name} (our license ${f.licenseNumber})`, current: f.expires, licenseNumber: f.licenseNumber, name: f.name })),
    ...cust.map((c) => ({ key: `C:${c.id}`, label: `${c.name} (${c.licenseNumber})`, current: c.expires, licenseNumber: c.licenseNumber, name: c.name })),
    ...dests.map((d) => ({ key: `D:${d.id}`, label: `${d.name} location (${d.licenseNumber})`, current: d.expires, licenseNumber: d.licenseNumber, name: d.name })),
  ];
  const keyed = targets.map((t) => ({ ...t, id: t.key }));
  // A license number is the strongest clue; a holder's name only counts when it is clear.
  const byNumber = licenseKey(number) ? keyed.filter((t) => licenseKey(t.licenseNumber) === licenseKey(number)) : [];
  const matched = byNumber[0]?.key ?? matchBusiness(holder, "", keyed)?.key ?? "";
  return { number, expires: val(proposal, "expiryDate"), targets: targets.map(({ key, label, current }) => ({ key, label, current })), matched };
}

export async function applyLicense(session: Session, input: { attachmentId: string; target: string; expires: string }): Promise<{ label: string; expires: string }> {
  const { scan } = await claim(session, input.attachmentId, "LICENSE", ["settings.manage", "sales.write"], "update a license");
  const expires = parseDate(input.expires, "Expiry date");
  const [kind, id] = input.target.split(":");
  const actor = actorOf(session);
  let label = "";
  await db.transaction(async (tx) => {
    if (kind === "F") {
      if (!can(session, "settings.manage")) throw new InventoryError("Only someone who manages settings can change your own license dates.");
      const [f] = await tx.select().from(facilities).where(and(eq(facilities.id, id), eq(facilities.orgId, actor.orgId)));
      if (!f) throw new InventoryError("Pick the license holder from the list.");
      await tx.update(facilities).set({ licenseExpires: expires }).where(eq(facilities.id, f.id));
      await audit(tx, actor, { entityType: "Facility", entityId: f.id, action: "SET_LICENSE_EXPIRY", before: { licenseExpires: f.licenseExpires }, after: { licenseExpires: expires } });
      label = f.name;
    } else if (kind === "C") {
      if (!can(session, "sales.write")) throw new InventoryError("Only someone who manages sales can change a vendor's license date.");
      const [c] = await tx.select().from(customers).where(and(eq(customers.id, id), eq(customers.orgId, actor.orgId)));
      if (!c) throw new InventoryError("Pick the license holder from the list.");
      await tx.update(customers).set({ licenseExpires: expires }).where(eq(customers.id, c.id));
      // Their own location carries the same license, so it moves with it.
      await tx.update(destinations).set({ licenseExpires: expires }).where(and(eq(destinations.vendorId, c.id), eq(destinations.licenseNumber, c.licenseNumber)));
      await audit(tx, actor, { entityType: "Customer", entityId: c.id, action: "SET_LICENSE_EXPIRY", before: { licenseExpires: c.licenseExpires }, after: { licenseExpires: expires } });
      label = c.name;
    } else if (kind === "D") {
      if (!can(session, "sales.write")) throw new InventoryError("Only someone who manages sales can change a vendor's license date.");
      const [d] = await tx.select().from(destinations).where(and(eq(destinations.id, id), eq(destinations.orgId, actor.orgId)));
      if (!d) throw new InventoryError("Pick the license holder from the list.");
      await tx.update(destinations).set({ licenseExpires: expires }).where(eq(destinations.id, d.id));
      await audit(tx, actor, { entityType: "Destination", entityId: d.id, action: "SET_LICENSE_EXPIRY", before: { licenseExpires: d.licenseExpires }, after: { licenseExpires: expires } });
      label = d.name;
    } else throw new InventoryError("Pick the license holder from the list.");
    await tx.update(scanReads).set({ status: "APPLIED", resultRef: `LICENSE:${input.target}`, appliedAt: new Date() }).where(eq(scanReads.id, scan.id));
  });
  return { label, expires };
}

/* ------------------------------------------------------------------ Price list: items and prices */

export type PriceContext = {
  lists: { id: string; name: string }[];
  newListName: string;
  categories: string[];
  rows: { sku: string; product: string; category: string; unit: string; price: string; itemId: string; itemLabel: string }[];
};

export async function priceListContext(session: Session, proposal: DocProposal): Promise<PriceContext> {
  const [itemRows, lists, cats] = await Promise.all([
    orgItems(session),
    db.select({ id: priceLists.id, name: priceLists.name }).from(priceLists).where(eq(priceLists.orgId, session.orgId)).orderBy(asc(priceLists.name)),
    db.select({ name: itemCategories.name }).from(itemCategories).where(eq(itemCategories.orgId, session.orgId)).orderBy(asc(itemCategories.name)),
  ]);
  const vendor = val(proposal, "vendor");
  return {
    lists,
    newListName: [vendor || "Price list", val(proposal, "effectiveDate")].filter(Boolean).join(" "),
    categories: cats.map((c) => c.name),
    rows: proposal.items.slice(0, LINE_LIMIT).map((r) => {
      const bySku = r.sku ? itemRows.find((i) => i.sku.toUpperCase() === r.sku.toUpperCase()) : undefined;
      const item = bySku ?? matchItem(`${r.product ?? ""} ${r.sku ?? ""}`, itemRows) ?? matchItem(r.product ?? "", itemRows);
      return { sku: r.sku ?? "", product: r.product ?? "", category: r.category ?? "", unit: unitFromText(r.unit) ?? "EACH", price: r.price ?? "", itemId: item?.id ?? "", itemLabel: item ? `${item.name}` : "" };
    }),
  };
}

export async function applyPriceList(
  session: Session,
  input: { attachmentId: string; listId: string; newListName: string; rows: { itemId: string; sku: string; product: string; category: string; unit: string; price: string }[] },
): Promise<{ prices: number; created: number; listName: string }> {
  const { scan } = await claim(session, input.attachmentId, "PRICE_LIST", "sales.write", "set prices");
  if (!input.rows.length) throw new InventoryError("Check at least one product.");
  if (input.rows.length > LINE_LIMIT) throw new InventoryError(`Save at most ${LINE_LIMIT} products at a time.`);
  const actor = actorOf(session);
  input.rows.forEach((r, i) => {
    parsePrice(r.price, `Row ${i + 1} price`);
    if (!r.itemId && !r.product.trim()) throw new InventoryError(`Row ${i + 1}: needs a product name.`);
  });
  if (input.rows.some((r) => !r.itemId) && !can(session, "catalog.manage")) throw new InventoryError("Some products are new, and adding items needs the catalog permission. Ask someone who has it, or match them to existing items.");
  let listId = input.listId;
  let listName = "";
  if (!listId) {
    listId = (await createPriceList(actor, { name: input.newListName })).id;
    listName = input.newListName.trim();
  } else {
    const [l] = await db.select({ name: priceLists.name }).from(priceLists).where(and(eq(priceLists.id, listId), eq(priceLists.orgId, actor.orgId)));
    if (!l) throw new InventoryError("Pick a price list from the list.");
    listName = l.name;
  }
  let created = 0;
  for (const r of input.rows) {
    let itemId = r.itemId;
    if (!itemId) {
      // Safe to run again: an item made on an earlier try is reused rather than refused.
      const existing = await findItemByName(actor.orgId, r.product);
      if (existing) itemId = existing.id;
      else {
        itemId = (await quickAddItem(actor, { name: r.product, unit: r.unit || "EACH", category: r.category || "General", sku: r.sku || undefined })).id;
        created++;
      }
    }
    await setPrice(actor, { priceListId: listId, itemId, price: r.price });
  }
  await finish(scan.id, `PRICES:${input.rows.length}:${created}:${listName}`);
  return { prices: input.rows.length, created, listName };
}

/* ------------------------------------------------------------------ Wholesale order: a draft order to confirm */

export type OrderContext = {
  customers: { id: string; name: string }[];
  customerId: string;
  items: { id: string; label: string }[];
  lines: { description: string; quantity: string; unitPrice: string; itemId: string }[];
  orderNumber: string;
};

export async function orderContext(session: Session, proposal: DocProposal): Promise<OrderContext> {
  const [itemRows, custRows] = await Promise.all([
    orgItems(session),
    db.select({ id: customers.id, name: customers.name, licenseNumber: customers.licenseNumber }).from(customers).where(and(eq(customers.orgId, session.orgId), eq(customers.active, true), eq(customers.weSellTo, true))).orderBy(asc(customers.name)),
  ]);
  const customer = matchBusiness(val(proposal, "customer"), val(proposal, "customerLicense"), custRows);
  return {
    customers: custRows.map((c) => ({ id: c.id, name: c.name })),
    customerId: customer?.id ?? "",
    items: itemOptions(itemRows),
    orderNumber: val(proposal, "orderNumber"),
    lines: proposal.items.slice(0, LINE_LIMIT).map((r) => ({
      description: r.description ?? "",
      quantity: r.quantity ?? "",
      unitPrice: r.unitPrice ?? "",
      itemId: (matchItem(`${r.description ?? ""} ${r.sku ?? ""}`, itemRows) ?? matchItem(r.description ?? "", itemRows))?.id ?? "",
    })),
  };
}

export async function applyWholesaleOrder(
  session: Session,
  input: { attachmentId: string; customerId: string; lines: { itemId: string; quantity: string; unitPrice: string }[] },
): Promise<{ orderId: string; number: string; added: number; problems: string[] }> {
  const { scan, proposal } = await claim(session, input.attachmentId, "WHOLESALE_ORDER", "sales.write", "create orders");
  if (!input.customerId) throw new InventoryError("Pick the customer this order is for.");
  if (!input.lines.length) throw new InventoryError("Check at least one line.");
  if (input.lines.length > LINE_LIMIT) throw new InventoryError(`Add at most ${LINE_LIMIT} lines at a time.`);
  const seen = new Set<string>();
  input.lines.forEach((l, i) => {
    if (!l.itemId) throw new InventoryError(`Line ${i + 1}: pick the item it is.`);
    if (seen.has(l.itemId)) throw new InventoryError(`Line ${i + 1}: that item is on more than one line. An order has each item once, so combine the quantities.`);
    seen.add(l.itemId);
    const q = cleanNumber(l.quantity);
    if (q === null || new Decimal(q).lte(0)) throw new InventoryError(`Line ${i + 1}: enter the quantity.`);
  });
  const actor = actorOf(session);
  const number = val(proposal, "orderNumber");
  const delivery = val(proposal, "deliveryDate");
  const order = await createOrder(actor, { customerId: input.customerId, notes: [number && `From customer order ${number}`, delivery && `Deliver by ${delivery}`].filter(Boolean).join(". ") || undefined });
  const problems: string[] = [];
  let added = 0;
  for (const [i, l] of input.lines.entries()) {
    try {
      await addOrderLine(actor, { orderId: order.id, itemId: l.itemId, quantity: cleanNumber(l.quantity)!, unitPrice: l.unitPrice.trim() ? cleanNumber(l.unitPrice) ?? l.unitPrice : undefined });
      added++;
    } catch (e) {
      if (e instanceof InventoryError) problems.push(`Line ${i + 1}: ${e.message}`);
      else throw e;
    }
  }
  await finish(scan.id, `ORDER:${order.id}`);
  return { orderId: order.id, number: order.number, added, problems };
}


/** What a saved document did, in words, for when its review page is opened again (or refreshed by the save itself). */
export async function appliedSummary(session: Session, ref: string): Promise<{ title: string; body: string; href?: string; hrefLabel?: string } | null> {
  const [kind, rest = ""] = [ref.slice(0, ref.indexOf(":")), ref.slice(ref.indexOf(":") + 1)];
  if (kind === "COSTED") return { title: `Recorded costs on ${rest} package${rest === "1" ? "" : "s"}`, body: "Cost per unit now follows these packages into production runs and reports.", href: "/inventory", hrefLabel: "See the packages" };
  if (kind === "PRICES") {
    const [n, made, ...name] = rest.split(":");
    const created = Number(made) || 0;
    return { title: `Saved ${n} price${n === "1" ? "" : "s"}${name.length ? ` to ${name.join(":")}` : ""}`, body: created ? `${created} new item${created === 1 ? " was" : "s were"} added to your catalog.` : "All of these products were already in your catalog.", href: "/catalog", hrefLabel: "See the items" };
  }
  if (kind === "HARVEST") {
    const [h] = await db.select({ name: harvests.name, count: harvests.plantCount }).from(harvests).where(and(eq(harvests.id, rest), eq(harvests.orgId, session.orgId)));
    return { title: h ? `Harvest recorded: ${h.count} plant${h.count === 1 ? "" : "s"}` : "Harvest recorded", body: h ? `${h.name} is drying now. Come back to the Dry step when it is ready to weigh.` : "It is drying now.", href: "/cultivation", hrefLabel: "Open the Grow guide" };
  }
  if (kind === "LICENSE") {
    const [type, id] = rest.split(":");
    const table = type === "F" ? facilities : type === "C" ? customers : destinations;
    const [row] = await db.select({ name: table.name, expires: table.licenseExpires }).from(table).where(and(eq(table.id, id), eq(table.orgId, session.orgId)));
    return { title: row ? `Saved: ${row.name} expires ${row.expires}` : "License date saved", body: "You will see a warning on the Dashboard before it expires.", href: "/dashboard", hrefLabel: "Go to the Dashboard" };
  }
  if (kind === "ORDER") {
    const [o] = await db.select({ number: orders.number }).from(orders).where(and(eq(orders.id, rest), eq(orders.orgId, session.orgId)));
    return { title: o ? `Draft order ${o.number} created` : "Draft order created", body: "It is a draft: nothing is reserved or shipped until you confirm it.", href: `/distribution/orders/${rest}`, hrefLabel: "Review and confirm the order" };
  }
  return null;
}
