"use client";

import { Gift, X } from "lucide-react";
import { useRef, useState } from "react";
import { terminalRewardsFind, terminalRewardsJoin, terminalRewardsRemove, terminalRewardsUse, type TerminalResult } from "@/app/(app)/pos/terminal-actions";

export type RewardsView = {
  member: { firstName: string; phone: string; points: number } | null;
  redeemPoints: number;
  redeemDollars: string;
  maxSharePercent: number;
  /** Rewards the shopper picked, and how many fit this cart right now. */
  used: number;
  applied: number;
  /** The most this shopper could use on this cart now (their points and the cap). */
  available: number;
  earnPreview: number;
};

const money = (n: number) => `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;

/**
 * The cart's rewards box: find the shopper by phone (or sign them up, with their agreement), see their points,
 * and pick how many rewards to use. Every change goes through the server, which enforces the points and the
 * New Mexico cap; this only shows the choices.
 */
export function RewardsPanel({
  saleId,
  view,
  pending,
  act,
}: {
  saleId: string;
  view: RewardsView;
  pending: boolean;
  act: (work: () => Promise<TerminalResult>, okText?: string, after?: (r: TerminalResult) => void) => void;
}) {
  const [phone, setPhone] = useState("");
  const [joining, setJoining] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [birthday, setBirthday] = useState("");
  const [agreed, setAgreed] = useState(false);
  const phoneBox = useRef<HTMLInputElement>(null);
  const each = Number(view.redeemDollars);

  const find = () => {
    // Read the box itself, so a pasted or browser-filled number counts even if the page missed the change.
    const typed = phoneBox.current?.value ?? phone;
    if (!typed.trim()) {
      phoneBox.current?.focus();
      return;
    }
    setPhone(typed);
    act(
      () => terminalRewardsFind(saleId, typed),
      undefined,
      (r) => {
        if (r.notFound) setJoining(true);
        else if (!r.error) setPhone("");
      },
    );
  };

  if (view.member) {
    const m = view.member;
    const toNext = view.redeemPoints - (m.points % view.redeemPoints);
    const choices = Array.from({ length: Math.min(view.available, 6) }, (_, i) => i + 1);
    return (
      <section className="rounded-xl bg-white p-3 ring-1 ring-slate-200" aria-label="Rewards">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 text-sm">
            <Gift className="mr-1 inline h-4 w-4 text-brand-700" aria-hidden="true" />
            <span className="font-semibold text-slate-900">{m.firstName}</span>
            <span className="text-slate-500"> · {m.phone} · </span>
            <span className="font-semibold tabular-nums text-slate-900">{m.points} pts</span>
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => act(() => terminalRewardsRemove(saleId))}
            className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            aria-label={`Take ${m.firstName}'s rewards off this cart`}
          >
            <X className="h-4 w-4" aria-hidden="true" /> Remove
          </button>
        </div>
        {choices.length || view.used ? (
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Rewards to use">
            {[0, ...choices].map((count) => {
              const on = view.used === count;
              return (
                <button
                  key={count}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={pending}
                  onClick={() => act(() => terminalRewardsUse(saleId, count))}
                  className={`h-9 rounded-full px-3 text-sm font-semibold ${on ? "bg-brand-700 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:ring-brand-600"}`}
                >
                  {count === 0 ? "Don't use" : `${money(each * count)} off (${view.redeemPoints * count} pts)`}
                </button>
              );
            })}
          </div>
        ) : null}
        <p className="mt-2 text-xs text-slate-600">
          {view.used > view.applied
            ? `The cart got smaller, so ${view.applied} of the ${view.used} rewards chosen fit now. `
            : ""}
          {m.points < view.redeemPoints
            ? `${toNext} more points to a ${money(each)} reward. `
            : view.available === 0
              ? `Rewards can pay for up to ${view.maxSharePercent}% of a cart (no free cannabis in New Mexico). `
              : ""}
          {view.earnPreview > 0 ? `Earns ${view.earnPreview} points on this sale.` : ""}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl bg-white p-3 ring-1 ring-slate-200" aria-label="Rewards">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          find();
        }}
      >
        <label htmlFor="rewards-phone" className="flex shrink-0 items-center gap-1 text-sm font-semibold text-slate-800">
          <Gift className="h-4 w-4 text-brand-700" aria-hidden="true" /> Rewards
        </label>
        <input
          id="rewards-phone"
          ref={phoneBox}
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setJoining(false);
          }}
          inputMode="tel"
          autoComplete="off"
          placeholder="Shopper's phone"
          aria-label="Shopper's phone number"
          className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 px-2 text-sm"
        />
        <button type="submit" disabled={pending} className="h-9 rounded-lg bg-brand-700 px-3 text-sm font-semibold text-white disabled:bg-slate-300">
          Find
        </button>
      </form>
      {joining ? (
        <form
          className="mt-3 space-y-2 border-t border-slate-100 pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            act(
              () => terminalRewardsJoin({ saleId, phone, firstName, birthday, agreed }),
              undefined,
              (r) => {
                if (!r.error) {
                  setJoining(false);
                  setPhone("");
                  setFirstName("");
                  setBirthday("");
                  setAgreed(false);
                }
              },
            );
          }}
        >
          <p className="text-sm font-semibold text-slate-900">No rewards account for that number. Sign them up?</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-semibold text-slate-700">
              First name
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required maxLength={40} className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2 text-sm font-normal" />
            </label>
            <label className="text-xs font-semibold text-slate-700">
              Birthday (optional)
              <input value={birthday} onChange={(e) => setBirthday(e.target.value)} placeholder="e.g. 3/14" className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2 text-sm font-normal" />
            </label>
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-800">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-5 w-5 accent-brand-700" />
            The shopper agreed to join rewards (their phone number and first name are saved to earn points).
          </label>
          <p className="text-xs text-slate-500">
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700 underline">
              Privacy Policy
            </a>{" "}
            (opens in a new tab)
          </p>
          <div className="flex gap-2">
            <button type="submit" disabled={pending || !agreed || !firstName.trim()} className="h-9 rounded-lg bg-brand-700 px-3 text-sm font-semibold text-white disabled:bg-slate-300">
              Sign up
            </button>
            <button type="button" onClick={() => setJoining(false)} className="h-9 rounded-lg px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100">
              Not now
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

