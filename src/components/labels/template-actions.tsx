"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const btn = "inline-flex min-h-8 items-center rounded-lg px-2.5 text-xs font-bold transition disabled:opacity-50";

export function TemplateActions({ id, name, kind, isDefault, archived }: { id: string; name: string; kind: string; isDefault: boolean; archived: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(url: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return data;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <a href={`/labels/templates/${id}`} className={`${btn} bg-brand-600 text-white hover:bg-brand-700`}>
        Edit
      </a>
      {!isDefault && !archived ? (
        <button type="button" disabled={busy} className={`${btn} border border-brand-300 text-brand-800 hover:border-brand-600`} onClick={async () => (await call(`/api/labels/templates/${id}`, { action: "default" })) && router.refresh()}>
          Make default
        </button>
      ) : null}
      <button
        type="button"
        disabled={busy}
        className={`${btn} border border-slate-300 text-slate-700 hover:border-slate-500`}
        onClick={async () => {
          const data = await call("/api/labels/templates", { name: `${name} copy`.slice(0, 80), kind, copyOf: id });
          if (data?.id) router.push(`/labels/templates/${data.id}`);
        }}
      >
        Duplicate
      </button>
      <button type="button" disabled={busy} className={`${btn} text-slate-600 hover:text-slate-900`} onClick={async () => (await call(`/api/labels/templates/${id}`, { action: archived ? "restore" : "archive" })) && router.refresh()}>
        {archived ? "Restore" : "Archive"}
      </button>
      {error ? <span role="alert" className="text-xs font-semibold text-red-700">{error}</span> : null}
    </div>
  );
}
