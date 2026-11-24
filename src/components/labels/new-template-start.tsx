"use client";

import { ArrowLeft, Camera, Copy, FileUp, LayoutGrid, Loader2, PenLine, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Field, inputClass } from "@/components/ui";
import { USES, recommend, type CatalogEntry, type UseId } from "@/lib/labels/catalog";
import { STOCK_SIZES } from "@/lib/labels/defaults";
import { sampleValues } from "@/lib/labels/fields";
import type { ImportResult } from "@/lib/labels/import-design";
import { renderLabelSvg } from "@/lib/labels/render-svg";
import { LABEL_KINDS, type LabelDesign, type LabelKind } from "@/lib/labels/types";
import { LabelDesigner } from "./designer";

type Mine = { id: string; name: string; kind: LabelKind; jurisdiction: string | null; design: LabelDesign };
type Start = { name: string; kind: LabelKind; jurisdiction: string | null; design: LabelDesign };
type Source = { label: string; imported?: ImportResult; original?: { url: string; pdf: boolean; name: string; file?: File; kind?: string } };

const BLANK: Start = {
  name: "",
  kind: "PACKAGE",
  jurisdiction: null,
  design: {
    widthMm: 101.6,
    heightMm: 50.8,
    elements: [
      { id: "e1", type: "text", x: 4, y: 3, w: 93.6, h: 6, text: "{{item.name}}", fontSize: 13, bold: true },
      { id: "e2", type: "barcode", x: 2, y: 14, w: 97.6, h: 14, value: "{{package.tag}}", format: "code128" },
      { id: "e3", type: "text", x: 4, y: 30, w: 93.6, h: 5, text: "{{package.tag}}", fontSize: 11, align: "center" },
    ],
  },
};

const sizeText = (d: LabelDesign) => `${Math.round((d.widthMm / 25.4) * 100) / 100}" × ${Math.round((d.heightMm / 25.4) * 100) / 100}"`;

