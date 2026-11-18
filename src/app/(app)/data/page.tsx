import { Info } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { IMPORT_KINDS } from "@/lib/importer";
import { can, type Permission } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { DutchieImport } from "@/components/dutchie-import";
import { importAction, importDutchieAction, previewDutchieAction } from "./actions";

// A large Dutchie, Flourish, or NMS2S export can take a while to check and import.
export const maxDuration = 300;

const EXPORTS: { table: string; label: string; permission: Permission }[] = [
  { table: "packages", label: "Packages at this facility", permission: "inventory.view" },
  { table: "items", label: "Items", permission: "inventory.view" },
  { table: "locations", label: "Locations at this facility", permission: "inventory.view" },
  { table: "customers", label: "Customers", permission: "sales.view" },
  { table: "invoices", label: "Invoices and payments", permission: "sales.view" },
  { table: "sales", label: "Retail sales", permission: "reports.view" },
  { table: "audit", label: "Audit trail", permission: "audit.view" },
];

export default async function DataPage() {
  const session = await requirePagePermission("inventory.view");
  const canImport = ["catalog.manage", "sales.write", "inventory.write"].some((p) => can(session, p as Permission));

  return (
    <>
      <PageHeader title="Import and export" subtitle="Spreadsheets in and out. Files are CSV, which Excel and Google Sheets open." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Download">
          <ul className="divide-y divide-slate-100 text-sm">
            {EXPORTS.filter((e) => can(session, e.permission)).map((e) => (
              <li key={e.table} className="flex items-center justify-between gap-3 py-2">
                <span className="text-slate-900">{e.label}</span>
                <a href={`/export/${e.table}`} className="font-semibold text-brand-700 hover:underline">
                  Download CSV
                </a>
              </li>
            ))}
          </ul>
        </Card>
        {canImport ? (
          <Card title="Upload">
            <ActionForm action={importAction} submitLabel="Import">
              <p className="flex gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs font-medium leading-relaxed text-brand-900"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>Every row is checked first. If any row has a problem, nothing is imported and each problem is listed with its line number. Import items and
                locations before opening inventory.</span></p>
              <Field label="What the file contains">
                <select name="kind" required defaultValue="" className={inputClass}>
                  <option value="" disabled>
                    Choose one
                  </option>
                  {Object.entries(IMPORT_KINDS).map(([kind, spec]) => (
                    <option key={kind} value={kind}>
                      {spec.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="CSV file" hint="Up to 2,000 rows and 2 MB.">
                <input name="file" type="file" required accept=".csv,text/csv" className="block w-full text-sm" />
              </Field>
            </ActionForm>
            <div className="mt-4 border-t border-slate-100 pt-3 text-sm">
              <p className="font-medium text-slate-700">Templates with the right columns</p>
              <ul className="mt-1 space-y-1">
                {Object.entries(IMPORT_KINDS).map(([kind, spec]) => (
                  <li key={kind}>
                    <a href={`/export/template/${kind}`} className="text-brand-700 hover:underline">
                      {spec.label}
                    </a>{" "}
                    <span className="text-slate-500">· needs {spec.required.join(", ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        ) : null}
      </div>
      {can(session, "inventory.write") && can(session, "catalog.manage") ? (
        <div id="switch-systems" className="mt-5 grid scroll-mt-4 gap-5 lg:grid-cols-2 xl:grid-cols-3">
          <div id="switch-from-nms2s" className="scroll-mt-4">
            <Card title="Switch from NMS2S (state system)" className="h-full">
              <DutchieImport source="nms2s" preview={previewDutchieAction} run={importDutchieAction} />
            </Card>
          </div>
          <div id="switch-from-dutchie" className="scroll-mt-4">
            <Card title="Switch from Dutchie" className="h-full">
              <DutchieImport source="dutchie" preview={previewDutchieAction} run={importDutchieAction} />
            </Card>
          </div>
          <div id="switch-from-flourish" className="scroll-mt-4">
            <Card title="Switch from Flourish" className="h-full">
              <DutchieImport source="flourish" preview={previewDutchieAction} run={importDutchieAction} />
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}
