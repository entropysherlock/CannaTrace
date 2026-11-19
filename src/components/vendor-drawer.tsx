import { quickVendorAction } from "@/app/(app)/quick-create-actions";
import type { CreateConfig } from "./contextual-create";
import { LicenseCheckFields, VendorContactFields, VendorLicenseFields } from "./vendor-fields";

/** "+ Add vendor" while receiving: the guided drawer, saved like the Vendors tab and marked "we buy from". */
export const addVendorConfig: CreateConfig = {
  buttonLabel: "Add vendor",
  title: "Add a vendor you buy from",
  intro: "Saved to Vendors and picked for this delivery. You won't lose anything you've typed here.",
  submitLabel: "Save vendor",
  action: quickVendorAction,
  steps: [
    { title: "Business & license", fields: <VendorLicenseFields role="buy" /> },
    { title: "Contact", fields: <VendorContactFields /> },
    { title: "License check", fields: <LicenseCheckFields /> },
  ],
};