function Preview({ design, kind }: { design: LabelDesign; kind: LabelKind }) {
  const svg = useMemo(() => renderLabelSvg(design, { ...sampleValues(kind), "_lab.status": "PASS", "_package.status": "ACTIVE" }).replace(/width="[^"]*mm" height="[^"]*mm"/, 'width="100%"'), [design, kind]);
  return (
    <div className="rounded bg-slate-100 p-2">
      <div className="mx-auto max-h-64 max-w-[260px] overflow-hidden bg-white shadow ring-1 ring-slate-300 [&>svg]:block" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}

const tab = (on: boolean) => `flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg border-2 px-3 text-sm font-bold transition ${on ? "border-brand-600 bg-brand-50 text-brand-900" : "border-slate-200 bg-white text-slate-700 hover:border-brand-300"}`;
const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-50";

export function NewTemplateStart({ starters, mine, aiReady, aiReason }: { starters: CatalogEntry[]; mine: Mine[]; aiReady: boolean; aiReason: string | null }) {
  const [mode, setMode] = useState<"upload" | "gallery" | "help" | "mine">(aiReady ? "upload" : "gallery");
  const [chosen, setChosen] = useState<{ start: Start; source: Source } | null>(null);

  // Free the uploaded picture's memory when it is no longer shown.
  const urlRef = useRef<string | null>(null);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  if (chosen) {
    const { start, source } = chosen;
    const imp = source.imported;
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setChosen(null)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-brand-500">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Start over
          </button>
          <p className="text-sm text-slate-600">Starting from: <span className="font-semibold text-slate-900">{source.label}</span>. Nothing is saved until you press Save.</p>
        </div>
        {imp ? (
          <section className="grid gap-4 rounded-xl border border-brand-200 bg-brand-50/50 p-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Your original</p>
              {source.original?.pdf ? (
                <embed src={source.original.url} type="application/pdf" className="h-72 w-full rounded border border-slate-300 bg-white" />
              ) : source.original ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={source.original.url} alt={`Your uploaded label, ${source.original.name}`} className="max-h-72 w-full rounded border border-slate-300 bg-white object-contain" />
              ) : null}
            </div>
            <div className="space-y-3 text-sm">
              <p className="font-bold text-slate-900">
                <Sparkles className="mr-1 inline h-4 w-4 text-brand-700" aria-hidden="true" />
                Rebuilt as {imp.design.elements.length} editable pieces. Check the matches below, then fix anything off in the editor.
              </p>
              {imp.others?.length && source.original?.file ? <OtherLabels others={imp.others} original={source.original} onRebuilt={(r) => setChosen({ start: { name: r.name, kind: r.kind, jurisdiction: r.jurisdiction, design: r.design }, source: { ...source, label: `${source.label} (another label)`, imported: r } })} /> : null}
              {imp.notes.length ? (
                <ul className="list-disc space-y-1 pl-5 text-slate-700">
                  {imp.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ) : null}
              <details open className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
                <summary className="cursor-pointer font-semibold text-slate-900">What each piece became ({imp.matches.length})</summary>
                <ul className="mt-2 max-h-56 space-y-1.5 overflow-auto text-xs">
                  {imp.matches.map((m, i) => (
                    <li key={i} className="grid gap-1 sm:grid-cols-2">
                      <span className="text-slate-500">&ldquo;{m.printed}&rdquo;</span>
                      <span className={m.fields.length ? "font-semibold text-brand-800" : "text-amber-800"}>{m.fields.length ? `→ ${m.fields.join(", ")}` : "→ kept as typed text"}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          </section>
        ) : null}
        <LabelDesigner key={`${source.label}-${start.name}`} mode="new" initial={{ ...start, version: 0 }} previewValues={imp?.preview} />
      </div>
    );
  }

  const use = (start: Start, source: Source) => setChosen({ start, source });

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row" role="tablist" aria-label="How to start a template">
        <button role="tab" aria-selected={mode === "upload"} type="button" onClick={() => setMode("upload")} className={tab(mode === "upload")}>
          <FileUp className="h-4 w-4" aria-hidden="true" /> Upload a label I already use
        </button>
        <button role="tab" aria-selected={mode === "gallery"} type="button" onClick={() => setMode("gallery")} className={tab(mode === "gallery")}>
          <LayoutGrid className="h-4 w-4" aria-hidden="true" /> Browse templates
        </button>
        <button role="tab" aria-selected={mode === "help"} type="button" onClick={() => setMode("help")} className={tab(mode === "help")}>
          <Wand2 className="h-4 w-4" aria-hidden="true" /> Help me choose
        </button>
        <button role="tab" aria-selected={mode === "mine"} type="button" onClick={() => setMode("mine")} className={tab(mode === "mine")}>
          <Copy className="h-4 w-4" aria-hidden="true" /> Blank or copy mine
        </button>
      </div>

      {mode === "upload" ? <UploadPanel aiReady={aiReady} aiReason={aiReason} onDone={(imp, original) => { urlRef.current = original.url; use({ name: imp.name, kind: imp.kind, jurisdiction: imp.jurisdiction, design: imp.design }, { label: `your uploaded ${original.name}`, imported: imp, original }); }} /> : null}
      {mode === "gallery" ? <Gallery starters={starters} onUse={(t) => use({ name: `${t.name} (my version)`, kind: t.kind, jurisdiction: t.jurisdiction, design: t.design }, { label: t.name })} /> : null}
      {mode === "help" ? <Helper starters={starters} onUse={(t) => use({ name: `${t.name} (my version)`, kind: t.kind, jurisdiction: t.jurisdiction, design: t.design }, { label: t.name })} /> : null}
      {mode === "mine" ? (
        <section className="space-y-4 rounded-xl border border-brand-100 bg-white p-4 shadow-sm">
          <button type="button" onClick={() => use(BLANK, { label: "a simple blank label" })} className={primary}>
            <PenLine className="h-4 w-4" aria-hidden="true" /> Start with a simple blank label
          </button>
          {mine.length ? (
            <>
              <p className="text-sm font-semibold text-slate-900">Or copy one of your templates</p>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {mine.map((t) => (
                  <li key={t.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
                    <p className="font-semibold text-slate-900">{t.name}</p>
                    <p className="text-xs text-slate-500">{sizeText(t.design)}</p>
                    <Preview design={t.design} kind={t.kind} />
                    <button type="button" onClick={() => use({ name: `${t.name} (copy)`, kind: t.kind, jurisdiction: t.jurisdiction, design: t.design }, { label: `a copy of ${t.name}` })} className="inline-flex min-h-9 items-center rounded-lg border border-brand-300 bg-white px-3 text-sm font-bold text-brand-800 hover:border-brand-600">
                      Copy and edit
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function UploadPanel({ aiReady, aiReason, onDone }: { aiReady: boolean; aiReason: string | null; onDone: (r: ImportResult, original: { url: string; pdf: boolean; name: string; file: File; kind: string }) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const preview = useMemo(() => (file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function read() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      if (kind) form.set("kind", kind);
      const res = await fetch("/api/labels/import", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "The label couldn't be read.");
      onDone(data as ImportResult, { url: URL.createObjectURL(file), pdf: file.type === "application/pdf" || /\.pdf$/i.test(file.name), name: file.name, file, kind });
    } catch (e) {
      setError((e as Error).message || "The label couldn't be read.");
    } finally {
      setBusy(false);
    }
  }

  if (!aiReady) {
    return (
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
        <p className="font-bold">Reading uploaded labels needs Tally AI.</p>
        <p className="mt-1">{aiReason === "PAUSED" ? "Tally AI is paused for this business." : "Tally AI isn't connected for this business yet."} An owner can connect it in Settings → Tally AI. You can still browse templates or get help choosing one.</p>
        <Link href="/settings" className="mt-3 inline-flex min-h-10 items-center rounded-lg border border-amber-400 bg-white px-3 font-semibold hover:border-amber-600">Open settings</Link>
      </section>
    );
  }
  return (
    <section className="space-y-4 rounded-xl border border-brand-100 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Upload a label you already use</h2>
        <p className="text-sm text-slate-600">A clear photo, a scan, or a PDF of a finished label. CannaTrace rebuilds it as an editable template and matches the words to your product, package, and lab fields.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {/* "capture" opens the phone's camera straight away; on a computer it just opens the file picker. */}
        <label className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-base font-bold text-white transition hover:bg-brand-700 focus-within:ring-2 focus-within:ring-brand-600 focus-within:ring-offset-2">
          <Camera className="h-5 w-5" aria-hidden="true" /> Take a photo
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ""; }} />
        </label>
        <label
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
          className={`flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-base font-bold text-brand-900 transition ${drag ? "bg-brand-200" : "bg-brand-50 hover:bg-brand-100"}`}
        >
          <FileUp className="h-5 w-5 text-brand-700" aria-hidden="true" /> Choose a photo or PDF
          <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ""; }} />
        </label>
      </div>
      <p className="text-xs text-slate-600">PNG, JPG, or PDF, up to 15 MB. Lay the label flat and take the photo straight on, in good light, close enough that the small print is sharp.</p>
      {file ? (
        <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-2 text-sm">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="The photo you picked" className="h-20 w-20 rounded object-cover ring-1 ring-slate-300" />
          ) : null}
          <span className="min-w-0 flex-1 truncate font-semibold text-slate-900">{file.name}</span>
          <button type="button" onClick={() => setFile(null)} className="min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-slate-500">Remove</button>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,260px)_1fr] sm:items-end">
        <Field label="What kind of label is it?" hint="Leave on automatic and CannaTrace will work it out.">
          <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Work it out automatically</option>
            {LABEL_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>{k.label}</option>
            ))}
          </select>
        </Field>
        <div>
          <button type="button" disabled={!file || busy} onClick={read} className={primary}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
            {busy ? "Reading your label…" : "Read this label"}
          </button>
        </div>
      </div>
      {busy ? <p role="status" className="text-sm text-slate-600">This usually takes 15 to 40 seconds. Please keep this page open.</p> : null}
      {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p> : null}
      <p className="text-xs text-slate-500">The picture is sent to your Claude account through Tally AI to read it, and isn&apos;t kept by CannaTrace. Nothing is saved until you review the result and press Save.</p>
    </section>
  );
}

function Gallery({ starters, onUse }: { starters: CatalogEntry[]; onUse: (t: CatalogEntry) => void }) {
  const groups = ["All", ...new Set(starters.map((s) => s.group))];
  const [group, setGroup] = useState("All");
  const [size, setSize] = useState("");
  const stock = STOCK_SIZES.find((s) => s.label === size);
  const shown = starters.filter((s) => (group === "All" || s.group === group) && (!stock || (Math.abs(s.design.widthMm - stock.widthMm) < 1 && Math.abs(s.design.heightMm - stock.heightMm) < 1)));
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by use">
          {groups.map((g) => (
            <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(g)} className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${group === g ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-brand-400"}`}>
              {g}
            </button>
          ))}
        </div>
        <label className="text-sm font-semibold text-slate-700">
          Roll size{" "}
          <select className={`${inputClass} !w-auto`} value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="">Any size</option>
            {STOCK_SIZES.map((s) => (
              <option key={s.label} value={s.label}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>
      {shown.length === 0 ? <p className="text-sm text-slate-600">No starter templates at that size. Try another, or upload a label you already use.</p> : null}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((t) => (
          <li key={t.name} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <p className="font-semibold text-slate-900">{t.name}</p>
            <p className="text-xs text-slate-500">
              {LABEL_KINDS.find((k) => k.kind === t.kind)?.label} · {sizeText(t.design)}
              {t.jurisdiction ? ` · ${t.jurisdiction} rules` : ""}
            </p>
            <Preview design={t.design} kind={t.kind} />
            <button type="button" onClick={() => onUse(t)} className="inline-flex min-h-9 items-center rounded-lg bg-brand-600 px-3 text-sm font-bold text-white hover:bg-brand-700">
              Use this template
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Helper({ starters, onUse }: { starters: CatalogEntry[]; onUse: (t: CatalogEntry) => void }) {
  const [useId, setUseId] = useState<UseId | "">("");
  const [size, setSize] = useState("");
  const picks = useId ? recommend(starters, { use: useId, size }) : [];
  const groups = [...new Set(USES.map((u) => u.group))];
  return (
    <section className="space-y-4 rounded-xl border border-brand-100 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold text-slate-900">Tell us what you&apos;re labeling</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What is the label for?">
          <select className={inputClass} value={useId} onChange={(e) => setUseId(e.target.value as UseId | "")}>
            <option value="">Choose…</option>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {USES.filter((u) => u.group === g).map((u) => (
                  <option key={u.id} value={u.id}>{u.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="What label roll is in your printer?" hint="It's printed on the roll's box or core, like 4 × 2 in.">
          <select className={inputClass} value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="">Not sure</option>
            {STOCK_SIZES.map((s) => (
              <option key={s.label} value={s.label}>{s.label}</option>
            ))}
          </select>
        </Field>
      </div>
      {useId && picks.length === 0 ? <p className="text-sm text-slate-600">No starter fits that yet. Try uploading a label you already use.</p> : null}
      <ul className="grid gap-4 sm:grid-cols-2">
        {picks.map((p, i) => (
          <li key={p.entry.name} className={`space-y-2 rounded-xl border p-3 ${i === 0 ? "border-brand-500 ring-2 ring-brand-200" : "border-slate-200"}`}>
            <p className="font-semibold text-slate-900">
              {p.entry.name}
              {i === 0 ? <span className="ml-2 rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-bold text-white">Best match</span> : null}
            </p>
            <ul className="list-disc pl-5 text-xs text-slate-600">
              {p.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <Preview design={p.entry.design} kind={p.entry.kind} />
            <button type="button" onClick={() => onUse(p.entry)} className="inline-flex min-h-9 items-center rounded-lg bg-brand-600 px-3 text-sm font-bold text-white hover:bg-brand-700">
              Use this template
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OtherLabels({ others, original, onRebuilt }: { others: { index: number; description: string }[]; original: { file?: File; kind?: string }; onRebuilt: (r: ImportResult) => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function go(index: number) {
    if (!original.file) return;
    setBusy(index);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", original.file);
      if (original.kind) form.set("kind", original.kind);
      form.set("pick", String(index));
      const res = await fetch("/api/labels/import", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "That label couldn't be read.");
      onRebuilt(data as ImportResult);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
      <p className="font-semibold text-slate-900">This photo has other labels. Rebuild a different one instead?</p>
      <ul className="mt-2 space-y-1.5">
        {others.map((o) => (
          <li key={o.index} className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-700">{o.description}</span>
            <button type="button" disabled={busy !== null} onClick={() => go(o.index)} className="inline-flex min-h-8 items-center rounded-lg border border-brand-300 bg-white px-3 font-bold text-brand-800 hover:border-brand-600 disabled:opacity-50">
              {busy === o.index ? "Reading…" : "Rebuild this one"}
            </button>
          </li>
        ))}
      </ul>
      {error ? <p role="alert" className="mt-2 text-xs font-semibold text-red-700">{error}</p> : null}
    </div>
  );
}
