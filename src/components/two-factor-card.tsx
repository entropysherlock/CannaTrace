"use client";

import { useState, useTransition } from "react";
import { beginTwoFactorAction, confirmTwoFactorAction, newRecoveryCodesAction, turnOffTwoFactorAction } from "@/app/(app)/account/actions";
import { inputClass } from "@/components/ui";

type Props = { enabled: boolean; since: string | null; recoveryLeft: number; ready: boolean };
type Mode = "idle" | "setup" | "codes" | "off" | "renew";

const button = "min-h-11 rounded-lg px-4 text-sm font-bold disabled:opacity-60";
const primary = `${button} bg-brand-700 text-white hover:bg-brand-800`;
const quiet = `${button} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`;

/** Turn two-step sign-in on or off, and manage recovery codes. Codes are shown once, here, and never again. */
export function TwoFactorCard({ enabled, since, recoveryLeft, ready }: Props) {
  const [mode, setMode] = useState<Mode>("idle");
  const [setup, setSetup] = useState<{ svg: string; key: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [pending, start] = useTransition();

  const reset = () => {
    setMode("idle");
    setSetup(null);
    setError(null);
    setCode("");
    setPassword("");
  };

  if (codes) {
    return (
      <div className="space-y-3" data-testid="recovery-codes">
        <p className="rounded-lg border-l-4 border-brand-600 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-900">
          Two-step sign-in is on. Save these recovery codes now. Each one works once if you lose your phone, and they will not be shown again.
        </p>
        <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
          {codes.map((c) => (
            <li key={c} className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
              {c}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={quiet} onClick={() => navigator.clipboard?.writeText(codes.join("\n"))}>
            Copy codes
          </button>
          <button
            type="button"
            className={primary}
            data-testid="codes-saved"
            onClick={() => {
              setCodes(null);
              reset();
              window.location.reload();
            }}
          >
            I&apos;ve saved them
          </button>
        </div>
      </div>
    );
  }

  if (!enabled && mode === "idle") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Add a second step to sign-in: after your password, you type a 6-digit code from an authenticator app on your phone (Google Authenticator, Authy,
          1Password, Microsoft Authenticator). A stolen or guessed password alone then gets nobody in.
        </p>
        {!ready ? <p className="text-sm font-semibold text-amber-800">This server isn&apos;t set up for two-step sign-in yet. Ask Leaf2Sale support.</p> : null}
        {error ? <p role="alert" className="text-sm font-semibold text-red-700">{error}</p> : null}
        <button
          type="button"
          disabled={pending || !ready}
          data-testid="two-factor-start"
          className={primary}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await beginTwoFactorAction();
              if (r.error || !r.svg || !r.key) return setError(r.error ?? "Could not start setup.");
              setSetup({ svg: r.svg, key: r.key });
              setMode("setup");
            })
          }
        >
          Set up two-step sign-in
        </button>
      </div>
    );
  }

  if (!enabled && mode === "setup" && setup) {
    return (
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError(null);
            const r = await confirmTwoFactorAction(code);
            if (r.error || !r.recoveryCodes) return setError(r.error ?? "Could not turn it on.");
            setCodes(r.recoveryCodes);
          });
        }}
      >
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>Open your authenticator app and add an account by scanning this code.</li>
          <li>Type the 6-digit code the app shows, then press Turn on.</li>
        </ol>
        <div className="flex flex-wrap items-center gap-4">
          <div className="h-48 w-48 rounded-lg border border-slate-200 bg-white p-1" data-testid="two-factor-qr" dangerouslySetInnerHTML={{ __html: setup.svg }} />
          <p className="max-w-xs text-xs text-slate-600">
            Can&apos;t scan? Enter this key in the app by hand:
            <span className="mt-1 block break-all font-mono text-sm font-semibold text-slate-900" data-testid="two-factor-key">
              {setup.key}
            </span>
          </p>
        </div>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="6-digit code"
          aria-label="6-digit code"
          data-testid="two-factor-code"
          className={inputClass}
        />
        {error ? <p role="alert" className="text-sm font-semibold text-red-700">{error}</p> : null}
        <div className="flex gap-2">
          <button type="submit" disabled={pending || code.trim().length < 6} className={primary} data-testid="two-factor-confirm">
            Turn on
          </button>
          <button type="button" className={quiet} onClick={reset}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  // Already on.
  const proof = (
    <>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" aria-label="Your password" autoComplete="current-password" className={inputClass} />
      <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code from your app (or a recovery code)" aria-label="Code from your app" autoComplete="one-time-code" className={inputClass} />
    </>
  );
  return (
    <div className="space-y-3" data-testid="two-factor-on">
      <p className="text-sm text-slate-700">
        <span className="font-semibold text-brand-800">On</span>
        {since ? ` since ${new Date(since).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}. {recoveryLeft} recovery{" "}
        {recoveryLeft === 1 ? "code" : "codes"} left.
        {recoveryLeft <= 2 ? " Make new ones soon." : ""}
      </p>
      {mode === "idle" ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={quiet} onClick={() => setMode("renew")}>
            New recovery codes
          </button>
          <button type="button" className={quiet} onClick={() => setMode("off")} data-testid="two-factor-off">
            Turn off
          </button>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              if (mode === "off") {
                const r = await turnOffTwoFactorAction(password, code);
                if (r.error) return setError(r.error);
                window.location.reload();
              } else {
                const r = await newRecoveryCodesAction(password, code);
                if (r.error || !r.recoveryCodes) return setError(r.error ?? "Could not make new codes.");
                setCodes(r.recoveryCodes);
              }
            });
          }}
        >
          <p className="text-sm text-slate-600">{mode === "off" ? "Turning it off needs your password and a code." : "Making new codes replaces the old ones. It needs your password and a code."}</p>
          {proof}
          {error ? <p role="alert" className="text-sm font-semibold text-red-700">{error}</p> : null}
          <div className="flex gap-2">
            <button type="submit" disabled={pending || !password || !code} className={primary}>
              {mode === "off" ? "Turn off" : "Make new codes"}
            </button>
            <button type="button" className={quiet} onClick={reset}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