/**
 * The cart only carries one slim line for rewards, so the totals and Pay button always stay on screen. The full
 * box (phone lookup, sign-up, reward choices) opens over the register from that line.
 */
export function RewardsLine({
  saleId,
  view,
  rewardDollars,
  compact,
  pending,
  act,
}: {
  saleId: string;
  view: RewardsView;
  /** Sits beside the search box: a fixed-width button instead of a full-width line. */
  compact?: boolean;
  /** What this cart gets off from rewards, as dollars text (0 when none). */
  rewardDollars: string;
  pending: boolean;
  act: (work: () => Promise<TerminalResult>, okText?: string, after?: (r: TerminalResult) => void) => void;
}) {
  const [open, setOpen] = useState(false);
  const m = view.member;
  const used = Number(rewardDollars) > 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open rewards"
        className={`flex items-center justify-between gap-2 rounded-xl bg-white px-3 text-left text-sm ring-1 ring-slate-200 hover:ring-brand-600 ${compact ? "min-h-14 w-48 shrink-0 sm:w-60" : "h-11 w-full"}`}
      >
        <span className="flex min-w-0 items-center gap-2 font-semibold text-slate-800">
          <Gift className="h-4 w-4 shrink-0 text-brand-700" aria-hidden="true" />
          <span className="truncate">{m ? `${m.firstName} · ${m.points} pts` : "Rewards"}</span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-brand-700">
          {m ? (used ? `${money(Number(rewardDollars))} off · Change` : view.available > 0 ? "Reward available" : "View") : "Add shopper"}
        </span>
      </button>
      {open ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label="Rewards">
          <div className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl bg-white p-3 shadow-xl">
            <RewardsPanel saleId={saleId} view={view} pending={pending} act={act} />
            <button type="button" onClick={() => setOpen(false)} className="mt-3 h-11 w-full rounded-xl bg-brand-700 text-base font-bold text-white hover:bg-brand-800">
              Done
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
