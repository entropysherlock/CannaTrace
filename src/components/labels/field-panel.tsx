"use client";

import { AlertTriangle, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { inputClass } from "@/components/ui";
import { fieldsFor, type FieldDef } from "@/lib/labels/fields";
import { fieldsUsed } from "@/lib/labels/field-usage";
import type { LabelDesign, LabelKind } from "@/lib/labels/types";

export type PreviewRecord = { ref: string; sourceId: string; values: Record<string, string | null> };
type Candidate = { id: string; ref: string; detail: string; status?: string };

const KIND_NOUN: Record<LabelKind, string> = { PACKAGE: "package", PRODUCT: "package", PLANT: "plant", BATCH: "plant batch", TRANSFER: "order" };

/** Choose a real package (or plant, batch, order) to preview the label with, instead of example data. */
export function RecordPicker({ kind, record, onChange }: { kind: LabelKind; record: PreviewRecord | null; onChange: (r: PreviewRecord | null) => void }) {
  const [loaded, setLoaded] = useState<{ kind: LabelKind; list: Candidate[] | null; error: string | null } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = loaded?.kind === kind ? loaded : null;
  const list = current?.list ?? null;
  const error = actionError ?? current?.error ?? null;

  useEffect(() => {
    let live = true;
    fetch(`/api/labels/records?kind=${kind}`)
      .then(async (r) => ({ ok: r.ok, data: await r.json() }))
      .then(({ ok, data }) => live && setLoaded({ kind, list: ok ? (data.records ?? []) : null, error: ok ? null : (data.error ?? "Couldn't load your records.") }))
      .catch(() => live && setLoaded({ kind, list: null, error: "Couldn't load your records." }));
    return () => {
      live = false;
    };
  }, [kind]);

  async function choose(id: string) {
    if (!id) return onChange(null);
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/labels/records?kind=${kind}&id=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onChange({ ref: data.ref, sourceId: data.sourceId, values: data.values });
    } catch (e) {
      setActionError((e as Error).message || "Couldn't load that record.");
    } finally {
      setBusy(false);
    }
  }

  const index = list && record ? list.findIndex((c) => c.id === record.sourceId) : -1;
  const step = (d: number) => {
    if (!list?.length) return;
    const next = list[(Math.max(index, 0) + d + list.length) % list.length];
    void choose(next.id);
  };
  const noun = KIND_NOUN[kind];

  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="record-picker">
      <label className="min-w-0 flex-1 text-sm font-semibold text-slate-700">
        Preview with a real {noun}
        <select className={`${inputClass} mt-1`} value={record?.sourceId ?? ""} disabled={busy || !list} onChange={(e) => void choose(e.target.value)}>
          <option value="">Example data</option>
          {record && index < 0 ? <option value={record.sourceId}>{record.ref}</option> : null}
          {(list ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.ref} · {c.detail}
            </option>
          ))}
        </select>
      </label>
      <button type="button" aria-label={`Previous ${noun}`} disabled={busy || !list?.length} onClick={() => step(-1)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:border-brand-500 disabled:opacity-40">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <button type="button" aria-label={`Next ${noun}`} disabled={busy || !list?.length} onClick={() => step(1)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:border-brand-500 disabled:opacity-40">
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
      {error ? <p className="w-full text-xs font-semibold text-red-700">{error}</p> : list && list.length === 0 ? <p className="w-full text-xs text-slate-500">No {noun}s yet, so the preview uses example data.</p> : null}
    </div>
  );
}

const blank = (v: string | null | undefined) => v == null || String(v).trim() === "";

