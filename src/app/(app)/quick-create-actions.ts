"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { boms, customers, destinations, drivers, items, vehicles } from "@/db/schema";
import { toCreateError, type CreateResult } from "@/lib/contextual-create";
import { db } from "@/lib/db";
import {
  createCustomer,
  createDestination,
  createDriver,
  createVehicle,
  updateVendors,
  verifyCustomerLicense,
  verifyDestinationLicense,
} from "@/lib/distribution";
import { addRoom, createLocation, findLocationByName } from "@/lib/facilities";
import { field } from "@/lib/form";
import { actorOf as labelActorOf } from "@/lib/labels/http";
import { LabelError, createTemplate, getTemplate, listPrinters, savePrinter, setDefaultTemplate, setTemplateArchived } from "@/lib/labels/service";
import { createRecipe } from "@/lib/manufacturing";
import { createCategory, findCategoryByName, findItemByName, quickAddItem } from "@/lib/quick-item";
import { can, type Permission } from "@/lib/rbac";
import { PermissionError, requirePermission, requireSession } from "@/lib/session";
import { facilityToday } from "@/lib/time";
import { unitLabel } from "@/lib/units";

/**
 * "Create without leaving": small server actions behind the + Add buttons beside dropdowns.
 *
 * Each one checks the same permission as the record's own page, looks for a record with the same
 * name first (returning it as `existing` rather than making a twin), and then saves through the
 * same library function as that page, so validation and the audit log are identical.
 */

const actorOf = (s: { orgId: string; userId: string; name: string; facilityId: string }) => ({
  orgId: s.orgId,
  userId: s.userId,
  userName: s.name,
  facilityId: s.facilityId,
});

async function sessionWithAny(...anyOf: Permission[]) {
  const session = await requireSession();
  if (!anyOf.some((p) => can(session, p))) throw new PermissionError("Your role does not allow adding this. Ask an owner or manager.");
  return session;
}

/** A room (with its area type) at the facility the employee is signed in to. Same rule as Settings → Facilities. */
export async function quickRoomAction(formData: FormData): Promise<CreateResult> {
  try {
    const session = await requirePermission("settings.manage");
    const name = field(formData, "name");
    const twin = await findLocationByName(session.orgId, session.facilityId, name);
    if (twin) return { existing: { id: twin.id, label: twin.name } };
    const room = await addRoom(actorOf(session), session.facilityId, { name, area: field(formData, "area") });
    revalidatePath("/", "layout");
    return { created: { id: room.id, label: room.name } };
  } catch (error) {
    return toCreateError(error);
  }
}

/** A room, rack, or bin, as on the Locations page. */
export async function quickLocationAction(formData: FormData): Promise<CreateResult> {
  try {
    const session = await requirePermission("catalog.manage");
    const name = field(formData, "name");
    const twin = await findLocationByName(session.orgId, session.facilityId, name);
    if (twin) return { existing: { id: twin.id, label: twin.name } };
    const location = await createLocation(actorOf(session), { name, type: field(formData, "type") });
    revalidatePath("/", "layout");
    return { created: { id: location.id, label: location.name } };
  } catch (error) {
    return toCreateError(error);
  }
}

/**
 * A catalog item. Catalog managers can add one anywhere; recipe makers can too, as the recipe form
 * always allowed. Labels in pickers read "Name (unit)", so the new option matches its neighbours.
 */
export async function quickItemAction(formData: FormData): Promise<CreateResult> {
  try {
    const session = await sessionWithAny("catalog.manage", ...(field(formData, "context") === "recipe" ? (["manufacturing.write"] as const) : []));
    const name = field(formData, "name");
    const allowed = field(formData, "allowedUnits");
    const unit = field(formData, "unit");
    const twin = await findItemByName(session.orgId, name);
    if (twin) {
      if (allowed && !allowed.split(",").includes(twin.unit)) {
        return { error: `You already have an item called ${twin.name}, but it's counted in ${unitLabel(twin.unit)}, which can't be used here. Use a different name.` };
      }
      return { existing: { id: twin.id, label: `${twin.name} (${unitLabel(twin.unit)})` } };
    }
    // Some tasks only take some units (a harvest is packaged by weight), so the dialog only offers those.
    if (allowed && !allowed.split(",").includes(unit)) return { error: "Choose one of the units listed. This task can't use that unit." };
    const item = await quickAddItem(actorOf(session), {
      name,
      unit,
      category: field(formData, "category"),
      sku: field(formData, "sku") || undefined,
      strain: field(formData, "strain") || undefined,
    });
    revalidatePath("/", "layout");
    return { created: { id: item.id, label: `${item.name} (${unitLabel(item.unit)})` } };
  } catch (error) {
    return toCreateError(error);
  }
}

