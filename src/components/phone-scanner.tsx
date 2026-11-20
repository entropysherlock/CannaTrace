"use client";

import { ScanLine, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Detector = { detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]> };
type Found = { kind: string; id: string; title: string; detail: string; href: string };
type Seen = { code: string; found: Found | null };

/** Full-screen camera that keeps reading barcodes and QR codes and says what each one is. */
export function PhoneScanner({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [seen, setSeen] = useState<Seen[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let stopZxing: (() => void) | null = null;
    const done = new Set<string>();
    const handle = async (raw: string) => {
      const code = raw.trim();
      if (!code || done.has(code)) return;
      done.add(code);
      if (navigator.vibrate) navigator.vibrate(60);
      const res = await fetch(`/api/scan/lookup?code=${encodeURIComponent(code)}`).catch(() => null);
      const data = res?.ok ? ((await res.json().catch(() => ({}))) as { found?: Found | null }) : {};
      setSeen((all) => [{ code, found: data.found ?? null }, ...all]);
    };
    (async () => {
      try {
        const video = videoRef.current;
        if (!video) return;
        const Native = (window as unknown as { BarcodeDetector?: new () => Detector }).BarcodeDetector;
        if (Native) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
          if (stopped) return;
          video.srcObject = stream;
          await video.play();
          const detector = new Native();
          while (!stopped) {
            const codes = await detector.detect(video).catch(() => []);
            for (const c of codes) void handle(c.rawValue);
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        } else {
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          const controls = await new BrowserMultiFormatReader().decodeFromConstraints({ video: { facingMode: "environment" } }, video, (result) => {
            if (result) void handle(result.getText());
          });
          stopZxing = () => controls.stop();
          if (stopped) controls.stop();
        }
      } catch {
        setProblem("The camera could not be opened. Allow camera access for this site and try again.");
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
      stopZxing?.();
    };
  }, []);

  return (
    <div role="dialog" aria-label="Scan a barcode" className="fixed inset-0 z-50 flex flex-col bg-black text-white" data-testid="phone-scanner">
      <div className="flex items-center gap-2 p-3">
        <ScanLine className="h-5 w-5" aria-hidden="true" />
        <p className="flex-1 font-bold">Scan a barcode or QR code</p>
        <button type="button" onClick={onClose} aria-label="Close scanner" className="rounded-full bg-white/15 p-2">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-x-8 top-1/3 h-32 rounded-2xl border-4 border-white/80" />
      </div>
      <div className="max-h-[40%] space-y-2 overflow-y-auto bg-white p-3 text-slate-900">
        {problem ? <p className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{problem}</p> : null}
        {!problem && seen.length === 0 ? <p className="text-sm text-slate-600">Point the camera at a package tag or product barcode. It keeps scanning, so you can do several in a row.</p> : null}
        {seen.map((s) =>
          s.found ? (
            <Link key={s.code} href={s.found.href} className="block rounded-xl border border-brand-200 bg-brand-50 p-3">
              <span className="block font-bold">{s.found.title}</span>
              <span className="block text-sm text-slate-700">{s.found.detail}</span>
              <span className="text-sm font-bold text-brand-800 underline">Open</span>
            </Link>
          ) : (
            <p key={s.code} className="rounded-xl bg-slate-100 p-3 text-sm">
              <span className="font-bold">{s.code}</span> isn&apos;t a package or product here.
            </p>
          ),
        )}
      </div>
    </div>
  );
}
