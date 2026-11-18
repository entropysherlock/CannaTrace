"use client";

import { Barcode, Box, Image as ImageIcon, Minus, QrCode, Trash2, Type } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Field, inputClass } from "@/components/ui";
import { STOCK_SIZES } from "@/lib/labels/defaults";
import { fieldsFor, sampleValues } from "@/lib/labels/fields";
import { labelPackFor } from "@/lib/labels/jurisdictions";
import { renderLabelSvg } from "@/lib/labels/render-svg";
import { LABEL_KINDS, type ElementType, type LabelDesign, type LabelElement, type LabelKind } from "@/lib/labels/types";
import { checkDesign, checkJurisdiction, checkRecord } from "@/lib/labels/validate";
import { IssueList } from "./issues";

const STATES = "AK AL AR AZ CA CO CT DC DE FL GA HI IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY".split(" ");
const PX = 6; // screen pixels per millimetre in the editor
const snap = (v: number) => Math.round(v * 2) / 2;

type Props = {
  mode: "new" | "edit";
  templateId?: string;
  initial: { name: string; kind: LabelKind; jurisdiction: string | null; design: LabelDesign; version: number };
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

export function LabelDesigner({ mode, templateId, initial, versions }: Props) {
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
  const drag = useRef<{ id: string; mode: "move" | "resize"; sx: number; sy: number; el: LabelElement } | null>(null);

  const selected = design.elements.find((e) => e.id === selectedId) ?? null;
  const values = useMemo(() => ({ ...sampleValues(kind), "_lab.status": "PASS", "_package.status": "ACTIVE", "_package.quantity": "28" }), [kind]);
  const svg = useMemo(() => renderLabelSvg(design, values, { scale: PX }), [design, values]);
  const check = useMemo(() => {
    const j = checkJurisdiction(design, kind, jurisdiction || null);
    const issues = [...checkDesign(design, kind), ...checkRecord(design, kind, { ref: "Sample", sourceId: "sample", values }), ...j.issues];
    return { issues, blocked: issues.some((i) => i.severity === "block"), j };
  }, [design, kind, jurisdiction, values]);
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

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const body = { name, kind, jurisdiction: jurisdiction || null, design, note, baseVersion: initial.version };
      const res = await fetch(mode === "new" ? "/api/labels/templates" : `/api/labels/templates/${templateId}`, {
        method: mode === "new" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDirty(false);
      if (mode === "new") router.push(`/labels/templates/${data.id}`);
      else {
        setMessage({ ok: `Saved as version ${data.version}.` });
        setNote("");
        router.refresh();
      }
    } catch (e) {
      setMessage({ error: (e as Error).message || "Not saved." });
    } finally {
      setBusy(false);
    }
  }

  const fields = fieldsFor(kind);
  const insertField = (key: string) => {
    if (!selected) return;
    if (selected.type === "text") patch(selected.id, { text: `${selected.text ?? ""}{{${key}}}` });
    else if (selected.type === "barcode" || selected.type === "qr") patch(selected.id, { value: `{{${key}}}` });
  };

  return (
    <div className="space-y-5" onKeyDown={onKeyDown}>
      <section className="grid gap-3 rounded-xl border border-brand-100 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Template name">
          <input className={inputClass} value={name} maxLength={80} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
        </Field>
        <Field label="Label type">
          <select className={inputClass} value={kind} disabled={mode === "edit"} onChange={(e) => { setKind(e.target.value as LabelKind); setDirty(true); }}>
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
          <p className="text-xs text-slate-500">Drag to move, drag the corner to resize, arrow keys nudge 0.5 mm (Shift for 5 mm). Showing sample data.</p>
          <div className="overflow-auto rounded-lg bg-slate-100 p-6" onClick={() => setSelectedId(null)}>
            <div className="relative mx-auto bg-white shadow-md ring-1 ring-slate-300" style={{ width: design.widthMm * PX, height: design.heightMm * PX }} onPointerMove={onPointerMove} onPointerUp={() => (drag.current = null)} data-testid="designer-canvas">
              <div className="pointer-events-none absolute inset-0 [&>svg]:block" dangerouslySetInnerHTML={{ __html: svg }} />
              {design.elements.map((el) => {
                const on = el.id === selectedId;
                const bad = check.issues.some((i) => i.elementId === el.id && i.severity === "block");
                return (
                  <div
                    key={el.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${el.type} element`}
                    onPointerDown={(e) => onPointerDown(e, el, "move")}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={() => setSelectedId(el.id)}
                    className={`absolute cursor-move outline-none ${on ? "ring-2 ring-brand-600" : bad ? "ring-2 ring-red-500" : "hover:ring-1 hover:ring-brand-400"}`}
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
                    <Field label="Text">
                      <textarea rows={3} className={`${inputClass} py-2`} value={selected.text ?? ""} onChange={(e) => patch(selected.id, { text: e.target.value })} />
                    </Field>
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
            {mode === "edit" ? (
              <Field label="What changed (optional)">
                <input className={inputClass} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Bigger barcode" />
              </Field>
            ) : null}
            <button type="button" disabled={busy || !dirty} onClick={save} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-brand-600 px-5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50">
              {busy ? "Saving…" : mode === "new" ? "Create template" : dirty ? `Save as version ${initial.version + 1}` : "Saved"}
            </button>
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
