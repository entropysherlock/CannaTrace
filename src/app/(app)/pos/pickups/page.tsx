import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { PosTabs } from "@/components/pos-tabs";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { getMenuSettings, pickupQueue, type ReservationView } from "@/lib/online-menu";
import { can } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/session";
import { unitLabel } from "@/lib/units";
import Decimal from "decimal.js";
import { pickupStatusAction, startPickupSaleAction } from "../actions";

const STATUS_LABEL: Record<string, string> = { NEW: "Waiting", READY: "Ready for pickup", IN_SALE: "At the register", CANCELLED: "Cancelled" };

function ago(when: Date): string {
  const mins = Math.max(0, Math.round((Date.now() - when.getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} hr ago` : `${Math.round(hours / 24)} d ago`;
}

function Row({ r }: { r: ReservationView }) {
  const open = r.status === "NEW" || r.status === "READY";
  const short = r.lines.filter((l) => new Decimal(l.inStock).lt(l.quantity));
  return (
    <li className="py-4 first:pt-0 last:pb-0" data-testid="pickup-row">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-bold text-slate-900">
          {r.number} · {r.customerName}
        </p>
        <p className="text-sm text-slate-600">
          {STATUS_LABEL[r.status] ?? r.status} · {ago(r.createdAt)}
        </p>
      </div>
      <p className="text-sm text-slate-700">
        <a href={`tel:${r.phone}`} className="font-semibold text-brand-700 hover:underline">
          {r.phone.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3")}
        </a>
        {r.note ? ` · “${r.note}”` : ""}
      </p>
      <ul className="mt-2 text-sm">
        {r.lines.map((l) => (
          <li key={l.itemId} className="flex justify-between gap-2">
            <span>
              {new Decimal(l.quantity).toString()} {unitLabel(l.unit as never)} · {l.name}
            </span>
            <span className="tabular-nums">${new Decimal(l.unitPrice).mul(l.quantity).toFixed(2)}</span>
          </li>
        ))}
      </ul>
      {open && short.length > 0 ? (
        <p role="note" className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-950">
          Not enough in stock now: {short.map((l) => `${l.name} (${new Decimal(l.inStock).toString()} left)`).join(", ")}.
        </p>
      ) : null}
      {r.status === "IN_SALE" && r.saleId ? (
        <Link href={`/pos/sales/${r.saleId}`} className="mt-2 inline-block text-sm font-semibold text-brand-700 hover:underline">
          Open the sale
        </Link>
      ) : null}
      {open ? (
        <div className="mt-3 flex flex-wrap items-start gap-2">
          {r.status === "NEW" ? (
            <ActionForm action={pickupStatusAction} submitLabel="Mark ready" quiet className="flex items-start">
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="status" value="READY" />
            </ActionForm>
          ) : null}
          <ActionForm action={pickupStatusAction} submitLabel="Cancel" quiet className="flex items-start">
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="status" value="CANCELLED" />
          </ActionForm>
          <details className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3">
            <summary className="cursor-pointer font-bold text-brand-800">Customer is here: check ID and start the sale</summary>
            <ActionForm action={startPickupSaleAction} submitLabel="Check ID and open the cart" className="mt-3">
              <input type="hidden" name="id" value={r.id} />
              <Field label="Customer type">
                <select name="customerType" className={inputClass} defaultValue="ADULT_USE">
                  <option value="ADULT_USE">Adult use</option>
                  <option value="MEDICAL">Medical</option>
                </select>
              </Field>
              <Field label="Date of birth (from ID)">
                <input name="birthDate" type="date" required className={inputClass} />
              </Field>
              <Field label="ID expires">
                <input name="idExpires" type="date" required className={inputClass} />
              </Field>
              <Field label="ID number" hint="Only needed when the store counts limits per customer per day. It is not saved.">
                <input name="idNumber" autoComplete="off" className={inputClass} />
              </Field>
            </ActionForm>
          </details>
        </div>
      ) : null}
    </li>
  );
}

export default async function PickupsPage() {
  const session = await requirePagePermission("pos.use");
  const [queue, menu] = await Promise.all([pickupQueue(session), getMenuSettings(session.facilityId)]);
  const open = queue.filter((r) => r.status === "NEW" || r.status === "READY");
  const recent = queue.filter((r) => r.status === "IN_SALE" || r.status === "CANCELLED");
  const canManage = can(session, "pos.manage");
  return (
    <>
      <PageHeader title="Pickups" subtitle="Reservations customers made on your online menu. Nothing leaves stock until you ring the sale up." />
      <PosTabs current="/pos/pickups" canManage={canManage} pickups={open.length} />
      {!menu?.enabled ? (
        <p role="note" className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          The online menu is off for this store.{" "}
          {canManage ? (
            <Link href="/pos/menu" className="font-semibold text-brand-700 hover:underline">
              Turn it on under Menu and store rules
            </Link>
          ) : (
            "A manager can turn it on under Menu and store rules."
          )}
        </p>
      ) : (
        <p className="mb-5 text-sm text-slate-700">
          Your menu is live at{" "}
          <Link href={`/menu/${menu.slug}`} className="font-semibold text-brand-700 hover:underline" target="_blank">
            /menu/{menu.slug}
          </Link>
          .
        </p>
      )}
      <div className="space-y-5">
        <Card title={`Waiting (${open.length})`}>
          {open.length === 0 ? <p className="text-sm text-slate-600">No reservations waiting.</p> : <ul className="divide-y divide-slate-100">{open.map((r) => <Row key={r.id} r={r} />)}</ul>}
        </Card>
        {recent.length > 0 ? (
          <Card title="Done or cancelled (last day)">
            <ul className="divide-y divide-slate-100">{recent.map((r) => <Row key={r.id} r={r} />)}</ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
