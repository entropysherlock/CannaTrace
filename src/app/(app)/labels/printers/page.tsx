import { ActionForm } from "@/components/action-form";
import { Card, Field, inputClass, PageHeader } from "@/components/ui";
import { STOCK_SIZES } from "@/lib/labels/defaults";
import { listJobs, listPrinters, PRINTER_ADAPTERS } from "@/lib/labels/service";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { savePrinterAction } from "../actions";

export const instant = false;

const DIAGNOSTICS: { problem: string; fixes: string[] }[] = [
  {
    problem: "Label prints too small, too big, or across two stickers",
    fixes: [
      "In the print dialog set Scale to 100% or Actual size, not Fit to page.",
      "Set the paper size to the label's size (shown on the template), and margins to None.",
      "On Zebra and similar printers, run media calibration from the printer's own menu after changing rolls.",
    ],
  },
  {
    problem: "Everything is shifted to one side or up and down",
    fixes: ["Print a test label below. Measure how far the box is from where it should be.", "Save that distance as the printer's offset (right and down are positive)."],
  },
  {
    problem: "Barcode won't scan",
    fixes: [
      "Check the label: SmartLabel blocks bars thinner than 0.19 mm and warns below 0.25 mm. Widen the barcode if warned.",
      "Leave blank space on both sides of the barcode; don't let text or the label edge touch it.",
      "Faint or smeared bars mean the printer darkness or speed needs adjusting, or the ribbon doesn't match the label stock.",
      "Make sure the scanner is set to read Code 128 (and QR or Data Matrix if you use them).",
    ],
  },
  {
    problem: "Text is cut off",
    fixes: ["SmartLabel warns when text won't fit its box. Make the box bigger or the font smaller in the template designer."],
  },
];

export default async function PrintersPage() {
  const session = await requirePagePermission("labels.print");
  const manage = can(session, "labels.manage");
  const [printers, jobs] = await Promise.all([listPrinters(session), listJobs(session, 100)]);
  const failures = jobs.filter((j) => j.job.status === "FAILED").slice(0, 8);

  return (
    <div className="space-y-6">
      <PageHeader title="Printers" subtitle="Saved printer settings, test labels, and help when labels don't come out right." />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="How labels reach your printer">
          <ul className="space-y-3 text-sm">
            {PRINTER_ADAPTERS.map((a) => (
              <li key={a.id} className="flex gap-3">
                <span className={`mt-0.5 h-fit rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${a.ready ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-700"}`}>{a.ready ? "Works now" : "Not built yet"}</span>
                <div>
                  <p className="font-semibold text-slate-900">{a.name}</p>
                  <p className="text-slate-600">{a.note}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-600">
            Browser PDF works with any printer your computer can print to, including Zebra, DYMO, Brother, and Rollo label printers, through their normal drivers. CannaTrace doesn&apos;t talk to the printer directly, so a person confirms each job printed.
          </p>
        </Card>

        <Card title="Test label">
          <form action="/api/labels/test-print" method="get" target="_blank" className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
<div className="col-span-2">
              <Field label="Printer">
                <select name="printerId" className={inputClass} defaultValue={printers.find((p) => p.isDefault)?.id ?? ""}>
                  <option value="">No offset</option>
                  {printers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
</div>
              <Field label="Width (mm)">
                <input name="widthMm" type="number" step="0.01" min={10} max={300} defaultValue={101.6} className={inputClass} />
              </Field>
              <Field label="Height (mm)">
                <input name="heightMm" type="number" step="0.01" min={10} max={300} defaultValue={50.8} className={inputClass} />
              </Field>
            </div>
            <p className="text-xs text-slate-600">
              Common sizes: {STOCK_SIZES.map((s) => `${s.label} = ${s.widthMm}×${s.heightMm}`).join(", ")}. The test label has a box 1 mm in from each edge and ticks every 10 mm.
            </p>
            <button type="submit" className="inline-flex min-h-11 items-center rounded-lg border-2 border-brand-600 bg-white px-5 text-sm font-bold text-brand-800 hover:bg-brand-50">
              Open test label
            </button>
          </form>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Saved printers">
          {printers.length === 0 ? <p className="mb-4 text-sm text-slate-600">No printers saved. Labels print with no offset until you add one.</p> : null}
          <ul className="mb-5 divide-y divide-slate-100" data-testid="printer-list">
            {printers.map((p) => (
              <li key={p.id} className="py-2 text-sm">
                <p className="font-semibold text-slate-900">
                  {p.name}
                  {p.isDefault ? <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-800">Default</span> : null}
                </p>
                <p className="text-slate-600">
                  Browser PDF · shift {Number(p.offsetXMm)} mm right, {Number(p.offsetYMm)} mm down
                </p>
              </li>
            ))}
          </ul>
          {manage ? (
            <ActionForm action={savePrinterAction} submitLabel="Save printer">
              <Field label="Name">
                <input name="name" required maxLength={60} placeholder="Packaging room Zebra" className={inputClass} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Shift right (mm)" hint="Use a negative number to shift left.">
                  <input name="offsetXMm" type="number" step="0.1" min={-20} max={20} defaultValue={0} className={inputClass} />
                </Field>
                <Field label="Shift down (mm)" hint="Use a negative number to shift up.">
                  <input name="offsetYMm" type="number" step="0.1" min={-20} max={20} defaultValue={0} className={inputClass} />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                <input type="checkbox" name="isDefault" className="h-4 w-4 accent-brand-600" /> Use this printer by default
              </label>
              <p className="text-xs text-slate-500">Saving with an existing name isn&apos;t allowed; pick a new name for each printer.</p>
            </ActionForm>
          ) : (
            <p className="text-sm text-slate-600">Ask a manager to add printers.</p>
          )}
        </Card>

        <Card title="Printing diagnostics">
          {failures.length ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="mb-1 text-sm font-bold text-red-900">Recent failed jobs</p>
              <ul className="space-y-1 text-xs text-red-900">
                {failures.map(({ job, template }) => (
                  <li key={job.id}>
                    {template}: {job.error ?? "marked as not printed"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="space-y-3">
            {DIAGNOSTICS.map((d) => (
              <details key={d.problem} className="rounded-lg border border-slate-200 px-3 py-2">
                <summary className="cursor-pointer text-sm font-semibold text-slate-900">{d.problem}</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {d.fixes.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