/** An item category, as on the Items page. */
export async function quickCategoryAction(formData: FormData): Promise<CreateResult> {
  try {
    const session = await requirePermission("catalog.manage");
    const name = field(formData, "name");
    const twin = await findCategoryByName(session.orgId, name);
    if (twin) return { existing: { id: twin.id, label: twin.name } };
    const category = await createCategory(actorOf(session), name);
    revalidatePath("/catalog");
    return { created: { id: category.id, label: category.name } };
  } catch (error) {
    return toCreateError(error);
  }
}

/** A driver. Matched on license number, since two drivers can share a name but not a license. */
export async function quickDriverAction(formData: FormData): Promise<CreateResult> {
  try {
    const session = await requirePermission("sales.write");
    const name = field(formData, "name");
    const licenseNumber = field(formData, "licenseNumber");
    if (licenseNumber) {
      const [twin] = await db
        .select({ id: drivers.id, name: drivers.name })
        .from(drivers)
        .where(and(eq(drivers.orgId, session.orgId), sql`upper(btrim(${drivers.licenseNumber})) = upper(${licenseNumber})`));
      if (twin) return { existing: { id: twin.id, label: twin.name } };
    }
    const driver = await createDriver(actorOf(session), { name, licenseNumber, phone: field(formData, "phone") });
    revalidatePath("/distribution", "layout");
    return { created: { id: driver.id, label: name.trim() } };
  } catch (error) {
    return toCreateError(error);
  }
}

/** A vehicle. Matched on plate, which is unique per business. */
export async function quickVehicleAction(formData: FormData): Promise<CreateResult> {
  try {
    const session = await requirePermission("sales.write");
    const make = field(formData, "make");
    const model = field(formData, "model");
    const plate = field(formData, "plate").replace(/\s+/g, "").toUpperCase();
    const label = (v: { make: string; model: string; plate: string }) => `${v.make} ${v.model} · ${v.plate}`;
    if (plate) {
      const [twin] = await db
        .select({ id: vehicles.id, make: vehicles.make, model: vehicles.model, plate: vehicles.plate })
        .from(vehicles)
        .where(and(eq(vehicles.orgId, session.orgId), sql`upper(replace(${vehicles.plate}, ' ', '')) = ${plate}`));
      if (twin) return { existing: { id: twin.id, label: label(twin) } };
    }
    const vehicle = await createVehicle(actorOf(session), { make, model, plate: field(formData, "plate") });
    revalidatePath("/distribution", "layout");
    return { created: { id: vehicle.id, label: label({ make, model, plate: field(formData, "plate").toUpperCase() }) } };
  } catch (error) {
    return toCreateError(error);
  }
}

// ---------- Guided drawers: vendors and destinations ----------

const shipLabel = (d: { name: string; licenseNumber: string }, vendor: string) => ({
  label: `${d.name === vendor ? vendor : `${vendor} – ${d.name}`} (${d.licenseNumber})`,
  group: vendor,
});

/** Refuses a "verified" check on a license whose expiry date has already passed, before anything is saved. */
async function checkVerifyTick(formData: FormData, facilityId: string): Promise<string | null> {
  if (formData.get("verifyNow") !== "on") return null;
  const expires = field(formData, "licenseExpires");
  if (expires && expires < (await facilityToday(facilityId))) {
    return `This license expired on ${expires}, so it can't be marked verified. Uncheck the box, or enter the new expiry date from the state's lookup.`;
  }
  return null;
}

/**
 * A new vendor from the guided drawer, through createCustomer like the Vendors page. A vendor with the
 * same license number is never made twice: it's offered instead, and if it isn't yet marked for this
 * use (buying from / selling to), the employee is asked before that flag is turned on.
 */
type VendorOutcome =
  | { result: CreateResult }
  // "existing": already on file and already fit for this use, so it's offered rather than selected.
  // "created": new, or on file and just marked for this use with the employee's say-so; selected at once.
  | { vendor: { id: string; name: string; licenseNumber: string }; outcome: "existing" | "created" };