/** Every field you can put on this label, with its value for the previewed record. Click one, or drag it onto the label. */
export function FieldPanel({ kind, design, values, usingRecord, onPick }: { kind: LabelKind; design: LabelDesign; values: Record<string, string | null>; usingRecord: boolean; onPick: (key: string) => void }) {
  const [q, setQ] = useState("");
  const all = useMemo(() => fieldsFor(kind).filter((f) => !f.key.startsWith("_")), [kind]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((f) => f.label.toLowerCase().includes(needle) || f.key.toLowerCase().includes(needle) || f.group.toLowerCase().includes(needle)) : all;
  }, [all, q]);
  const groups = useMemo(() => [...new Set(shown.map((f) => f.group))], [shown]);
  const used = useMemo(() => fieldsUsed(design), [design]);
  const empties = usingRecord ? used.filter((u) => blank(values[u.key]) && !all.find((f) => f.key === u.key)?.optional) : [];

  return (
    <section className="space-y-3 rounded-xl border border-brand-100 bg-white p-4 shadow-sm" data-testid="field-panel">
      <div>
        <h2 className="font-bold text-brand-950">Fields from your records</h2>
        <p className="text-xs text-slate-600">A field fills in from each package when you print, so one template works for every batch. Click a field to add it, or drag it onto the label.</p>
      </div>
      {used.length ? (
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">On this label ({used.length})</p>
          <ul className="space-y-1">
            {used.map((u) => {
              const empty = usingRecord && blank(values[u.key]) && !all.find((f) => f.key === u.key)?.optional;
              return (
                <li key={u.key} className={`flex items-baseline justify-between gap-2 rounded-md px-2 py-1 text-xs ${empty ? "bg-amber-50 text-amber-900" : "bg-brand-50 text-brand-900"}`}>
                  <span className="font-semibold">{u.label}</span>
                  <span className={`min-w-0 truncate ${empty ? "font-semibold" : "text-slate-600"}`}>{empty ? "empty on this record" : (values[u.key] ?? "")}</span>
                </li>
              );
            })}
          </ul>
          {empties.length ? (
            <p className="mt-2 flex gap-1.5 text-xs font-semibold text-amber-900" role="status">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {empties.length} field{empties.length === 1 ? " is" : "s are"} empty for this record: {empties.map((e) => e.label).join(", ")}. That label would print with a blank there.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-600">No fields on this label yet. Everything on it is typed text, so every label prints the same.</p>
      )}
      <label className="relative block">
        <span className="sr-only">Search fields</span>
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
        <input className={`${inputClass} pl-8`} placeholder="Search fields (lot, strain, THC…)" value={q} onChange={(e) => setQ(e.target.value)} />
        {q ? (
          <button type="button" aria-label="Clear search" onClick={() => setQ("")} className="absolute right-2 top-2.5 text-slate-400 hover:text-slate-700">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </label>
      <div className="max-h-96 space-y-3 overflow-auto pr-1">
        {groups.map((g) => (
          <div key={g}>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">{g}</p>
            <div className="flex flex-wrap gap-1.5">
              {shown
                .filter((f) => f.group === g)
                .map((f) => (
                  <FieldChip key={f.key} field={f} value={values[f.key]} onPick={onPick} />
                ))}
            </div>
          </div>
        ))}
        {shown.length === 0 ? <p className="text-xs text-slate-500">No field matches &ldquo;{q}&rdquo;.</p> : null}
      </div>
    </section>
  );
}

function FieldChip({ field, value, onPick }: { field: FieldDef; value: string | null | undefined; onPick: (key: string) => void }) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/x-label-field", field.key);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => onPick(field.key)}
      title={value ? `${field.label}: ${value}` : field.label}
      className="inline-flex min-h-8 cursor-grab items-center rounded-full border border-brand-200 bg-brand-50 px-2.5 text-xs font-semibold text-brand-900 hover:border-brand-500 active:cursor-grabbing"
    >
      {field.label.replace(/\s*\(.*$/, "")}
    </button>
  );
}

/** The fields inside one piece's text, as removable chips with what each holds right now. */
export function PieceFields({ keys, values, labelOf, onRemove }: { keys: string[]; values: Record<string, string | null>; labelOf: (key: string) => string; onRemove: (key: string) => void }) {
  if (!keys.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Fields in this piece">
      {keys.map((k) => (
        <li key={k} className="inline-flex items-center gap-1 rounded-full bg-brand-100 py-0.5 pl-2.5 pr-1 text-xs font-semibold text-brand-900">
          {labelOf(k)}
          {values[k] ? <span className="max-w-28 truncate font-normal text-slate-600">= {values[k]}</span> : null}
          <button type="button" aria-label={`Remove ${labelOf(k)}`} onClick={() => onRemove(k)} className="rounded-full p-0.5 hover:bg-brand-200">
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}
