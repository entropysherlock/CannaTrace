"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { applyHarvestSheetAction, applyInvoiceAction, applyLicenseAction, applyPriceListAction, applyWholesaleOrderAction } from "@/app/(app)/inbox/actions";
import type { HarvestContext, InvoiceContext, LicenseContext, OrderContext, PriceContext } from "@/lib/scan/apply";
import type { DocProposal } from "@/lib/scan/types";
import { inputClass } from "./ui";

type Base = { attachmentId: string; name: string; isPdf: boolean; proposal: DocProposal };
const small = "block text-xs font-semibold text-slate-600";
const field = (p: DocProposal, key: string) => p.fields.find((f) => f.key === key)?.value ?? "";
const money = (v: string) => (v ? `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : "");

/** The document beside the work: what Tally found on the right, the original on the left, one button at the bottom. */
function Shell({ base, testid, kicker, title, subtitle, children, status, action, disabled, pending, onClick }: { base: Base; testid: string; kicker: string; title: string; subtitle: string; children: ReactNode; status: ReactNode; action: string; disabled: boolean; pending: boolean; onClick: () => void }) {
  const src = `/api/assistant/attachments/${base.attachmentId}`;
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)]" data-testid={testid}>
      <div className="xl:sticky xl:top-4 xl:self-start">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {base.isPdf ? (
            <object data={src} type="application/pdf" className="h-[70vh] w-full" aria-label={base.name}>
              <p className="p-6 text-sm text-slate-600">This browser can&apos;t show the PDF here. <a className="font-semibold underline" href={src}>Open it</a>.</p>
            </object>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={base.name} className="max-h-[75vh] w-full bg-slate-100 object-contain" />
          )}
        </div>
        <p className="mt-2 truncate text-xs text-slate-500">{base.name}</p>
      </div>
      <div className="space-y-5 pb-28">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-700">{kicker}</p>
          <h2 className="font-display text-xl font-bold">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
        </section>
        {base.proposal.warnings.length ? (
          <ul className="space-y-2" data-testid="doc-warnings">
            {base.proposal.warnings.map((w) => (
              <li key={w} className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {w}
              </li>
            ))}
          </ul>
        ) : null}
        {children}
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 p-3 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-slate-700" role="status">{status}</p>
          <Link href="/inbox" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold hover:bg-slate-50">Not now</Link>
          <button type="button" disabled={disabled || pending} onClick={onClick} className="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50" data-testid="apply-button">
            {pending ? "Saving…" : action}
          </button>
        </div>
      </div>
    </div>
  );
}

function Done({ title, body, links, problems }: { title: string; body: string; links: { href: string; label: string; primary?: boolean }[]; problems?: string[] }) {
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-brand-200 bg-white p-8 text-center shadow-sm" data-testid="scan-done">
      <CheckCircle2 className="mx-auto h-12 w-12 text-brand-600" aria-hidden="true" />
      <h2 className="mt-3 font-display text-2xl font-bold">{title}</h2>
      <p className="mt-1 text-slate-600">{body}</p>
      {problems?.length ? (
        <ul className="mt-3 space-y-1 rounded-lg bg-amber-50 p-3 text-left text-sm font-semibold text-amber-900">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {links.map((l) => (
          // A full load, so the lists show what was just saved.
          <a key={l.href} href={l.href} className={l.primary ? "rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-800" : "rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold hover:bg-slate-50"}>{l.label}</a>
        ))}
      </div>
    </div>
  );
}

const err = (e: string | null) => (e ? <span className="font-semibold text-red-700" role="alert">{e}</span> : null);

/* ------------------------------------------------------------ Invoice */

export function InvoiceApply({ base, ctx }: { base: Base; ctx: InvoiceContext }) {
  const p = base.proposal;
  const [rows, setRows] = useState(ctx.lines.map((l) => ({ include: Boolean(l.packageId) && l.currentCost === null, packageId: l.packageId, cost: l.unitPrice })));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.include);
  const missing = chosen.filter((r) => !r.packageId || !r.cost).length;
  if (done !== null) return <Done title={`Recorded costs on ${done} package${done === 1 ? "" : "s"}`} body="Cost per unit now follows these packages into production runs and reports." links={[{ href: "/inventory", label: "See the packages", primary: true }, { href: "/inbox", label: "Back to the inbox" }]} />;
  return (
    <Shell
      base={base}
      testid="invoice-apply"
      kicker="Invoice"
      title={`${field(p, "vendor") || ctx.vendorName || "Vendor not found"}${field(p, "invoiceNumber") ? ` · ${field(p, "invoiceNumber")}` : ""}`}
      subtitle={[field(p, "invoiceDate") && `Dated ${field(p, "invoiceDate")}`, field(p, "total") && `Total ${money(field(p, "total"))}`].filter(Boolean).join(" · ")}
      status={err(error) ?? (missing ? `${missing} ticked line${missing === 1 ? " needs" : "s need"} a package and a cost.` : chosen.length ? `Ready to record ${chosen.length} cost${chosen.length === 1 ? "" : "s"}.` : "Tick the lines to cost.")}
      action={`Record ${chosen.length} cost${chosen.length === 1 ? "" : "s"}`}
      disabled={!chosen.length || missing > 0}
      pending={pending}
      onClick={() =>
        start(async () => {
          setError(null);
          const r = await applyInvoiceAction({ attachmentId: base.attachmentId, lines: chosen.map((x) => ({ packageId: x.packageId, costPerUnit: x.cost })) });
          if (r.ok) setDone(r.count);
          else setError(r.error);
        })
      }
    >
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-bold">Lines <span className="font-normal text-slate-500">({rows.length})</span></h3>
        <p className="mt-1 text-sm text-slate-600">Each line sets the cost per unit on the package you received. Tax and shipping are not spread across the lines.</p>
        <ul className="mt-3 space-y-3" data-testid="invoice-lines">
          {rows.map((r, i) => {
            const l = ctx.lines[i];
            const current = l.candidates.find((c) => c.id === r.packageId)?.cost ?? null;
            return (
              <li key={i} className={`rounded-xl border p-3 ${r.include ? "border-slate-200" : "border-slate-200 bg-slate-50 opacity-80"}`}>
                <label className="flex items-start gap-3">
                  <input type="checkbox" checked={r.include} onChange={(e) => set(i, { include: e.target.checked })} className="mt-1 h-5 w-5 accent-brand-700" aria-label={`Cost line ${i + 1}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{l.description || "No description"}</span>
                    <span className="block text-xs text-slate-500">Invoice: {l.quantity || "?"} at {money(l.unitPrice) || "?"}</span>
                  </span>
                </label>
                {!l.itemId ? <p className="mt-2 text-sm font-semibold text-amber-900">No matching item in your catalog, so there is nothing to cost.</p> : !l.candidates.length ? <p className="mt-2 text-sm font-semibold text-amber-900">Nothing of this item has been received here yet. Receive it first.</p> : (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className={small}>
                      Package
                      <select value={r.packageId} onChange={(e) => set(i, { packageId: e.target.value })} className={inputClass} aria-label={`Package for line ${i + 1}`}>
                        <option value="">Choose a package</option>
                        {l.candidates.map((c) => (
                          <option key={c.id} value={c.id}>{c.label}{c.cost ? ` · costs ${money(c.cost)}` : ""}</option>
                        ))}
                      </select>
                    </label>
                    <label className={small}>
                      Cost per unit
                      <input value={r.cost} inputMode="decimal" onChange={(e) => set(i, { cost: e.target.value.replace(/[$,]/g, "") })} className={inputClass} aria-label={`Cost for line ${i + 1}`} />
                    </label>
                    {current ? <p className="text-sm font-semibold text-amber-900 sm:col-span-2">This package already has a cost of {money(current)}. Tick the line to replace it.</p> : null}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </Shell>
  );
}

/* ------------------------------------------------------------ Harvest sheet */

export function HarvestApply({ base, ctx }: { base: Base; ctx: HarvestContext }) {
  const [rows, setRows] = useState(ctx.rows.map((r) => ({ ...r, include: Boolean(r.plantId) })));
  const [name, setName] = useState(ctx.name);
  const [unit, setUnit] = useState(["G", "KG", "OZ", "LB"].includes(ctx.unit) ? ctx.unit : "G");
  const [room, setRoom] = useState(ctx.rooms.length === 1 ? ctx.rooms[0].id : "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ plants: number } | null>(null);
  const [pending, start] = useTransition();
  const chosen = rows.filter((r) => r.include && r.plantId);
  const total = chosen.reduce((a, r) => a + (Number(r.weight.replace(/,/g, "")) || 0), 0);
  const bad = chosen.filter((r) => !(Number(r.weight) > 0)).length;
  if (done) return <Done title={`Harvest recorded: ${done.plants} plant${done.plants === 1 ? "" : "s"}`} body="It is drying now. Come back to the Dry step when it is ready to weigh." links={[{ href: "/cultivation", label: "Open the Grow guide", primary: true }, { href: "/cultivation/harvests", label: "See harvests" }]} />;
  return (
    <Shell
      base={base}
      testid="harvest-apply"
      kicker="Harvest sheet"
      title={ctx.strain ? `${ctx.strain} harvest` : "Harvest sheet"}
      subtitle={[field(base.proposal, "harvestDate") && `Harvested ${field(base.proposal, "harvestDate")}`, field(base.proposal, "room") && `Room ${field(base.proposal, "room")}`].filter(Boolean).join(" · ")}
      status={err(error) ?? (!room ? "Choose the room where it will dry." : !name.trim() ? "Give the harvest a name." : bad ? "Every ticked plant needs a weight." : chosen.length ? `Ready: ${chosen.length} plants, ${total.toLocaleString("en-US", { maximumFractionDigits: 2 })} total.` : "Tick the plants that were harvested.")}
      action={`Record harvest (${chosen.length})`}
      disabled={!chosen.length || !room || !name.trim() || bad > 0}
      pending={pending}
      onClick={() =>
        start(async () => {
          setError(null);
          const r = await applyHarvestSheetAction({ attachmentId: base.attachmentId, name, unit, locationId: room, rows: chosen.map((x) => ({ plantId: x.plantId, weight: x.weight })) });
          if (r.ok) setDone({ plants: r.plants });
          else setError(r.error);
        })
      }
    >
      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-3">
        <label className={small}>
          Harvest name
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} data-testid="harvest-name" />
        </label>
        <label className={small}>
          Dry in room
          <select value={room} onChange={(e) => setRoom(e.target.value)} className={inputClass} data-testid="harvest-room">
            <option value="">Choose a room</option>
            {ctx.rooms.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>
        <label className={small}>
          Weights are in
          <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inputClass}>
            <option value="G">Grams</option>
            <option value="KG">Kilograms</option>
            <option value="OZ">Ounces</option>
            <option value="LB">Pounds</option>
          </select>
        </label>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-bold">Plants <span className="font-normal text-slate-500">({rows.length})</span></h3>
        <ul className="mt-3 divide-y divide-slate-100" data-testid="harvest-rows">
          {rows.map((r, i) => (
            <li key={i} className="flex flex-wrap items-center gap-3 py-2">
              <input type="checkbox" checked={r.include} disabled={!r.plantId} onChange={(e) => setRows((all) => all.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))} className="h-5 w-5 accent-brand-700" aria-label={`Harvest plant ${i + 1}`} />
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-sm font-semibold">{r.tag || "No tag"}</span>
                {r.note ? <span className="block text-xs font-semibold text-amber-800">{r.note}</span> : null}
              </span>
              <input value={r.weight} inputMode="decimal" onChange={(e) => setRows((all) => all.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))} className={`${inputClass} !w-28`} aria-label={`Weight for plant ${i + 1}`} />
            </li>
          ))}
        </ul>
      </section>
    </Shell>
  );
}