async function vendorFromDrawer(formData: FormData, role: "buy" | "sell"): Promise<VendorOutcome> {
  const session = await requirePermission("sales.write");
  const actor = actorOf(session);
  const licenseNumber = field(formData, "licenseNumber").toUpperCase();
  const flag = role === "buy" ? "weBuyFrom" : "weSellTo";
  if (licenseNumber) {
    const [twin] = await db
      .select({ id: customers.id, name: customers.name, weBuyFrom: customers.weBuyFrom, weSellTo: customers.weSellTo, active: customers.active })
      .from(customers)
      .where(and(eq(customers.orgId, session.orgId), sql`upper(btrim(${customers.licenseNumber})) = ${licenseNumber}`));
    if (twin) {
      if (!twin.active) return { result: { error: `${twin.name} (license ${licenseNumber}) is already in Vendors but turned off. Turn it back on from the Vendors tab first.` } };
      if (!twin[flag]) {
        if (formData.get("confirm") !== "1") {
          const as = role === "buy" ? "one you buy from" : "one you sell to";
          return { result: { confirm: { message: `${twin.name} already has license ${licenseNumber} in Vendors, but isn't marked as ${as}. Nothing was added.`, label: `Mark ${twin.name} as ${as} and use it` } } };
        }
        await updateVendors(actor, [twin.id], { [flag]: true });
        return { vendor: { id: twin.id, name: twin.name, licenseNumber }, outcome: "created" };
      }
      return { vendor: { id: twin.id, name: twin.name, licenseNumber }, outcome: "existing" };
    }
  }
  const tickProblem = await checkVerifyTick(formData, session.facilityId);
  if (tickProblem) return { result: { error: tickProblem } };
  const also = formData.get("alsoOtherRole") === "on";
  const name = field(formData, "name");
  const vendor = await createCustomer(actor, {
    name,
    licenseNumber,
    licenseType: field(formData, "licenseType"),
    licenseExpires: field(formData, "licenseExpires"),
    contactName: field(formData, "contactName"),
    email: field(formData, "email"),
    phone: field(formData, "phone"),
    address: field(formData, "address"),
    paymentTermsDays: field(formData, "paymentTermsDays"),
    weBuyFrom: role === "buy" || also,
    weSellTo: role === "sell" || also,
  });
  if (formData.get("verifyNow") === "on") await verifyCustomerLicense(actor, { customerId: vendor.id });
  return { vendor: { id: vendor.id, name: name.trim(), licenseNumber }, outcome: "created" };
}

/** "Bought from": a vendor added while receiving. */
export async function quickVendorAction(formData: FormData): Promise<CreateResult> {
  try {
    const out = await vendorFromDrawer(formData, "buy");
    if ("result" in out) return out.result;
    revalidatePath("/", "layout");
    return { [out.outcome]: { id: out.vendor.id, label: out.vendor.name } };
  } catch (error) {
    return toCreateError(error);
  }
}

/**
 * "Ship to" on a new order: either a new vendor (its own license is its first destination), or a
 * new destination for a vendor already on file (`vendorId`).
 */
export async function quickShipToAction(formData: FormData): Promise<CreateResult> {
  try {
    const vendorId = field(formData, "vendorId");
    if (!vendorId) {
      const out = await vendorFromDrawer(formData, "sell");
      if ("result" in out) return out.result;
      const v = out.vendor;
      const [own] = await db
        .select({ id: destinations.id, name: destinations.name, licenseNumber: destinations.licenseNumber })
        .from(destinations)
        .where(and(eq(destinations.vendorId, v.id), eq(destinations.licenseNumber, v.licenseNumber)));
      if (!own) return { error: `${v.name} has no destination with license ${v.licenseNumber}. Add one from the Vendors tab.` };
      revalidatePath("/", "layout");
      return { [out.outcome]: { id: own.id, ...shipLabel(own, v.name) } };
    }

    const session = await requirePermission("sales.write");
    const actor = actorOf(session);
    const [vendor] = await db
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(eq(customers.id, vendorId), eq(customers.orgId, session.orgId)));
    if (!vendor) return { error: "Choose the vendor this destination belongs to." };
    const licenseNumber = field(formData, "licenseNumber").toUpperCase();
    const [twin] = await db
      .select({ id: destinations.id, name: destinations.name, licenseNumber: destinations.licenseNumber })
      .from(destinations)
      .where(and(eq(destinations.vendorId, vendor.id), sql`upper(btrim(${destinations.licenseNumber})) = ${licenseNumber}`));
    if (twin) return { existing: { id: twin.id, ...shipLabel(twin, vendor.name) } };
    const tickProblem = await checkVerifyTick(formData, session.facilityId);
    if (tickProblem) return { error: tickProblem };
    const name = field(formData, "destinationName");
    const row = await createDestination(actor, {
      vendorId: vendor.id,
      name,
      licenseNumber,
      licenseType: field(formData, "licenseType"),
      licenseExpires: field(formData, "licenseExpires"),
      address: field(formData, "address"),
      contactName: field(formData, "contactName"),
      phone: field(formData, "phone"),
      email: field(formData, "email"),
    });
    if (formData.get("verifyNow") === "on") await verifyDestinationLicense(actor, { destinationId: row.id });
    revalidatePath("/", "layout");
    return { created: { id: row.id, ...shipLabel({ name: name.trim(), licenseNumber }, vendor.name) } };
  } catch (error) {
    return toCreateError(error);
  }
}

