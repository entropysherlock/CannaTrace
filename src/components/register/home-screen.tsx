"use client";

import { BadgeCheck, CalendarDays, IdCard, PauseCircle, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { terminalCheckIn, terminalOpenDrawer } from "@/app/(app)/pos/terminal-actions";
import { ageOn, checkInProblem, parseIdBarcode, type CustomerType, type IdScan } from "@/lib/pos-math";
import { beep } from "./feedback";
import { money } from "./pay-panel";
import { Toasts, useToasts } from "./shell";
import { useScanner } from "./use-scanner";

export type HomeView = {
  today: string;
  rulesSaved: boolean;
  canManage: boolean;
  drawerOpen: boolean;
  ages: { adultMinAge: number; medicalMinAge: number };
  /** Purchase limits count per customer per day, so the ID number is needed. */
  dailyLimits: boolean;
  heldCarts: { id: string; number: string; items: number; clerk: string; since: string; other?: boolean }[];
  shift: { sales: number; total: string } | null;
  recent: { id: string; number: string; status: string; total: string | null; time: string }[];
};

const bigButton =
  "flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-brand-700 text-xl font-bold text-white shadow-sm hover:bg-brand-800 disabled:bg-slate-300 disabled:text-slate-500";

function OpenDrawer() {
  const [amount, setAmount] = useState("");
  const [pending, start] = useTransition();
  const { toasts, push } = useToasts();
  return (
    <div className="flex h-full items-center justify-center p-6">
      <form
        className="w-full max-w-md space-y-5 rounded-3xl bg-white p-8 shadow-sm ring-1 ring-slate-200"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await terminalOpenDrawer(amount);
            if (r.error) {
              beep("error");
              push("error", r.error);
            } else beep("ok");
          });
        }}
      >
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Open the drawer</h1>
          <p className="mt-1 text-slate-600">Count the cash in the till before the first sale.</p>
        </div>
        <label className="block">
          <span className="text-sm font-semibold text-slate-600">Starting cash</span>
          <span className="mt-1 flex items-center rounded-xl border-2 border-slate-200 px-4 focus-within:border-brand-600">
            <span className="font-display text-3xl font-bold text-slate-400">$</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              autoFocus
              required
              aria-label="Starting cash"
              placeholder="200.00"
              className="h-16 w-full bg-transparent px-2 font-display text-4xl font-bold tabular-nums outline-none placeholder:text-slate-300"
            />
          </span>
        </label>
        <button type="submit" disabled={pending || !amount} className={bigButton}>
          {pending ? "Opening…" : "Open drawer"}
        </button>
      </form>
      <Toasts toasts={toasts} />
    </div>
  );
}

