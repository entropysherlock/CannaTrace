import { Info } from "lucide-react";
import type { ReactNode } from "react";

/** Field styling without a width, for boxes that sit side by side. */
export const inputBase =
  "min-h-11 min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

/** Full-width field styling. */
export const inputClass = `block w-full ${inputBase}`;

/** A small "i" that shows help text on hover or tap, so screens are not walls of text. */
export function Tip({ text, label = "More info" }: { text: ReactNode; label?: string }) {
  return (
    <span className="group/tip relative inline-flex align-middle">
      <span
        tabIndex={0}
        role="img"
        aria-label={label}
        className="inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full text-brand-600 hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
      >
        <Info className="h-4 w-4" aria-hidden="true" />
      </span>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute left-1/2 top-full z-30 mt-2 w-[min(18rem,calc(100vw-2rem))] max-sm:hidden max-sm:group-hover/tip:block max-sm:group-focus-within/tip:block -translate-x-1/2 rounded-lg bg-brand-950 px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-white opacity-0 shadow-lg transition group-focus-within/tip:visible group-focus-within/tip:opacity-100 group-hover/tip:visible group-hover/tip:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-sm font-semibold text-slate-800">
        {label}
        {hint ? <Tip text={hint} label={`About ${label}`} /> : null}
      </span>
      {children}
    </label>
  );
}

/** A white card. With a title it gets a green header band, like a store system's panels. */
export function Card({ title, children, action, className }: { title?: ReactNode; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-brand-100 bg-white shadow-sm ${className ?? ""}`}>
      {title ? (
        <div className="flex items-center justify-between gap-3 rounded-t-xl border-b border-brand-100 bg-brand-50 px-4 py-3 sm:px-5">
          <h2 className="text-base font-bold text-brand-900">{title}</h2>
          {action}
        </div>
      ) : null}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

/**
 * A fixed-height box that scrolls on its own, so a long list (100 plants, months of audit entries)
 * doesn't stretch the page. Short lists look the same as before: the box only scrolls once it's full.
 * size "md" fits beside a form in a card; "lg" is for a page's main list.
 */
export function ScrollBox({ label, children, size = "md", className }: { label: string; children: ReactNode; size?: "md" | "lg"; className?: string }) {
  return (
    <div
      role="region"
      aria-label={label}
      // Focusable so keyboard users can scroll it with the arrow keys.
      tabIndex={0}
      data-testid="scroll-box"
      className={`${size === "lg" ? "max-h-[60vh]" : "max-h-96"} overflow-y-auto overscroll-contain focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

/** Long explanations move into an info tip next to the title; short ones (like counts) stay visible. */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  const long = subtitle && subtitle.length > 60;
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-brand-950 sm:text-3xl">
          {title}
          {long ? <Tip text={subtitle} label={`About ${title}`} /> : null}
        </h1>
        {subtitle && !long ? <p className="mt-1 text-sm font-medium text-brand-700">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-brand-600 text-white",
  ALLOCATED: "bg-sky-600 text-white",
  ON_HOLD: "bg-amber-500 text-amber-950",
  QUARANTINE: "bg-red-600 text-white",
  FINISHED: "bg-slate-400 text-white",
  DESTROYED: "bg-slate-800 text-white",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${STATUS_STYLES[status] ?? "bg-slate-200 text-slate-800"}`}
    >
      {status.replace("_", " ").toLowerCase()}
    </span>
  );
}

export const buttonLinkClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-brand-700";
