"use client";

import { useEffect, useRef, useState } from "react";
import { inputClass } from "./ui";

type Detector = { detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]> };

/**
 * A text field with a camera button. Hardware scanners type straight into the field;
 * the button opens the phone camera and fills the field with the first barcode it reads.
 */
export function ScanInput({
  name,
  defaultValue,
  placeholder,
  required,
  autoFocus,
  submitOnScan,
}: {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
  submitOnScan?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let stopZxing: (() => void) | null = null;

    const finish = (value: string) => {
      if (stopped) return;
      stopped = true;
      const input = inputRef.current;
      if (input) {
        input.value = value.trim().toUpperCase();
        if (submitOnScan) input.form?.requestSubmit();
      }
      setOpen(false);
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
            if (codes[0]?.rawValue) return finish(codes[0].rawValue);
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        } else {
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          const controls = await new BrowserMultiFormatReader().decodeFromConstraints(
            { video: { facingMode: "environment" } },
            video,
            (result) => {
              if (result) finish(result.getText());
            },
          );
          stopZxing = () => controls.stop();
          if (stopped) controls.stop();
        }
      } catch {
        setProblem("The camera could not be opened. Allow camera access for this site, or type the tag instead.");
      }
    })();

    return () => {
      stopped = true;
      stream?.getTracks().forEach((track) => track.stop());
      stopZxing?.();
    };
  }, [open, submitOnScan]);

  return (
    <div>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
          required={required}
          autoFocus={autoFocus}
          autoCapitalize="characters"
          autoComplete="off"
          className={`${inputClass} font-mono`}
        />
        <button
          type="button"
          onClick={() => {
            setProblem(null);
            setOpen((value) => !value);
          }}
          className="min-h-11 shrink-0 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold hover:bg-slate-50"
        >
          {open ? "Close camera" : "Scan"}
        </button>
      </div>
      {open ? (
        <video ref={videoRef} muted playsInline className="mt-2 aspect-video w-full max-w-md rounded-md bg-black object-cover" />
      ) : null}
      {problem ? <p className="mt-1 text-sm text-red-700">{problem}</p> : null}
    </div>
  );
}
