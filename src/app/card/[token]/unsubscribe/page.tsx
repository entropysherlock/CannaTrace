import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { cardByToken } from "@/lib/loyalty";
import { cardConsentAction } from "../actions";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };
export const instant = false;

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c = await cardByToken(token);
  if (!c) notFound();
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <main className="mx-auto max-w-md space-y-4 px-5 py-10">
        <h1 className="text-2xl font-extrabold text-brand-950">Stop emails from {c.shop}?</h1>
        <p className="text-sm text-slate-700">{c.consent.EMAIL ? "Press the button and we'll stop sending you marketing emails right away." : "You're already unsubscribed from marketing emails."}</p>
        {c.consent.EMAIL ? (
          <ActionForm action={cardConsentAction} submitLabel="Unsubscribe me">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="channel" value="EMAIL" />
            <input type="hidden" name="agreed" value="no" />
            <input type="hidden" name="via" value="unsubscribe" />
          </ActionForm>
        ) : null}
        <p className="text-sm">
          <a href={`/card/${token}`} className="font-semibold text-brand-700 underline">
            See my rewards card
          </a>
        </p>
      </main>
    </div>
  );
}