function CheckIn({ view }: { view: HomeView }) {
  const router = useRouter();
  const [type, setType] = useState<CustomerType>("ADULT_USE");
  const [scanned, setScanned] = useState<IdScan | null>(null);
  const [manual, setManual] = useState(false);
  const [birthDate, setBirthDate] = useState("");
  const [idExpires, setIdExpires] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [pending, start] = useTransition();
  const { toasts, push } = useToasts();
  const startButton = useRef<HTMLButtonElement>(null);

  const onScan = useCallback(
    (text: string) => {
      const id = parseIdBarcode(text);
      if (!id) {
        beep("error");
        push("error", "That didn't read as a driver's license or state ID. Scan the barcode on the back, or type the dates.");
        return;
      }
      setScanned(id);
      setManual(false);
      setBirthDate(id.birthDate);
      setIdExpires(id.idExpires);
      setIdNumber(id.idNumber ?? "");
      beep(checkInProblem({ ...id, customerType: type }, view.ages, view.today) ? "error" : "ok");
    },
    [push, type, view.ages, view.today],
  );
  useScanner(onScan);

  // Next.js keeps a visited page alive, hidden, and shows it again on return. Forget the last
  // customer's ID as soon as this screen is left, so it is never shown to the next one.
  useEffect(
    () => () => {
      setScanned(null);
      setManual(false);
      setBirthDate("");
      setIdExpires("");
      setIdNumber("");
      setType("ADULT_USE");
    },
    [],
  );

  const needsNumber = view.dailyLimits && !idNumber.trim();
  const ready = Boolean(birthDate && idExpires);
  const problem = ready ? checkInProblem({ birthDate, idExpires, customerType: type }, view.ages, view.today) : null;
  const age = ready ? ageOn(birthDate, view.today) : null;
  useEffect(() => {
    if (ready && !problem) startButton.current?.focus();
  }, [ready, problem]);

  const begin = () =>
    start(async () => {
      const r = await terminalCheckIn({ birthDate, idExpires, customerType: type, idNumber: idNumber.trim() || undefined });
      if (r.error || !r.saleId) {
        beep("error");
        push("error", r.error ?? "Could not start the cart.");
        return;
      }
      router.push(`/pos/sales/${r.saleId}`);
    });

  const reset = () => {
    setScanned(null);
    setBirthDate("");
    setIdExpires("");
    setIdNumber("");
  };

  return (
    <section aria-label="Check in a customer" className="flex flex-col rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold tracking-tight">Next customer</h1>
        <div role="radiogroup" aria-label="Customer type" className="flex rounded-xl bg-slate-100 p-1">
          {(
            [
              ["ADULT_USE", `Adult use ${view.ages.adultMinAge}+`],
              ["MEDICAL", `Medical ${view.ages.medicalMinAge}+`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={type === id}
              onClick={() => setType(id)}
              className={`h-11 rounded-lg px-4 text-base font-semibold ${type === id ? "bg-white text-brand-900 shadow-sm" : "text-slate-600"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {type === "MEDICAL" ? <p className="mt-2 text-sm font-medium text-amber-800">Check the patient&apos;s medical card as well as their ID.</p> : null}

      {ready ? (
        <div className={`mt-6 rounded-2xl p-6 ${problem ? "bg-red-50 ring-2 ring-red-200" : "bg-brand-50 ring-2 ring-brand-200"}`}>
          <div className="flex items-start gap-4">
            {problem ? <ShieldAlert className="h-12 w-12 shrink-0 text-red-700" aria-hidden="true" /> : <BadgeCheck className="h-12 w-12 shrink-0 text-brand-700" aria-hidden="true" />}
            <div className="min-w-0">
              {scanned?.firstName || scanned?.lastName ? (
                <p className="truncate font-display text-2xl font-bold">
                  {[scanned.firstName, scanned.lastName].filter(Boolean).join(" ")}
                </p>
              ) : null}
              <p className={`text-lg font-bold ${problem ? "text-red-800" : "text-brand-900"}`} role={problem ? "alert" : "status"}>
                {problem ?? `Age ${age} · OK to serve`}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Born {birthDate} · ID expires {idExpires}
                {scanned?.state ? ` · ${scanned.state}` : ""}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                The name and dates are used for this check only and are not saved.
                {view.dailyLimits ? " The ID number is kept only as a scrambled code for today's purchase limits; the number itself isn't saved." : ""}
              </p>
              {view.dailyLimits && !scanned?.idNumber ? (
                <label className="mt-3 block">
                  <span className="text-sm font-semibold text-slate-700">ID number (this store counts limits per customer per day)</span>
                  <input
                    value={idNumber}
                    onChange={(e) => setIdNumber(e.target.value)}
                    autoComplete="off"
                    className="mt-1 block h-12 w-full rounded-xl border-2 border-slate-200 px-3 text-lg focus:border-brand-600 focus:outline-none"
                  />
                </label>
              ) : null}
            </div>
          </div>
          <div className="mt-5 grid grid-cols-[1fr_auto] gap-2">
            <button ref={startButton} type="button" disabled={Boolean(problem) || needsNumber || pending} onClick={begin} className={bigButton}>
              {pending ? "Starting…" : "Start sale"}
            </button>
            <button type="button" onClick={reset} className="h-16 rounded-2xl px-5 text-base font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-white">
              Clear
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-6 flex flex-1 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-brand-200 bg-brand-50/50 px-6 py-10 text-center">
          <IdCard className="h-16 w-16 text-brand-600" aria-hidden="true" />
          <p className="mt-3 font-display text-2xl font-bold">Scan the barcode on the back of the ID</p>
          <p className="mt-1 max-w-md text-slate-600">Any USB or Bluetooth 2D scanner works. The age and expiry are checked automatically.</p>
        </div>
      )}

      <div className="mt-4">
        {manual && !scanned ? (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
            }}
          >
            <label className="block">
              <span className="text-sm font-semibold text-slate-600">Date of birth on the ID</span>
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="mt-1 block h-12 w-full rounded-xl border-2 border-slate-200 px-3 text-lg focus:border-brand-600 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-slate-600">ID expiry date</span>
              <input
                type="date"
                value={idExpires}
                onChange={(e) => setIdExpires(e.target.value)}
                className="mt-1 block h-12 w-full rounded-xl border-2 border-slate-200 px-3 text-lg focus:border-brand-600 focus:outline-none"
              />
            </label>
          </form>
        ) : !scanned ? (
          <button type="button" onClick={() => setManual(true)} className="inline-flex items-center gap-2 text-base font-semibold text-brand-700 hover:underline">
            <CalendarDays className="h-5 w-5" aria-hidden="true" /> No scanner? Type the dates from the ID
          </button>
        ) : null}
      </div>
      <Toasts toasts={toasts} />
    </section>
  );
}

export function HomeScreen({ view }: { view: HomeView }) {
  if (!view.rulesSaved) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-lg rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
          <h1 className="font-display text-3xl font-bold">The register is locked</h1>
          <p className="mt-2 text-lg text-slate-600">This store&apos;s purchase limits and tax rates have not been entered yet.</p>
          {view.canManage ? (
            <Link href="/pos/menu" className={`${bigButton} mt-6`}>
              Set store rules
            </Link>
          ) : (
            <p className="mt-4 font-semibold">Ask a manager to set the store rules.</p>
          )}
        </div>
      </div>
    );
  }
  if (!view.drawerOpen) return <OpenDrawer />;

  return (
    <div className="grid h-full gap-5 overflow-y-auto p-5 lg:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
      <CheckIn view={view} />
      <div className="space-y-5">
        <section aria-label="Held carts" className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <PauseCircle className="h-5 w-5 text-brand-700" aria-hidden="true" /> Held carts ({view.heldCarts.length})
          </h2>
          {view.heldCarts.length === 0 ? (
            <p className="mt-2 text-slate-600">None. Hold a cart to serve someone else and come back to it.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {view.heldCarts.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/pos/sales/${c.id}`}
                    className="flex min-h-14 items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 ring-1 ring-slate-200 hover:ring-brand-600"
                  >
                    <span className="font-bold">{c.other ? `Take over ${c.number}` : `Resume ${c.number}`}</span>
                    <span className="text-right text-sm text-slate-600">
                      {c.items} item{c.items === 1 ? "" : "s"} · {c.other ? `on ${c.clerk}'s drawer` : c.clerk} · {c.since}
                      {c.other ? <span className="block text-xs">Moves to your drawer when you open it</span> : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="This shift" className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-lg font-bold">This shift</h2>
          {view.shift ? (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-sm text-slate-600">Sales</p>
                <p className="font-display text-3xl font-bold tabular-nums">{view.shift.sales}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-sm text-slate-600">Taken</p>
                <p className="font-display text-3xl font-bold tabular-nums">{money(Math.round(Number(view.shift.total) * 100))}</p>
              </div>
            </div>
          ) : null}
          {view.recent.length ? (
            <ul className="mt-3 divide-y divide-slate-100">
              {view.recent.map((s) => (
                <li key={s.id}>
                  <Link href={`/pos/sales/${s.id}/receipt`} className="flex min-h-12 items-center justify-between gap-3 hover:text-brand-700">
                    <span className="font-semibold">
                      {s.number}
                      {s.status !== "COMPLETED" ? <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">{s.status.toLowerCase()}</span> : null}
                    </span>
                    <span className="text-sm tabular-nums text-slate-600">
                      {s.total ? money(Math.round(Number(s.total) * 100)) : ""} · {s.time}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-slate-600">No sales yet this shift.</p>
          )}
        </section>
      </div>
    </div>
  );
}
