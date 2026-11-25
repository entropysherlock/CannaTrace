"use client";

import { useState } from "react";
import { darknessTestZpl, DARKNESS_STEPS } from "@/lib/labels/darkness-test";
import { findPrinter, sendZpl, ZebraError } from "@/lib/labels/zebra-browser-print";

type PrinterOption = { name: string; dpi: number };

/** Prints one label per darkness step so a person can see which setting stops labels coming out faded. */
export function DarknessTest({ printers, defaultName }: { printers: PrinterOption[]; defaultName: string }) {
  const [name, setName] = useState(defaultName || printers[0]?.name || "");
  const [widthMm, setWidthMm] = useState(101.6);
  const [heightMm, setHeightMm] = useState(50.8);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const printer = printers.find((p) => p.name === name);

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const target = await findPrinter(name);
      await sendZpl(target, darknessTestZpl({ dpi: printer?.dpi ?? 203, widthMm, heightMm }));
      setMessage({ ok: true, text: `Sent ${DARKNESS_STEPS.length} labels. Find the first one where the black block is solid and the small text and barcode are sharp.` });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ZebraError || e instanceof Error ? e.message : "The Zebra printer couldn't be reached." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-700">
        Prints {DARKNESS_STEPS.length} labels, each a little darker than the last (+{DARKNESS_STEPS.join(", +")} on the printer&apos;s own darkness setting). The first label where the black block is solid and the small text and barcode are crisp shows how
        much darker the printer needs to be. It doesn&apos;t change the printer&apos;s saved setting.
      </p>
      <div className="grid grid-cols-3 gap-3">
        <label className="col-span-3 block font-medium text-slate-800">
          Printer
          <select value={name} onChange={(e) => setName(e.target.value)} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3">
            {printers.length === 0 ? <option value="">First Zebra Browser Print finds</option> : null}
            {printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block font-medium text-slate-800">
          Width (mm)
          <input type="number" min={20} max={300} step="0.1" value={widthMm} onChange={(e) => setWidthMm(Number(e.target.value) || 101.6)} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 px-3" />
        </label>
        <label className="block font-medium text-slate-800">
          Height (mm)
          <input type="number" min={40} max={300} step="0.1" value={heightMm} onChange={(e) => setHeightMm(Number(e.target.value) || 50.8)} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 px-3" />
        </label>
      </div>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="inline-flex min-h-11 items-center rounded-lg border-2 border-brand-600 bg-white px-5 text-sm font-bold text-brand-800 hover:bg-brand-50 disabled:opacity-50"
      >
        {busy ? "Sending…" : "Print darkness test"}
      </button>
      {message ? (
        <p role="status" className={`text-sm ${message.ok ? "text-brand-800" : "text-red-700"}`}>
          {message.text}
        </p>
      ) : null}
      <p className="text-xs text-slate-500">Needs the free Zebra Browser Print app running on this computer. The label needs to be at least 40 mm tall to show everything.</p>
    </div>
  );
}
