"use client";

import { useState, type ReactNode } from "react";

/** A section that opens and closes, and stays as the person left it when the page refreshes. */
export function Disclosure({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="group rounded-xl bg-white shadow-sm ring-1 ring-slate-200"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-base font-bold text-slate-950">
        {title}
        <span className="text-sm font-semibold text-brand-700">{open ? "Hide" : "Show"}</span>
      </summary>
      {children}
    </details>
  );
}
