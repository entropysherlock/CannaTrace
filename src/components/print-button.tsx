"use client";

export function PrintButton({ label = "Print label" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-11 items-center rounded-md bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800 print:hidden"
    >
      {label}
    </button>
  );
}
