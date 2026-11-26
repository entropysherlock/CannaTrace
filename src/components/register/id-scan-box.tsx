"use client";

import { useEffect, useRef } from "react";

/**
 * A box for a USB or Bluetooth scanner to type into. Some scanners only deliver their characters to a focused
 * text field and never as key presses the page can hear, so the page-wide listener misses them. This box keeps
 * focus, collects whatever arrives (a license barcode is many lines), and hands it over once the typing pauses.
 */
export function IdScanBox({ onText, idleMs = 200 }: { onText: (text: string) => void; idleMs?: number }) {
  const box = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handler = useRef(onText);
  useEffect(() => {
    handler.current = onText;
  }, [onText]);
  useEffect(() => {
    box.current?.focus();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const arm = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = box.current;
      if (!el) return;
      const text = el.value;
      el.value = "";
      if (text.replace(/\s/g, "").length >= 4) handler.current(text);
    }, idleMs);
  };

  return (
    <textarea
      ref={box}
      rows={1}
      aria-label="Scan ID here"
      data-testid="scan-id-box"
      placeholder="Click here, then scan the ID"
      autoComplete="off"
      spellCheck={false}
      onInput={arm}
      onPaste={() => arm()}
      className="mt-4 block h-12 w-full max-w-md resize-none rounded-xl border-2 border-brand-300 bg-white px-3 py-2.5 text-center text-base text-slate-500 placeholder:text-slate-400 focus:border-brand-600 focus:outline-none"
    />
  );
}
