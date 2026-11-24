"use client";

import { Barcode, Box, Image as ImageIcon, Minus, Printer, QrCode, Trash2, Type } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Field, inputClass } from "@/components/ui";
import { STOCK_SIZES } from "@/lib/labels/defaults";
import { fieldDef, fieldsFor, placeholders, sampleValues } from "@/lib/labels/fields";
import { elementSource, fieldNameValues, withField, withoutField } from "@/lib/labels/field-usage";
import { labelPackFor } from "@/lib/labels/jurisdictions";
import { renderLabelSvg } from "@/lib/labels/render-svg";
import { LABEL_KINDS, type ElementType, type LabelDesign, type LabelElement, type LabelKind } from "@/lib/labels/types";
import { checkDesign, checkJurisdiction, checkRecord } from "@/lib/labels/validate";
import { FieldPanel, PieceFields, RecordPicker, type PreviewRecord } from "./field-panel";
import { IssueList } from "./issues";
import { PrintNow } from "./print-now";

const STATES = "AK AL AR AZ CA CO CT DC DE FL GA HI IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY".split(" ");
const PX = 6; // screen pixels per millimetre in the editor
const snap = (v: number) => Math.round(v * 2) / 2;

type Props = {
  mode: "new" | "edit";
  templateId?: string;
  initial: { name: string; kind: LabelKind; jurisdiction: string | null; design: LabelDesign; version: number };
  /** Field values to show in the preview instead of the built-in examples (the words read from an uploaded photo). */
  previewValues?: Record<string, string>;
  versions?: { version: number; note: string | null; userName: string; createdAt: string }[];
};

const ADD: { type: ElementType; label: string; icon: typeof Type }[] = [
  { type: "text", label: "Text", icon: Type },
  { type: "barcode", label: "Barcode", icon: Barcode },
  { type: "qr", label: "QR code", icon: QrCode },
  { type: "image", label: "Image", icon: ImageIcon },
  { type: "line", label: "Line", icon: Minus },
  { type: "box", label: "Box", icon: Box },
];