/* ------------------------------------------------------------ License */

export function LicenseApply({ base, ctx }: { base: Base; ctx: LicenseContext }) {
  const [target, setTarget] = useState(ctx.matched);
  const [expires, setExpires] = useState(ctx.expires);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ label: string; expires: string } | null>(null);
  const [pending, start] = useTransition();
  const current = ctx.targets.find((t) => t.key === target)?.current ?? null;
  if (done) return <Done title={`Saved: ${done.label} expires ${done.expires}`} body={target.startsWith("F:") ? "You will see a warning on the Dashboard 60 days before it expires." : "You will see a warning on the Dashboard 30 days before it expires, and it can't receive shipments once it has."} links={[{ href: "/dashboard", label: "Go to the Dashboard", primary: true }, { href: "/inbox", label: "Back to the inbox" }]} />;
  return (
    <Shell
      base={base}
      testid="license-apply"
      kicker="License"
      title={field(base.proposal, "holder") || "License"}
      subtitle={[field(base.proposal, "licenseType"), field(base.proposal, "licenseNumber") && `No. ${field(base.proposal, "licenseNumber")}`, field(base.proposal, "issuer") && `Issued by ${field(base.proposal, "issuer")}`].filter(Boolean).join(" · ")}
      status={err(error) ?? (!target ? "Choose whose license this is." : !expires ? "Enter the expiry date." : "Ready to save the expiry date.")}
      action="Save expiry date"
      disabled={!target || !expires}
      pending={pending}
      onClick={() =>
        start(async () => {
          setError(null);
          const r = await applyLicenseAction({ attachmentId: base.attachmentId, target, expires });
          if (r.ok) setDone({ label: r.label, expires: r.expires });
          else setError(r.error);
        })
      }
    >
      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2">
        <label className={small}>
          Whose license is it {ctx.matched && target === ctx.matched ? <span className="text-brand-700">· matched by license number</span> : null}
          <select value={target} onChange={(e) => setTarget(e.target.value)} className={inputClass} data-testid="license-target">
            <option value="">Choose one</option>
            {ctx.targets.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className={small}>
          Expires
          <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className={inputClass} data-testid="license-expires" />
        </label>
        <p className="text-sm text-slate-600 sm:col-span-2">{current ? `On file now: expires ${current}.` : target ? "No expiry date is on file for this one yet." : ""}</p>
      </section>
    </Shell>
  );
}

