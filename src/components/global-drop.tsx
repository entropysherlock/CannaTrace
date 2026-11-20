"use client";

import { FileUp, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { readOrThrow, send } from "@/lib/scan/upload-client";

const readable = (f: File) => f.type.startsWith("image/") || f.type === "application/pdf" || /\.(pdf|png|jpe?g|heic|webp)$/i.test(f.name);
const isSheet = (f: File) => /\.(csv|xlsx|xls|tsv)$/i.test(f.name) || f.type === "text/csv";
const skip = (t: EventTarget | null) => t instanceof Element && Boolean(t.closest("[data-no-global-drop]"));

/** Drop a photo or PDF anywhere, or paste a screenshot, and Tally reads it and opens the review screen. */
export function GlobalDrop() {
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const [job, setJob] = useState<{ name: string; error?: string; sheet?: boolean } | null>(null);
  const depth = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const run = async (file: File) => {
      if (busy.current) return;
      if (isSheet(file)) return setJob({ name: file.name, sheet: true, error: "That's a spreadsheet. This drop area reads photos and PDFs." });
      if (!readable(file)) return setJob({ name: file.name, error: "Tally can read photos and PDFs. This file isn't one." });
      busy.current = true;
      setJob({ name: file.name });
      try {
        const id = await send(file, "desktop");
        await readOrThrow(id);
        setJob(null);
        router.push(`/inbox/${id}`);
      } catch (e) {
        setJob({ name: file.name, error: (e as Error).message });
      } finally {
        busy.current = false;
      }
    };
    const enter = (e: DragEvent) => {
      if (!hasFiles(e) || skip(e.target)) return;
      depth.current += 1;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e) || skip(e.target)) return;
      e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      depth.current = 0;
      setDragging(false);
      if (!hasFiles(e) || skip(e.target)) return;
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file) void run(file);
    };
    const paste = (e: ClipboardEvent) => {
      if (skip(e.target)) return;
      const file = Array.from(e.clipboardData?.files ?? []).find(readable);
      if (!file) return;
      e.preventDefault();
      void run(file);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      window.removeEventListener("paste", paste);
    };
  }, [router]);

  if (!dragging && !job) return null;
  return (
    <div className="print:hidden" data-testid="global-drop">
      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-brand-900/70 p-6">
          <div className="rounded-3xl border-4 border-dashed border-white bg-brand-800 px-10 py-12 text-center text-white shadow-2xl">
            <FileUp className="mx-auto h-14 w-14" aria-hidden="true" />
            <p className="mt-3 text-2xl font-extrabold">Drop to fill it in</p>
            <p className="mt-1 text-brand-100">Tally works out what it is and opens it for you</p>
          </div>
        </div>
      ) : null}
      {job ? (
        <div role="status" className="fixed bottom-24 left-1/2 z-[60] flex w-[min(92vw,26rem)] -translate-x-1/2 items-center gap-3 rounded-2xl bg-slate-900 p-4 text-white shadow-2xl sm:bottom-6">
          {job.error ? (
            <>
              <div className="flex-1 text-sm">
                <p role="alert" className="font-semibold">{job.error}</p>
                {job.sheet ? (
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-semibold" data-testid="drop-sheet-help">
                    <Link href="/data" onClick={() => setJob(null)} className="underline">Open Import and export</Link>
                    <button type="button" className="underline" onClick={() => { setJob(null); window.dispatchEvent(new Event("open-assistant")); }}>
                      Ask Tally in chat (attach it there)
                    </button>
                  </p>
                ) : null}
              </div>
              <button type="button" aria-label="Dismiss" onClick={() => setJob(null)} className="rounded-full bg-white/15 p-1.5">
                <X className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <Sparkles className="h-6 w-6 shrink-0 animate-pulse" aria-hidden="true" />
              <p className="flex-1 truncate text-sm font-semibold">Reading {job.name}…</p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
