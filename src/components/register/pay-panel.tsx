"use client";

import { Banknote, CreditCard, Delete, Split, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { terminalPay } from "@/app/(app)/pos/terminal-actions";
import { beep } from "./feedback";

type Method = "CASH" | "DEBIT" | "SPLIT";

const cents = (text: string) => {
  const t = text.trim();
  if (!/^\d*(\.\d{0,2})?$/.test(t) || t === "" || t === ".") return null;
  return Math.round(Number(t) * 100);
};
export const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const METHODS: { id: Method; label: string; icon: typeof Banknote }[] = [
  { id: "CASH", label: "Cash", icon: Banknote },
  { id: "DEBIT", label: "Debit", icon: CreditCard },
  { id: "SPLIT", label: "Split", icon: Split },
];

/** Take payment: cash with a keypad and quick bills, debit, or part of each. */
export function PayPanel({
  saleId,
  total,
  quickCash,
  onClose,
  onError,
}: {
  saleId: string;
  total: string;
  quickCash: string[];
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<Method>("CASH");
  const [cash, setCash] = useState("");
  const [debit, setDebit] = useState("");
  const [field, setField] = useState<"cash" | "debit">("cash");
  const [last4, setLast4] = useState("");
  const [approval, setApproval] = useState("");
  const [pending, start] = useTransition();
  const cashRef = useRef<HTMLInputElement>(null);
  const debitRef = useRef<HTMLInputElement>(null);
  const due = Math.round(Number(total) * 100);

  useEffect(() => {
    (method === "SPLIT" ? debitRef : cashRef).current?.focus();
  }, [method]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const debitC = method === "SPLIT" ? (cents(debit) ?? 0) : method === "DEBIT" ? due : 0;
  const cashDue = Math.max(0, due - debitC);
  const cashC = cents(cash);
  const change = method === "DEBIT" || cashC === null ? null : cashC - cashDue;
  const ready =
    !pending &&
    (method === "DEBIT" ||
      (method === "CASH" && (due === 0 || (cashC !== null && cashC >= due))) ||
      (method === "SPLIT" && debitC > 0 && debitC < due && cashC !== null && cashC >= cashDue));

  const value = field === "cash" ? cash : debit;
  const set = field === "cash" ? setCash : setDebit;
  const press = (key: string) => {
    if (key === "back") return set(value.slice(0, -1));
    if (key === "clear") return set("");
    const next = value + key;
    if (/^\d{0,6}(\.\d{0,2})?$/.test(next)) set(next);
  };

  const complete = () => {
    if (!ready) return;
    start(async () => {
      const result = await terminalPay({ saleId, method, cashTendered: method === "DEBIT" ? "" : cash, debitAmount: method === "SPLIT" ? debit : "", cardLast4: method === "CASH" ? "" : last4, cardRef: method === "CASH" ? "" : approval });
      if (result.error) {
        beep("error");
        onError(result.error);
        return;
      }
      beep("ok");
      router.push(`/pos/sales/${saleId}/receipt`);
    });
  };

  const amountInput = (which: "cash" | "debit", label: string) => (
    <label className="block">
      <span className="text-sm font-semibold text-slate-600">{label}</span>
      <span
        className={`mt-1 flex items-center rounded-xl border-2 bg-white px-4 ${field === which ? "border-brand-600 ring-4 ring-brand-100" : "border-slate-200"}`}
      >
        <span className="font-display text-3xl font-bold text-slate-400">$</span>
        <input
          ref={which === "cash" ? cashRef : debitRef}
          value={which === "cash" ? cash : debit}
          onChange={(e) => {
            const v = e.target.value.replace(/[^\d.]/g, "");
            if (/^\d{0,6}(\.\d{0,2})?$/.test(v)) (which === "cash" ? setCash : setDebit)(v);
          }}
          onFocus={() => setField(which)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              complete();
            }
          }}
          inputMode="decimal"
          autoComplete="off"
          aria-label={label}
          placeholder="0.00"
          className="h-16 w-full min-w-0 bg-transparent px-2 font-display text-4xl font-bold tabular-nums text-slate-950 outline-none placeholder:text-slate-300"
        />
      </span>
    </label>
  );

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-brand-950/60 p-0 sm:items-center sm:p-6"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Take payment" className="flex max-h-full w-full max-w-3xl flex-col overflow-auto rounded-t-3xl bg-[#f6f9f7] shadow-2xl sm:rounded-3xl">
        <div className="flex items-start justify-between gap-4 bg-brand-950 px-6 py-5 text-white sm:rounded-t-3xl">
          <div>
            <p className="text-sm font-semibold text-brand-200">Amount due</p>
            <p className="font-display text-5xl font-bold tabular-nums tracking-tight">{money(due)}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-brand-100 hover:bg-white/10" aria-label="Back to cart">
            <X className="h-7 w-7" aria-hidden="true" />
          </button>
        </div>

        <div className="grid gap-6 p-6 md:grid-cols-[1fr_auto]">
          <div className="space-y-5">
            <div role="radiogroup" aria-label="Payment method" className="grid grid-cols-3 gap-2">
              {METHODS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={method === id}
                  onClick={() => {
                    setMethod(id);
                    setField(id === "SPLIT" ? "debit" : "cash");
                  }}
                  className={`flex h-14 items-center justify-center gap-2 rounded-xl border-2 text-lg font-bold transition-colors ${
                    method === id ? "border-brand-700 bg-brand-700 text-white" : "border-slate-200 bg-white text-slate-800 hover:border-brand-500"
                  }`}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" /> {label}
                </button>
              ))}
            </div>

            {method === "DEBIT" ? (
              <div className="rounded-2xl border-2 border-dashed border-brand-200 bg-white p-5 text-lg text-slate-700">
                Run <strong className="text-slate-950">{money(due)}</strong> on your card terminal. When it is approved, press Complete sale.
              </div>
            ) : null}
            {method === "SPLIT" ? amountInput("debit", "On the debit card") : null}
            {method !== "CASH" ? (
              <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200" data-testid="card-details">
                <p className="text-sm text-slate-600">
                  Leaf2Sale records the card payment; it does not charge the card. Optional: add what the terminal shows, so this sale matches its batch report.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="block text-sm font-semibold text-slate-700">
                    Last 4 digits
                    <input
                      value={last4}
                      onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={4}
                      placeholder="1234"
                      className="mt-1 block h-12 w-full rounded-lg border border-slate-300 px-3 text-lg font-normal tabular-nums"
                    />
                  </label>
                  <label className="block text-sm font-semibold text-slate-700">
                    Approval number
                    <input
                      value={approval}
                      onChange={(e) => setApproval(e.target.value.replace(/[^A-Za-z0-9 -]/g, "").slice(0, 24))}
                      autoComplete="off"
                      maxLength={24}
                      className="mt-1 block h-12 w-full rounded-lg border border-slate-300 px-3 text-lg font-normal"
                    />
                  </label>
                </div>
              </div>
            ) : null}
            {method !== "DEBIT" ? (
              <>
                {amountInput("cash", method === "SPLIT" ? `Cash received (${money(cashDue)} due in cash)` : "Cash received")}
                {method === "CASH" && quickCash.length ? (
                  <div className="flex flex-wrap gap-2" aria-label="Quick cash amounts">
                    {quickCash.map((amount, i) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => {
                          setCash(amount);
                          setField("cash");
                        }}
                        className="h-12 min-w-24 rounded-xl border-2 border-slate-200 bg-white px-4 text-lg font-bold tabular-nums text-slate-900 hover:border-brand-600"
                      >
                        {i === 0 ? `Exact ${money(Math.round(Number(amount) * 100))}` : `$${Number(amount)}`}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}

            <div
              className={`flex items-center justify-between rounded-2xl px-5 py-4 ${
                change !== null && change >= 0 ? "bg-amber-100 text-amber-950" : "bg-slate-100 text-slate-500"
              }`}
            >
              <span className="text-lg font-bold">{method === "DEBIT" ? "No change on debit" : "Change due"}</span>
              <span className="font-display text-4xl font-bold tabular-nums" data-testid="change-due">
                {method === "DEBIT" ? "" : change !== null && change >= 0 ? money(change) : "—"}
              </span>
            </div>
          </div>

          {method !== "DEBIT" ? (
            <div className="grid w-full grid-cols-3 gap-2 self-start md:w-64" aria-label="Number pad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => press(k)}
                  aria-label={k === "back" ? "Delete last digit" : k === "." ? "Decimal point" : k}
                  className="flex h-16 items-center justify-center rounded-xl bg-white text-2xl font-bold text-slate-900 shadow-sm ring-1 ring-slate-200 active:bg-brand-100"
                >
                  {k === "back" ? <Delete className="h-6 w-6" aria-hidden="true" /> : k}
                </button>
              ))}
              <button type="button" onClick={() => press("clear")} className="col-span-3 h-12 rounded-xl text-base font-semibold text-slate-600 hover:bg-slate-200">
                Clear
              </button>
            </div>
          ) : null}
        </div>

        <div className="sticky bottom-0 border-t border-slate-200 bg-[#f6f9f7] p-4">
          <button
            type="button"
            onClick={complete}
            disabled={!ready}
            className="flex h-16 w-full items-center justify-center rounded-2xl bg-brand-700 text-xl font-bold text-white shadow-sm hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
          >
            {pending ? "Completing…" : `Complete sale · ${money(due)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
