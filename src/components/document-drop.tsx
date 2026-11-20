"use client";

import { FileUp, Smartphone, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { readOrThrow, send } from "@/lib/scan/upload-client";

/**
 * The front door of an entry form: drop or choose the paper first, and the form stays out of the way until the
 * person says there is no paper. After a document is read, its review screen opens with the form already filled in.
 */
export function DocumentDrop({ packageId, phoneLinked, children }: { packageId?: string; phoneLinked: boolean; children: ReactNode }) {
  const router = useRouter();
  const [mode, setMode] = useState<"drop" | "reading" | "manual">("drop");
  const [over, setOver] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const take = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setName(file.name);
    setMode("reading");
    try {
      const id = await send(file, "desktop");
      await readOrThrow(id);
      router.push(`/inbox/${id}${packageId ? `?package=${packageId}` : ""}`);
    } catch (e) {
      setError((e as Error).message);
      setMode("drop");
    }
  };

  if (mode === "manual")
    return (
      <div>
        <p className="mb-3 rounded-lg bg-brand-50 p-2.5 text-sm text-brand-900">
          Have the paper?{" "}
          <button type="button" className="font-bold underline" onClick={() => setMode("drop")}>
            Drop it here instead
          </button>{" "}
          and the form fills itself in.
        </p>
        {children}
      </div>
    );

  return (
    <div
      data-no-global-drop
      data-testid="document-drop"
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        setOver(false);
        const file = e.dataTransfer.files?.[0];
        if (!file) return;
        e.preventDefault();
        void take(file);
      }}
      className={`rounded-2xl border-2 border-dashed p-6 text-center transition ${over ? "border-brand-600 bg-brand-50" : "border-brand-200 bg-white"}`}
    >
      {mode === "reading" ? (
        <div className="flex flex-col items-center gap-2 py-4" data-testid="drop-reading">
          <Sparkles className="h-8 w-8 animate-pulse text-brand-600" aria-hidden="true" />
          <p className="font-bold">Reading {name}…</p>
          <p className="text-sm text-slate-600">Next you check what Tally found. Nothing is saved until you confirm.</p>
        </div>
      ) : (
        <>
          <FileUp className="mx-auto h-10 w-10 text-brand-600" aria-hidden="true" />
          <p className="mt-2 text-lg font-extrabold">Drop the lab certificate here</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-600">A photo or PDF. Tally reads it and fills in the whole result. You can also paste a screenshot.</p>
          {error ? (
            <p role="alert" className="mx-auto mt-3 max-w-sm rounded-lg bg-red-50 p-2.5 text-sm font-semibold text-red-800">
              {error}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button type="button" onClick={() => picker.current?.click()} className="rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-800">
              Choose a file
            </button>
            {phoneLinked ? (
              <Link href="/capture" className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 px-4 py-2.5 text-sm font-bold text-brand-800 hover:bg-brand-50">
                <Smartphone className="h-4 w-4" aria-hidden="true" />
                Use my phone camera
              </Link>
            ) : (
              <Link href="/account" className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 px-4 py-2.5 text-sm font-bold text-brand-800 hover:bg-brand-50">
                <Smartphone className="h-4 w-4" aria-hidden="true" />
                Link my phone
              </Link>
            )}
          </div>
          <input ref={picker} type="file" accept="image/*,application/pdf" className="sr-only" aria-label="Choose a document" data-testid="drop-input" onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ""; }} />
          <div className="mx-auto mt-5 max-w-xs border-t border-slate-200 pt-3">
            <button type="button" onClick={() => setMode("manual")} className="text-sm text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline" data-testid="enter-manually">
              No document? Enter the details by hand
            </button>
          </div>
        </>
      )}
    </div>
  );
}
