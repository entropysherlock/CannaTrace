"use client";

import { Camera, CheckCircle2, ImageUp, Inbox, RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { LeafMark } from "@/components/logo";

type Shot = { key: string; name: string; state: "sending" | "done" | "failed"; error?: string; file: File };

const MAX_SIDE = 2400;

/** Shrinks a phone photo before it travels: a 6 MB photo becomes a few hundred KB and the text stays readable. */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 400_000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "The upload didn't go through.");
  return data as T;
}

async function send(original: File): Promise<void> {
  const file = await shrink(original);
  const name = file.name && file.name !== "image.jpg" ? file.name : `photo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.jpg`;
  const { id, chunkBytes } = await jsonOrThrow<{ id: string; chunkBytes: number }>(
    await fetch("/api/assistant/attachments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, size: file.size, source: "phone" }) }),
  );
  for (let offset = 0; offset < file.size; offset += chunkBytes) {
    await jsonOrThrow(await fetch(`/api/assistant/attachments/${id}?offset=${offset}`, { method: "PUT", body: file.slice(offset, Math.min(offset + chunkBytes, file.size)) }));
  }
  await jsonOrThrow(await fetch(`/api/assistant/attachments/${id}`, { method: "POST" }));
}

export function CaptureScreen({ person, store, justLinked }: { person: string; store: string; justLinked: boolean }) {
  const [shots, setShots] = useState<Shot[]>([]);
  const shotsRef = useRef<Shot[]>([]);
  useEffect(() => {
    shotsRef.current = shots;
  }, [shots]);
  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);

  const run = useCallback(async (shot: Shot) => {
    setShots((all) => all.map((s) => (s.key === shot.key ? { ...s, state: "sending", error: undefined } : s)));
    try {
      await send(shot.file);
      setShots((all) => all.map((s) => (s.key === shot.key ? { ...s, state: "done" } : s)));
    } catch (e) {
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      setShots((all) => all.map((s) => (s.key === shot.key ? { ...s, state: "failed", error: offline || e instanceof TypeError ? "No signal. It will send when you're back online." : (e as Error).message } : s)));
    }
  }, []);

  const add = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    const next = picked.map((file) => ({ key: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: file.name, state: "sending" as const, file }));
    setShots((all) => [...next, ...all]);
    next.forEach((shot) => void run(shot));
  };

  // A photo that couldn't send for lack of signal goes by itself when the phone is back online.
  useEffect(() => {
    const retry = () => shotsRef.current.filter((s) => s.state === "failed" && s.error?.startsWith("No signal")).forEach((s) => void run(s));
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [run]);

  const sent = shots.filter((s) => s.state === "done").length;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 bg-[#eef3ef] px-4 pb-8 pt-5">
      <header className="flex items-center gap-2">
        <LeafMark className="h-8 w-8 text-brand-700" />
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-bold leading-tight">{person}</p>
          <p className="truncate text-xs text-slate-600">{store}</p>
        </div>
        <Link href="/dashboard" className="ml-auto rounded-lg px-3 py-2 text-sm font-semibold text-brand-800 hover:bg-white">
          Open CannaTrace
        </Link>
      </header>

      {justLinked ? (
        <p role="status" data-testid="linked-note" className="rounded-xl bg-brand-100 p-3 text-sm font-semibold text-brand-900">
          This phone is linked. Add this page to your home screen (Share, then &quot;Add to Home Screen&quot;) and it will open straight to the camera.
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => camera.current?.click()}
        className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-3xl bg-brand-700 text-white shadow-lg active:bg-brand-800"
        data-testid="take-photo"
      >
        <Camera className="h-14 w-14" aria-hidden="true" />
        <span className="text-2xl font-extrabold">Take a photo</span>
        <span className="px-6 text-center text-sm text-brand-100">Lab certificate, manifest, harvest sheet, package, anything</span>
      </button>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Take a photo" data-testid="camera-input" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />

      <button type="button" onClick={() => files.current?.click()} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-brand-200 bg-white text-base font-bold text-brand-800">
        <ImageUp className="h-5 w-5" aria-hidden="true" />
        Choose photos or a PDF
      </button>
      <input ref={files} type="file" accept="image/*,application/pdf" multiple className="sr-only" aria-label="Choose photos or a PDF" data-testid="file-input" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />

      {shots.length > 0 ? (
        <ul className="space-y-2" data-testid="shots">
          {shots.map((s) => (
            <li key={s.key} className="flex items-center gap-3 rounded-xl bg-white p-3 text-sm shadow-sm">
              {s.state === "done" ? <CheckCircle2 className="h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" /> : s.state === "failed" ? <TriangleAlert className="h-5 w-5 shrink-0 text-red-600" aria-hidden="true" /> : <RefreshCw className="h-5 w-5 shrink-0 animate-spin text-slate-500" aria-hidden="true" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{s.name}</span>
                <span className="block text-xs text-slate-600">{s.state === "done" ? "Sent. It is in your inbox on the computer." : s.state === "failed" ? s.error : "Sending…"}</span>
              </span>
              {s.state === "failed" ? (
                <button type="button" className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold" onClick={() => void run(s)}>
                  Try again
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="flex items-center gap-2 text-sm text-slate-600">
        <Inbox className="h-4 w-4" aria-hidden="true" />
        {sent > 0 ? `${sent} sent. ` : ""}
        <Link href="/inbox" className="font-semibold text-brand-800 underline">
          See your phone inbox
        </Link>
      </p>
    </main>
  );
}