/* ------------------------------------------------------------ Price list */

export function PriceListApply({ base, ctx }: { base: Base; ctx: PriceContext }) {
  const [rows, setRows] = useState(ctx.rows.map((r) => ({ ...r, include: true })));
  const [listId, setListId] = useState("");
  const [newName, setNewName] = useState(ctx.newListName);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ prices: number; created: number; listName: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.include);
  const fresh = chosen.filter((r) => !r.itemId).length;
  const bad = chosen.filter((r) => !r.price || (!r.itemId && !r.product.trim())).length;
  if (done) return <Done title={`Saved ${done.prices} price${done.prices === 1 ? "" : "s"} to ${done.listName}`} body={done.created ? `${done.created} new item${done.created === 1 ? " was" : "s were"} added to your catalog.` : "All of these products were already in your catalog."} links={[{ href: "/catalog", label: "See the items", primary: true }, { href: "/distribution/prices", label: "See price lists" }]} />;
  return (
    <Shell
      base={base}
      testid="price-apply"
      kicker="Price list"
      title={field(base.proposal, "vendor") || "Price list"}
      subtitle={field(base.proposal, "effectiveDate") ? `Effective ${field(base.proposal, "effectiveDate")}` : ""}
      status={err(error) ?? (!listId && !newName.trim() ? "Name the new price list." : bad ? "Every ticked product needs a name and a price." : chosen.length ? `Ready: ${chosen.length} price${chosen.length === 1 ? "" : "s"}${fresh ? `, ${fresh} new item${fresh === 1 ? "" : "s"}` : ""}.` : "Tick the products to save.")}
      action={`Save ${chosen.length} price${chosen.length === 1 ? "" : "s"}`}
      disabled={!chosen.length || bad > 0 || (!listId && !newName.trim())}
      pending={pending}
      onClick={() =>
        start(async () => {
          setError(null);
          const r = await applyPriceListAction({ attachmentId: base.attachmentId, listId, newListName: newName, rows: chosen.map((x) => ({ itemId: x.itemId, sku: x.sku, product: x.product, category: x.category, unit: x.unit, price: x.price })) });
          if (r.ok) setDone(r);
          else setError(r.error);
        })
      }
    >
      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2">
        <label className={small}>
          Save the prices to
          <select value={listId} onChange={(e) => setListId(e.target.value)} className={inputClass} data-testid="price-list">
            <option value="">A new price list</option>
            {ctx.lists.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
        {!listId ? (
          <label className={small}>
            New price list name
            <input value={newName} onChange={(e) => setNewName(e.target.value)} className={inputClass} data-testid="price-new-name" />
          </label>
        ) : null}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-bold">Products <span className="font-normal text-slate-500">({rows.length})</span></h3>
        <datalist id="price-categories">
          {ctx.categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <ul className="mt-3 space-y-3" data-testid="price-rows">
          {rows.map((r, i) => (
            <li key={i} className={`rounded-xl border p-3 ${r.include ? "border-slate-200" : "border-slate-200 bg-slate-50 opacity-70"}`}>
              <label className="flex items-start gap-3">
                <input type="checkbox" checked={r.include} onChange={(e) => set(i, { include: e.target.checked })} className="mt-1 h-5 w-5 accent-brand-700" aria-label={`Save product ${i + 1}`} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{r.product || "No name"}{r.sku ? <span className="font-normal text-slate-500"> · {r.sku}</span> : null}</span>
                  <span className={`block text-xs font-semibold ${r.itemId ? "text-brand-700" : "text-amber-800"}`}>{r.itemId ? `Updates your item ${r.itemLabel}` : "Will be added as a new item"}</span>
                </span>
              </label>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <label className={small}>
                  Price
                  <input value={r.price} inputMode="decimal" onChange={(e) => set(i, { price: e.target.value.replace(/[$,]/g, "") })} className={inputClass} aria-label={`Price for product ${i + 1}`} />
                </label>
                {!r.itemId ? (
                  <>
                    <label className={small}>
                      Category
                      <input value={r.category} list="price-categories" onChange={(e) => set(i, { category: e.target.value })} className={inputClass} aria-label={`Category for product ${i + 1}`} />
                    </label>
                    <label className={small}>
                      Unit
                      <select value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} className={inputClass} aria-label={`Unit for product ${i + 1}`}>
                        {["EACH", "G", "KG", "OZ", "LB", "MG", "ML", "L"].map((u) => (
                          <option key={u} value={u}>{u === "EACH" ? "Each" : u}</option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </Shell>
  );
}

/* ------------------------------------------------------------ Wholesale order */

export function OrderApply({ base, ctx }: { base: Base; ctx: OrderContext }) {
  const [customerId, setCustomerId] = useState(ctx.customerId);
  const [rows, setRows] = useState(ctx.lines.map((l) => ({ ...l, include: true })));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ orderId: string; number: string; added: number; problems: string[] } | null>(null);
  const [pending, start] = useTransition();
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.include);
  const missing = chosen.filter((r) => !r.itemId || !(Number(r.quantity) > 0)).length;
  if (done) return <Done title={`Draft order ${done.number} created`} body={`${done.added} line${done.added === 1 ? "" : "s"} added. It is a draft: nothing is reserved or shipped until you confirm it.`} problems={done.problems} links={[{ href: `/distribution/orders/${done.orderId}`, label: "Review and confirm the order", primary: true }, { href: "/inbox", label: "Back to the inbox" }]} />;
  return (
    <Shell
      base={base}
      testid="order-apply"
      kicker="Wholesale order"
      title={`${field(base.proposal, "customer") || "Customer not found"}${ctx.orderNumber ? ` · ${ctx.orderNumber}` : ""}`}
      subtitle={[field(base.proposal, "orderDate") && `Ordered ${field(base.proposal, "orderDate")}`, field(base.proposal, "deliveryDate") && `Deliver by ${field(base.proposal, "deliveryDate")}`, field(base.proposal, "total") && `Total ${money(field(base.proposal, "total"))}`].filter(Boolean).join(" · ")}
      status={err(error) ?? (!customerId ? "Choose the customer." : missing ? `${missing} line${missing === 1 ? " needs" : "s need"} an item and a quantity.` : chosen.length ? `Ready to make a draft order with ${chosen.length} line${chosen.length === 1 ? "" : "s"}.` : "Tick the lines to add.")}
      action="Create draft order"
      disabled={!customerId || !chosen.length || missing > 0}
      pending={pending}
      onClick={() =>
        start(async () => {
          setError(null);
          const r = await applyWholesaleOrderAction({ attachmentId: base.attachmentId, customerId, lines: chosen.map((x) => ({ itemId: x.itemId, quantity: x.quantity, unitPrice: x.unitPrice })) });
          if (r.ok) setDone(r);
          else setError(r.error);
        })
      }
    >
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className={small}>
          Customer {ctx.customerId && customerId === ctx.customerId ? <span className="text-brand-700">· matched from the order</span> : null}
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={inputClass} data-testid="order-customer">
            <option value="">Choose a customer</option>
            {ctx.customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-bold">Lines <span className="font-normal text-slate-500">({rows.length})</span></h3>
        <p className="mt-1 text-sm text-slate-600">Leave the price blank to use the customer&apos;s price list.</p>
        <ul className="mt-3 space-y-3" data-testid="order-lines">
          {rows.map((r, i) => (
            <li key={i} className={`rounded-xl border p-3 ${r.include ? "border-slate-200" : "border-slate-200 bg-slate-50 opacity-70"}`}>
              <label className="flex items-start gap-3">
                <input type="checkbox" checked={r.include} onChange={(e) => set(i, { include: e.target.checked })} className="mt-1 h-5 w-5 accent-brand-700" aria-label={`Add line ${i + 1}`} />
                <span className="min-w-0 flex-1 font-semibold">{r.description || "No description"}</span>
              </label>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <label className={`${small} sm:col-span-1`}>
                  Item {r.itemId ? <span className="text-brand-700">· matched</span> : <span className="text-amber-700">· pick one</span>}
                  <select value={r.itemId} onChange={(e) => set(i, { itemId: e.target.value })} className={inputClass} aria-label={`Item for line ${i + 1}`}>
                    <option value="">Choose an item</option>
                    {ctx.items.map((it) => (
                      <option key={it.id} value={it.id}>{it.label}</option>
                    ))}
                  </select>
                </label>
                <label className={small}>
                  Quantity
                  <input value={r.quantity} inputMode="decimal" onChange={(e) => set(i, { quantity: e.target.value })} className={inputClass} aria-label={`Quantity for line ${i + 1}`} />
                </label>
                <label className={small}>
                  Price each
                  <input value={r.unitPrice} inputMode="decimal" placeholder="List price" onChange={(e) => set(i, { unitPrice: e.target.value.replace(/[$,]/g, "") })} className={inputClass} aria-label={`Price for line ${i + 1}`} />
                </label>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </Shell>
  );
}
