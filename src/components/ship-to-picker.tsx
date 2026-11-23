"use client";

import { useState } from "react";
import { quickShipToAction } from "@/app/(app)/quick-create-actions";
import type { CreateOption } from "@/lib/contextual-create";
import { CreatableSelect } from "./contextual-create";
import { Field, inputClass } from "./ui";
import { LicenseCheckFields, LicenseFields, VendorContactFields, VendorLicenseFields } from "./vendor-fields";

/**
 * "Ship to" on a new order, with "+ Add destination": a guided drawer that adds either a brand-new
 * vendor (whose own license becomes its first destination) or another licensed location for a vendor
 * already on file. Nothing about the order being started is lost.
 */
export function ShipToPicker({ options, vendors, canAdd }: { options: CreateOption[]; vendors: { id: string; name: string }[]; canAdd: boolean }) {
  // "" = a new vendor; otherwise the vendor the new destination belongs to.
  const [vendorId, setVendorId] = useState("");
  const forNew = vendorId === "";

  const who = (
    <>
      <Field label="Who is it for?">
        <select name="vendorId" value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={inputClass}>
          <option value="">A new vendor</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              Another location for {v.name}
            </option>
          ))}
        </select>
      </Field>
      {forNew ? (
        <VendorLicenseFields role="sell" />
      ) : (
        <>
          <Field label="Destination name">
            <input name="destinationName" required maxLength={120} placeholder="e.g. Nob Hill store" className={inputClass} />
          </Field>
          <LicenseFields />
        </>
      )}
    </>
  );

  return (
    <CreatableSelect
      name="destinationId" searchable
      label="Ship to"
      hint="Vendor and destination. Its license is checked when the order ships."
      required
      placeholder="Choose a vendor and destination"
      options={options}
      deniedHint="Not listed? Someone in sales can add it on the Vendors tab."
      // The next add starts fresh, as a new vendor.
      onCreated={() => setVendorId("")}
      create={
        canAdd
          ? {
              buttonLabel: "Add destination",
              title: "Add somewhere to ship",
              intro: "A new vendor, or another licensed location for one you already have. It's picked for this order.",
              submitLabel: "Save and pick",
              action: quickShipToAction,
              steps: [
                { title: "Who & license", fields: who },
                { title: "Contact", fields: <VendorContactFields terms={forNew} /> },
                { title: "License check", fields: <LicenseCheckFields /> },
              ],
            }
          : undefined
      }
    />
  );
}
