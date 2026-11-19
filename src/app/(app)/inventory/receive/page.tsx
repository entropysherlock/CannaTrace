import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { CreatableSelect } from "@/components/contextual-create";
import { ItemFields } from "@/components/item-fields";
import { LocationFields } from "@/components/quick-fields";
import { addVendorConfig } from "@/components/vendor-drawer";
import { ScanInput } from "@/components/scan-input";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { and, asc, eq } from "drizzle-orm";
import { customers, items as itemsTable, locations as locationsTable } from "@/db/schema";
import { db } from "@/lib/db";
import { itemCategoryNames } from "@/lib/quick-create-data";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { quickItemAction, quickLocationAction } from "../../quick-create-actions";
import { unitLabel } from "@/lib/units";
import { receiveAction } from "../actions";

export default async function ReceivePage() {
  const session = await requirePagePermission("inventory.write");
  const canManageCatalog = can(session, "catalog.manage");
  // Vendors are managed by sales, as on the Vendors tab.
  const canAddVendor = can(session, "sales.write");
  const [items, locations, vendors, categories] = await Promise.all([
    db
      .select()
      .from(itemsTable)
      .where(and(eq(itemsTable.orgId, session.orgId), eq(itemsTable.active, true)))
      .orderBy(asc(itemsTable.name)),
    db
      .select()
      .from(locationsTable)
      .where(and(eq(locationsTable.orgId, session.orgId), eq(locationsTable.facilityId, session.facilityId)))
      .orderBy(asc(locationsTable.name)),
    db
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(eq(customers.orgId, session.orgId), eq(customers.active, true), eq(customers.weBuyFrom, true)))
      .orderBy(asc(customers.name)),
    canManageCatalog ? itemCategoryNames(session.orgId) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader title="Receive package" subtitle="Scan the tag, pick the item, enter what arrived." />
      <p className="mb-4 max-w-xl text-sm text-slate-700">
        Receiving a whole shipment?{" "}
        <Link href="/inventory/receive/shipment" className="font-semibold text-brand-700 underline">
          Receive it against the manifest
        </Link>{" "}
        to count every package at once.
      </p>
      <div className="max-w-xl">
        <Card>
          <ActionForm action={receiveAction} submitLabel="Receive">
            <Field label="Package tag (blank to generate)" hint="Leave blank and CannaTrace makes a new unique ID (PKG-000123). Or scan a state tag with a barcode scanner, tap Scan to use the camera, or type it in.">
              <ScanInput name="tag" autoFocus placeholder="Blank = new PKG- ID" />
            </Field>
            <CreatableSelect
              name="itemId"
              label="Item"
              required
              placeholder="Choose an item"
              options={items.map((item) => ({ id: item.id, label: `${item.name} (${unitLabel(item.unit)})` }))}
              create={
                canManageCatalog
                  ? {
                      buttonLabel: "Add item",
                      title: "Add an item",
                      intro: "It goes into your catalog too, and is picked for this package.",
                      submitLabel: "Save item",
                      action: quickItemAction,
                      fields: <ItemFields categories={categories} />,
                    }
                  : undefined
              }
              deniedHint="Item missing? Someone who manages the catalog can add it on the Items page."
            />
            <Field label="Quantity" hint="In the item's unit of measure.">
              <input name="quantity" inputMode="decimal" required className={inputClass} />
            </Field>
            <CreatableSelect
              name="locationId"
              label="Put away to"
              required
              placeholder="Choose a location"
              options={locations.map((location) => ({ id: location.id, label: location.name }))}
              create={
                canManageCatalog
                  ? {
                      buttonLabel: "Add location",
                      title: "Add a location",
                      intro: "It's added to this facility's locations and picked for this package.",
                      submitLabel: "Save location",
                      action: quickLocationAction,
                      fields: <LocationFields />,
                    }
                  : undefined
              }
              deniedHint="Location missing? Someone who manages the catalog can add it on the Locations page."
            />
            {vendors.length || canAddVendor ? (
              <CreatableSelect
                name="vendorId"
                label="Bought from (optional)"
                placeholder="Not bought from a vendor"
                options={vendors.map((v) => ({ id: v.id, label: v.name }))}
                create={canAddVendor ? addVendorConfig : undefined}
              />
            ) : null}
            <Field label="Lot number (optional)">
              <input name="lotNumber" className={inputClass} />
            </Field>
            <Field label="Cost per unit (optional)">
              <input name="costPerUnit" inputMode="decimal" className={inputClass} />
            </Field>
            <Field label="Note (optional)">
              <input name="note" className={inputClass} />
            </Field>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
