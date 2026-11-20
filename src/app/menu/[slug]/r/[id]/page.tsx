import Link from "next/link";
import { notFound } from "next/navigation";
import { publicReservation } from "@/lib/online-menu";

export const instant = false;
export const metadata = { title: "Your reservation", robots: { index: false } };

const STATUS: Record<string, string> = {
  NEW: "Received. The store will have it ready for you.",
  READY: "Ready for pickup.",
  IN_SALE: "Picked up. Thank you!",
  CANCELLED: "Cancelled. Call the store if this is a surprise.",
};

export default async function ReservationPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const r = await publicReservation(slug, id);
  if (!r) notFound();
  return (
    <main className="mx-auto min-h-screen max-w-lg px-5 py-10 text-slate-900">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="reservation-confirmation">
        <p className="text-sm font-semibold text-brand-700">{r.storeName}</p>
        <h1 className="mt-1 text-2xl font-extrabold">Reservation {r.number}</h1>
        <p className="mt-2 font-semibold">{STATUS[r.status] ?? r.status}</p>
        <p className="mt-1 text-slate-700">Thanks, {r.firstName}. Bring a valid ID and pay at the store. We&apos;ll check what&apos;s in stock and purchase limits when you arrive.</p>
        <ul className="mt-4 divide-y divide-slate-100 border-y border-slate-100">
          {r.lines.map((l) => (
            <li key={l.name} className="flex justify-between py-2 text-sm">
              <span>{Number(l.quantity)} × {l.name}</span>
              <span className="tabular-nums">${(Number(l.unitPrice) * Number(l.quantity)).toFixed(2)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-slate-500">Estimate before tax.</p>
        {r.pickupNote ? <p className="mt-4 whitespace-pre-line rounded-lg bg-brand-50 p-3 text-sm text-brand-950">{r.pickupNote}</p> : null}
        <Link href={`/menu/${r.slug}`} className="mt-5 inline-block font-semibold text-brand-700 hover:underline">Back to the menu</Link>
      </div>
    </main>
  );
}