// ---------- Guided drawer: recipe ----------

const recipeLabel = (r: { name: string; outputQuantity: string; unit: Parameters<typeof unitLabel>[0] }) =>
  `${r.name} (one batch makes ${Number(r.outputQuantity).toLocaleString("en-US", { maximumFractionDigits: 4 })} ${unitLabel(r.unit)})`;

/** A recipe from the Start a new run drawer, through createRecipe like the Recipes tab. */
export async function quickRecipeAction(formData: FormData): Promise<CreateResult> {
  try {
    const session = await requirePermission("manufacturing.write");
    const name = field(formData, "name").replace(/\s+/g, " ");
    const lookup = (where: ReturnType<typeof and>) =>
      db
        .select({ id: boms.id, name: boms.name, outputQuantity: boms.outputQuantity, unit: items.unit, active: boms.active })
        .from(boms)
        .innerJoin(items, eq(items.id, boms.outputItemId))
        .where(where);
    const [twin] = await lookup(and(eq(boms.orgId, session.orgId), sql`lower(btrim(${boms.name})) = lower(${name})`));
    if (twin?.active) return { existing: { id: twin.id, label: recipeLabel(twin) } };
    if (twin) return { error: `There is already a retired recipe called ${twin.name}. Bring it back on the Recipes tab, or use a different name.` };
    const itemIds = formData.getAll("inputItemId").map(String);
    const quantities = formData.getAll("inputQuantity").map(String);
    const lines = itemIds.map((itemId, i) => ({ itemId, quantity: (quantities[i] ?? "").trim(), row: i + 1 })).filter((line) => line.itemId || line.quantity);
    const recipe = await createRecipe(actorOf(session), {
      name,
      outputItemId: field(formData, "outputItemId"),
      outputQuantity: field(formData, "outputQuantity"),
      lines,
    });
    revalidatePath("/manufacturing", "layout");
    const [saved] = await lookup(eq(boms.id, recipe.id));
    return { created: { id: recipe.id, label: recipeLabel(saved) } };
  } catch (error) {
    return toCreateError(error);
  }
}

// ---------- SmartLabel: templates and printer presets from the print station ----------

const labelError = (error: unknown): CreateResult => (error instanceof LabelError ? { error: error.message } : toCreateError(error));

/**
 * A template for the label type being printed: a named copy of one this facility already has, or an
 * archived one brought back. Designing from scratch stays in the template designer.
 */
export async function quickTemplateAction(formData: FormData): Promise<CreateResult> {
  try {
    const session = await requirePermission("labels.manage");
    const actor = labelActorOf(session);
    const [how, sourceId] = field(formData, "source").split(":");
    if (!sourceId || (how !== "copy" && how !== "restore")) return { error: "Choose what to start from." };
    // Only templates at this facility are found, so another facility's can't be copied or restored.
    const { template } = await getTemplate(actor, sourceId);
    let id = template.id;
    let name = template.name;
    if (how === "restore") {
      await setTemplateArchived(actor, template.id, false);
    } else {
      name = field(formData, "name").replace(/\s+/g, " ");
      id = await createTemplate(actor, { name, kind: template.kind, jurisdiction: template.jurisdiction, design: null, copyOf: template.id });
    }
    if (formData.get("makeDefault") === "on") await setDefaultTemplate(actor, id);
    revalidatePath("/labels", "layout");
    return { created: { id, label: name } };
  } catch (error) {
    return labelError(error);
  }
}

/** A printer preset (name and offsets), as on the Printers tab. */
export async function quickPrinterAction(formData: FormData): Promise<CreateResult> {
  try {
    const session = await requirePermission("labels.manage");
    const actor = labelActorOf(session);
    const name = field(formData, "name").replace(/\s+/g, " ");
    const twin = (await listPrinters(actor)).find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
    if (twin) return { existing: { id: twin.id, label: twin.name } };
    const id = await savePrinter(actor, {
      name,
      offsetXMm: Number(field(formData, "offsetXMm") || 0),
      offsetYMm: Number(field(formData, "offsetYMm") || 0),
      isDefault: formData.get("isDefault") === "on",
    });
    revalidatePath("/labels", "layout");
    return { created: { id, label: name } };
  } catch (error) {
    return labelError(error);
  }
}