export function LabelDesigner({ mode, templateId, initial, versions, previewValues }: Props) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [kind, setKind] = useState<LabelKind>(initial.kind);
  const [jurisdiction, setJurisdiction] = useState(initial.jurisdiction ?? "");
  const [design, setDesign] = useState<LabelDesign>(initial.design);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok?: string; error?: string } | null>(null);
  const [dirty, setDirty] = useState(mode === "new");
  // On the New template page, printing creates the template and keeps the person here; these track that.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [version, setVersion] = useState(initial.version);
  const savedId = templateId ?? createdId;
  const drag = useRef<{ id: string; mode: "move" | "resize"; sx: number; sy: number; el: LabelElement } | null>(null);

  const selected = design.elements.find((e) => e.id === selectedId) ?? null;
  const [record, setRecord] = useState<PreviewRecord | null>(null);
  const [showNames, setShowNames] = useState(false);
  // The data every check runs on: a real record's values as they are (blanks stay blank), otherwise examples.
  const values = useMemo<Record<string, string | null>>(
    () => (record ? record.values : { ...sampleValues(kind), "_lab.status": "PASS", "_package.status": "ACTIVE", "_package.quantity": "28", ...(previewValues ?? {}) }),
    [kind, previewValues, record],
  );
  const shown = useMemo(() => (showNames ? { ...values, ...fieldNameValues(kind) } : values), [showNames, values, kind]);
  const svg = useMemo(() => renderLabelSvg(design, shown, { scale: PX }), [design, shown]);
  const check = useMemo(() => {
    const j = checkJurisdiction(design, kind, jurisdiction || null);
    const issues = [...checkDesign(design, kind), ...checkRecord(design, kind, { ref: record?.ref ?? "Sample", sourceId: record?.sourceId ?? "sample", values }), ...j.issues];
    return { issues, blocked: issues.some((i) => i.severity === "block"), j };
  }, [design, kind, jurisdiction, values, record]);
  const pack = labelPackFor(jurisdiction);

  function update(next: LabelDesign) {
    setDesign(next);
    setDirty(true);
    setMessage(null);
  }
  function patch(id: string, p: Partial<LabelElement>) {
    update({ ...design, elements: design.elements.map((e) => (e.id === id ? { ...e, ...p } : e)) });
  }
  function add(type: ElementType) {
    const id = `e${crypto.randomUUID().slice(0, 8)}`;
    const w = Math.min(design.widthMm - 4, type === "qr" || type === "image" ? 15 : 40);
    const base: LabelElement = { id, type, x: 2, y: 2, w, h: type === "line" ? 0.5 : type === "text" ? 5 : 15 };
    const extra: Partial<LabelElement> =
      type === "text" ? { text: "New text", fontSize: 9 } : type === "barcode" ? { value: `{{${kind === "PLANT" ? "plant.tag" : kind === "BATCH" ? "batch.name" : "package.tag"}}}`, format: "code128", w: design.widthMm - 4, h: 10 } : type === "qr" ? { value: "" } : type === "line" || type === "box" ? { stroke: 0.3 } : {};
    update({ ...design, elements: [...design.elements, { ...base, ...extra }] });
    setSelectedId(id);
  }
  function remove(id: string) {
    update({ ...design, elements: design.elements.filter((e) => e.id !== id) });
    setSelectedId(null);
  }

  function onPointerDown(e: React.PointerEvent, el: LabelElement, mode: "move" | "resize") {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setSelectedId(el.id);
    drag.current = { id: el.id, mode, sx: e.clientX, sy: e.clientY, el };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / PX;
    const dy = (e.clientY - d.sy) / PX;
    if (d.mode === "move") patch(d.id, { x: Math.max(0, snap(d.el.x + dx)), y: Math.max(0, snap(d.el.y + dy)) });
    else patch(d.id, { w: Math.max(0.5, snap(d.el.w + dx)), h: Math.max(0.5, snap(d.el.h + dy)) });
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (!selected) return;
    const step = e.shiftKey ? 5 : 0.5;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      patch(selected.id, { x: Math.max(0, selected.x + moves[e.key][0]), y: Math.max(0, selected.y + moves[e.key][1]) });
    } else if ((e.key === "Delete" || e.key === "Backspace") && (e.target as HTMLElement).tagName !== "INPUT" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
      e.preventDefault();
      remove(selected.id);
    }
  }

  /**
   * Save the template. On the New template page the first save creates it and, unless `stay` is set (printing),
   * opens it. Returns the template's id, or null when it didn't save.
   */
  async function save(opts: { stay?: boolean } = {}): Promise<string | null> {
    setBusy(true);
    setMessage(null);
    try {
      const existing = savedId;
      const body = { name, kind, jurisdiction: jurisdiction || null, design, note, baseVersion: version };
      const res = await fetch(existing ? `/api/labels/templates/${existing}` : "/api/labels/templates", {
        method: existing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDirty(false);
      if (!existing) {
        setCreatedId(data.id);
        setVersion(1);
        if (opts.stay) setMessage({ ok: "Template saved. You can keep editing it here or open it from Label templates." });
        else router.push(`/labels/templates/${data.id}`);
        return data.id as string;
      }
      setVersion(Number(data.version) || version + 1);
      setMessage({ ok: `Saved as version ${data.version}.` });
      setNote("");
      router.refresh();
      return existing;
    } catch (e) {
      setMessage({ error: (e as Error).message || "Not saved." });
      return null;
    } finally {
      setBusy(false);
    }
  }
  /** Make sure the latest design is saved (creating the template if it's new) before printing it. */
  async function ensureSaved(): Promise<string | null> {
    if (savedId && !dirty) return savedId;
    return save({ stay: true });
  }

  const fields = fieldsFor(kind);
  const labelOf = (key: string) => fieldDef(key)?.label ?? key;
  /** Add a field to a piece: after its words for text, as the data for a barcode or QR code. */
  const addFieldTo = (el: LabelElement, key: string): Partial<LabelElement> | null =>
    el.type === "text" ? { text: withField(el.text, key) } : el.type === "barcode" || el.type === "qr" ? { value: `{{${key}}}` } : null;
  /** A new text piece holding just this field, placed at (x, y) or below the lowest piece. */
  function addFieldPiece(key: string, at?: { x: number; y: number }) {
    const id = `e${crypto.randomUUID().slice(0, 8)}`;
    const lowest = design.elements.reduce((m, e) => Math.max(m, e.y + e.h), 0);
    const w = Math.max(10, Math.min(40, design.widthMm - 4));
    const x = Math.min(Math.max(0, at?.x ?? 2), Math.max(0, design.widthMm - w));
    const y = Math.min(Math.max(0, at?.y ?? Math.min(lowest + 1, design.heightMm - 6)), Math.max(0, design.heightMm - 5));
    update({ ...design, elements: [...design.elements, { id, type: "text", x: snap(x), y: snap(y), w, h: 5, text: `{{${key}}}`, fontSize: 9 }] });
    setSelectedId(id);
  }
  /** Click a field: add it to the selected piece, or make a new piece for it. */
  function pickField(key: string) {
    const patchFor = selected ? addFieldTo(selected, key) : null;
    if (selected && patchFor) patch(selected.id, patchFor);
    else addFieldPiece(key);
  }
  const insertField = pickField;
  /** Drop a field on the label: onto a piece that can hold it, otherwise as a new piece where it landed. */
  function onDropField(e: React.DragEvent) {
    const key = e.dataTransfer.getData("text/x-label-field");
    if (!key) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / PX;
    const y = (e.clientY - rect.top) / PX;
    const hit = [...design.elements].reverse().find((el) => x >= el.x && x <= el.x + el.w && y >= el.y && y <= el.y + el.h && addFieldTo(el, key));
    if (hit) {
      patch(hit.id, addFieldTo(hit, key)!);
      setSelectedId(hit.id);
    } else addFieldPiece(key, { x, y });
  }

  return (
    <div className="space-y-5" onKeyDown={onKeyDown}>
      <section className="grid gap-3 rounded-xl border border-brand-100 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Template name">
          <input className={inputClass} value={name} maxLength={80} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
        </Field>
        <Field label="Label type">
          <select className={inputClass} value={kind} disabled={mode === "edit" || !!createdId} onChange={(e) => { setKind(e.target.value as LabelKind); setRecord(null); setDirty(true); }}>
            {LABEL_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="State rules" hint="Which state's label rules to check. Only states with verified rules get checked; others say so.">
          <select className={inputClass} value={jurisdiction} onChange={(e) => { setJurisdiction(e.target.value); setDirty(true); }}>
            <option value="">None (internal label)</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s}
                {labelPackFor(s) ? " (verified rules)" : " (no verified rules yet)"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Stock size">
          <select
            className={inputClass}
            value={STOCK_SIZES.find((s) => s.widthMm === design.widthMm && s.heightMm === design.heightMm)?.label ?? "custom"}
            onChange={(e) => {
              const s = STOCK_SIZES.find((x) => x.label === e.target.value);
              if (s) update({ ...design, widthMm: s.widthMm, heightMm: s.heightMm });
            }}
          >
            {STOCK_SIZES.map((s) => (
              <option key={s.label} value={s.label}>
                {s.label}
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Width mm">
            <input type="number" step="0.1" min={5} max={300} className={inputClass} value={design.widthMm} onChange={(e) => update({ ...design, widthMm: Number(e.target.value) || 0 })} />
          </Field>
          <Field label="Height mm">
            <input type="number" step="0.1" min={5} max={300} className={inputClass} value={design.heightMm} onChange={(e) => update({ ...design, heightMm: Number(e.target.value) || 0 })} />
          </Field>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0 space-y-3 rounded-xl border border-brand-100 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap gap-1.5">
            {ADD.map((a) => (
              <button key={a.type} type="button" onClick={() => add(a.type)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 text-sm font-semibold text-brand-800 hover:border-brand-500">
                <a.icon className="h-4 w-4" aria-hidden="true" /> {a.label}
              </button>
            ))}
          </div>
          <RecordPicker kind={kind} record={record} onChange={setRecord} autoPick={mode === "edit"} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">Drag to move, drag the corner to resize, arrow keys nudge 0.5 mm (Shift for 5 mm). Showing {showNames ? "field names" : record ? `${record.ref}'s data` : "example data"}. Blue pieces fill in from the record.</p>
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-xs font-semibold" role="group" aria-label="What the preview shows">
              <button type="button" aria-pressed={!showNames} onClick={() => setShowNames(false)} className={`px-3 py-1.5 ${!showNames ? "bg-brand-600 text-white" : "bg-white text-slate-700"}`}>
                Data
              </button>
              <button type="button" aria-pressed={showNames} onClick={() => setShowNames(true)} className={`px-3 py-1.5 ${showNames ? "bg-brand-600 text-white" : "bg-white text-slate-700"}`}>
                Field names
              </button>
            </div>
          </div>
          <div className="overflow-auto rounded-lg bg-slate-100 p-6" onClick={() => setSelectedId(null)}>
            <div
              className="relative mx-auto bg-white shadow-md ring-1 ring-slate-300"
              style={{ width: design.widthMm * PX, height: design.heightMm * PX }}
              onPointerMove={onPointerMove}
              onPointerUp={() => (drag.current = null)}
              onDragOver={(e) => e.dataTransfer.types.includes("text/x-label-field") && e.preventDefault()}
              onDrop={onDropField}
              data-testid="designer-canvas"
            >
              <div className="pointer-events-none absolute inset-0 [&>svg]:block" dangerouslySetInnerHTML={{ __html: svg }} />
              {design.elements.map((el) => {
                const on = el.id === selectedId;
                const bad = check.issues.some((i) => i.elementId === el.id && i.severity === "block");
                const dynamic = placeholders(elementSource(el)).length > 0;
                return (
                  <div
                    key={el.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${el.type} element`}
                    onPointerDown={(e) => onPointerDown(e, el, "move")}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={() => setSelectedId(el.id)}
                    className={`absolute cursor-move outline-none ${on ? "ring-2 ring-brand-600" : bad ? "ring-2 ring-red-500" : dynamic ? "bg-brand-200/30 ring-1 ring-brand-300 hover:ring-brand-500" : "hover:ring-1 hover:ring-brand-400"}`}
                    style={{ left: el.x * PX, top: el.y * PX, width: Math.max(4, el.w * PX), height: Math.max(4, el.h * PX) }}
                  >
                    {on ? <span onPointerDown={(e) => onPointerDown(e, el, "resize")} className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-white bg-brand-600" /> : null}
                  </div>
                );
              })}
            </div>
          </div>
          <IssueList
            issues={check.issues}
            blocked={check.blocked}
            pack={pack && check.j.pack ? { state: pack.state, name: pack.name, source: pack.source, url: pack.url, checked: pack.checked } : null}
            checkedRules={check.j.checked}
            manualRules={check.j.manual}
          />
        </section>

        <aside className="space-y-4">
          <PrintNow kind={kind} design={design} sampleValues={values} record={record} dirty={dirty} ensureSaved={ensureSaved} />
          <FieldPanel kind={kind} design={design} values={values} usingRecord={!!record} onPick={pickField} />
          <section className="space-y-3 rounded-xl border border-brand-100 bg-white p-4 shadow-sm">
            <h2 className="font-bold text-brand-950">{selected ? `Selected ${selected.type}` : "Nothing selected"}</h2>
            {selected ? (
              <>
                <div className="grid grid-cols-4 gap-2">
                  {(["x", "y", "w", "h"] as const).map((k) => (
                    <Field key={k} label={k.toUpperCase()}>
                      <input type="number" step="0.5" className={inputClass} value={selected[k]} onChange={(e) => patch(selected.id, { [k]: Number(e.target.value) || 0 })} />
                    </Field>
                  ))}
                </div>
                {selected.type === "text" ? (
                  <>
                    <Field label="Text" hint="Words you type print the same on every label. Fields fill in from each package.">
                      <textarea rows={3} className={`${inputClass} py-2`} value={selected.text ?? ""} onChange={(e) => patch(selected.id, { text: e.target.value })} />
                    </Field>
                    <PieceFields keys={placeholders(selected.text)} values={values} labelOf={labelOf} onRemove={(k) => patch(selected.id, { text: withoutField(selected.text, k) })} />
                    <div className="grid grid-cols-3 gap-2">
                      <Field label="Size pt">
                        <input type="number" min={2} max={72} step="0.5" className={inputClass} value={selected.fontSize ?? 8} onChange={(e) => patch(selected.id, { fontSize: Number(e.target.value) || 8 })} />
                      </Field>
                      <Field label="Align">
                        <select className={inputClass} value={selected.align ?? "left"} onChange={(e) => patch(selected.id, { align: e.target.value as LabelElement["align"] })}>
                          <option value="left">Left</option>
                          <option value="center">Center</option>
                          <option value="right">Right</option>
                        </select>
                      </Field>
                      <label className="mt-6 flex items-center gap-2 text-sm font-semibold">
                        <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!!selected.bold} onChange={(e) => patch(selected.id, { bold: e.target.checked })} /> Bold
                      </label>
                    </div>
                  </>
                ) : null}
                {selected.type === "barcode" || selected.type === "qr" ? (
                  <>
                    <Field label="Data" hint="Use a field so each label encodes its own record. Fixed text gives every label the same code.">
                      <input className={inputClass} value={selected.value ?? ""} onChange={(e) => patch(selected.id, { value: e.target.value })} />
                    </Field>
                    {selected.type === "barcode" ? (
                      <Field label="Format">
                        <select className={inputClass} value={selected.format ?? "code128"} onChange={(e) => patch(selected.id, { format: e.target.value as LabelElement["format"] })}>
                          <option value="code128">Code 128 (most scanners)</option>
                          <option value="datamatrix">Data Matrix (small square)</option>
                        </select>
                      </Field>
                    ) : null}
                  </>
                ) : null}
                {selected.type === "text" || selected.type === "barcode" || selected.type === "qr" ? (
                  <Field label="Insert a field">
                    <select className={inputClass} value="" onChange={(e) => e.target.value && insertField(e.target.value)}>
                      <option value="">Choose…</option>
                      {[...new Set(fields.map((f) => f.group))].map((group) => (
                        <optgroup key={group} label={group}>
                          {fields
                            .filter((f) => f.group === group)
                            .map((f) => (
                              <option key={f.key} value={f.key}>
                                {f.label}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                  </Field>
                ) : null}
                {selected.type === "image" ? (
                  <>
                    <Field label="Image (PNG or JPEG, under 300 KB)">
                      <input
                        type="file"
                        accept="image/png,image/jpeg"
                        className="block w-full text-sm"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (file.size > 300_000) return setMessage({ error: "That image is over 300 KB. Use a smaller file." });
                          const reader = new FileReader();
                          reader.onload = () => patch(selected.id, { src: String(reader.result) });
                          reader.readAsDataURL(file);
                        }}
                      />
                    </Field>
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={selected.role === "STATE_LOGO"} onChange={(e) => patch(selected.id, { role: e.target.checked ? "STATE_LOGO" : "LOGO" })} />
                      This is the state&apos;s required cannabis logo
                    </label>
                  </>
                ) : null}
                {selected.type === "line" || selected.type === "box" ? (
                  <Field label="Thickness mm">
                    <input type="number" step="0.1" min={0.1} max={5} className={inputClass} value={selected.stroke ?? 0.3} onChange={(e) => patch(selected.id, { stroke: Number(e.target.value) || 0.3 })} />
                  </Field>
                ) : null}
                <button type="button" onClick={() => remove(selected.id)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-700 hover:underline">
                  <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove
                </button>
              </>
            ) : (
              <p className="text-sm text-slate-600">Click something on the label to edit it, or add a new element.</p>
            )}
          </section>

          <section className="space-y-3 rounded-xl border border-brand-100 bg-white p-4 shadow-sm">
            {savedId ? (
              <Field label="What changed (optional)">
                <input className={inputClass} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Bigger barcode" />
              </Field>
            ) : null}
            <button type="button" disabled={busy || !dirty} onClick={() => void save()} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-brand-600 px-5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50">
              {busy ? "Saving…" : !savedId ? "Create template" : dirty ? `Save as version ${version + 1}` : "Saved"}
            </button>
            {savedId ? (
              <div className="space-y-1 border-t border-slate-200 pt-3">
                <Link
                  href={`/labels?kind=${kind}&template=${savedId}${record ? `&ids=${encodeURIComponent(record.sourceId)}` : ""}`}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border-2 border-brand-600 bg-white px-5 text-sm font-bold text-brand-800 hover:bg-brand-50"
                  data-testid="print-with-template"
                >
                  <Printer className="h-4 w-4" aria-hidden="true" /> Print many labels (choose packages)
                </Link>
                <p className="text-xs text-slate-600">{dirty ? "Prints the last saved version. Save your changes first." : record ? "Opens the print page for several packages, with this one ready." : "Opens the print page to choose several packages at once."}</p>
              </div>
            ) : null}
            {check.blocked ? <p className="text-xs text-amber-800">You can save a design with problems, but labels won&apos;t print from it until they&apos;re fixed.</p> : null}
            {message?.ok ? <p role="status" className="text-sm font-semibold text-brand-800">{message.ok}</p> : null}
            {message?.error ? <p role="alert" className="text-sm font-semibold text-red-700">{message.error}</p> : null}
          </section>

          {versions?.length ? (
            <section className="rounded-xl border border-brand-100 bg-white p-4 shadow-sm">
              <h2 className="mb-2 font-bold text-brand-950">Versions</h2>
              <ul className="space-y-1 text-sm">
                {versions.map((v) => (
                  <li key={v.version} className="text-slate-700">
                    <span className="font-semibold">v{v.version}</span> · {v.userName} · {new Date(v.createdAt).toLocaleDateString("en-US")}
                    {v.note ? <span className="text-slate-500"> · {v.note}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
