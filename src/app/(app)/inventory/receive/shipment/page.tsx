import { and, asc, eq } from "drizzle-orm";
import { LocationFields } from "@/components/quick-fields";
import { addVendorConfig } from "@/components/vendor-drawer";
import { ShipmentReceive } from "@/components/shipment-receive";
import { Card, PageHeader } from "@/components/ui";
import { customers, locations as locationsTable } from "@/db/schema";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { quickLocationAction } from "../../../quick-create-actions";
import { checkShipmentAction, receiveShipmentAction } from "../../actions";

export const metadata = { title: "Receive a shipment · CannaTrace" };

/** Receive a whole shipment against its manifest: count what arrived, explain any difference, receive it all at once. */
export default async function ReceiveShipmentPage() {
  const session = await requirePagePermission("inventory.write");
  const [locations, vendors] = await Promise.all([
    db
      .select({ id: locationsTable.id, name: locationsTable.name })
      .from(locationsTable)
      .where(and(eq(locationsTable.orgId, session.orgId), eq(locationsTable.facilityId, session.facilityId)))
      .orderBy(asc(locationsTable.name)),
    db
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(eq(customers.orgId, session.orgId), eq(customers.active, true), eq(customers.weBuyFrom, true)))
      .orderBy(asc(customers.name)),
  ]);
  return (
    <>
      <PageHeader
        title="Receive a shipment"
        subtitle="Upload the seller's manifest, count what arrived, and explain anything short or missing. Everything is received together, or nothing is."
      />
      <Card>
        <ShipmentReceive
          check={checkShipmentAction}
          receive={receiveShipmentAction}
          locations={locations}
          vendors={vendors}
          addVendor={can(session, "sales.write") ? addVendorConfig : undefined}
          addLocation={
            can(session, "catalog.manage")
              ? {
                  buttonLabel: "Add location",
                  title: "Add a location",
                  intro: "It's added to this facility's locations and picked for this shipment.",
                  submitLabel: "Save location",
                  action: quickLocationAction,
                  fields: <LocationFields />,
                }
              : undefined
          }
        />
      </Card>
      <p className="mt-4 max-w-3xl text-sm text-slate-600">
        Switching from another system? That&apos;s different: bring your existing inventory over from Data → Switch systems. A shipment is new stock from another
        licensee, and the state needs you to accept its manifest.
      </p>
    </>
  );
}
