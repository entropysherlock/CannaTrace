"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { drivers, vehicles } from "@/db/schema";
import { toCreateError, type CreateResult } from "@/lib/contextual-create";
import { db } from "@/lib/db";
import { createDriver, createVehicle } from "@/lib/distribution";
import { addRoom, createLocation, findLocationByName } from "@/lib/facilities";
import { field } from "@/lib/form";
import { findItemByName, quickAddItem } from "@/lib/quick-item";
import { can, type Permission } from "@/lib/rbac";
import { PermissionError, requirePermission, requireSession } from "@/lib/session";
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
