"use client";

import { IdCard, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Detector = { detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]> };

/**
 * Full-screen camera that reads the barcode on the back of a driver's license or state ID.
 * `onText` returns true when the text was an ID barcode; the camera is then closed by the caller.
 * Nothing is recorded or uploaded: the picture never leaves the phone and only the text is read.
 */
export function IdCamera({ onText, onClose }: { onText: (text: string) => boolean; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [miss, setMiss] = useState(false);
  const handler = useRef(onText);
  useEffect(() => {
    handler.current = onText;
  }, [onText]);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let stopZxing: (() => void) | null = null;
    let lastMiss = 0;
    const handle = (raw: string) => {
      if (stopped || !raw) return;
      if (handler.current(raw)) {
        if (navigator.vibrate) navigator.vibrate(60);
        return;
      }
      if (Date.now() - lastMiss > 1500) {
        lastMiss = Date.now();
        setMiss(true);
      }
    };
    (async () => {
      try {
        const video = videoRef.current;
        if (!video) return;
        // The barcode is dense, so ask for as sharp a picture as the phone will give.
        const constraints = { video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } };
        const Native = (window as unknown as { BarcodeDetector?: new (o?: { formats: string[] }) => Detector }).BarcodeDetector;
        if (Native) {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (stopped) return;
          video.srcObject = stream;
          await video.play();
          const detector = new Native({ formats: ["pdf417"] });
          while (!stopped) {
            const codes = await detector.detect(video).catch(() => []);
            for (const c of codes) handle(c.rawValue);
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        } else {
          const { BrowserPDF417Reader } = await import("@zxing/browser");
          const controls = await new BrowserPDF417Reader().decodeFromConstraints(constraints, video, (result) => {
            if (result) handle(result.getText());
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
    <div role="dialog" aria-label="Scan an ID" className="fixed inset-0 z-50 flex flex-col bg-black text-white" data-testid="id-camera">
      <div className="flex items-center gap-2 p-3">
        <IdCard className="h-5 w-5" aria-hidden="true" />
        <p className="flex-1 font-bold">Scan the back of the ID</p>
        <button type="button" onClick={onClose} aria-label="Close camera" className="rounded-full bg-white/15 p-2">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-x-4 top-1/3 h-36 rounded-2xl border-4 border-white/80" />
      </div>
      <div className="space-y-1 bg-white p-4 text-slate-900">
        {problem ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{problem}</p>
        ) : (
          <>
            <p className="font-semibold">Hold the wide barcode on the back of the card inside the box.</p>
            <p className="text-sm text-slate-600">Hold steady, with good light and no glare. It reads by itself. Nothing is recorded or saved.</p>
            {miss ? <p className="text-sm font-semibold text-amber-800">That isn&apos;t an ID barcode. Use the barcode on the back of a driver&apos;s license or state ID.</p> : null}
          </>
        )}
      </div>
    </div>
  );
}
