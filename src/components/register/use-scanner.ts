"use client";

import { useEffect, useRef } from "react";
import { ID_IDLE_FLUSH_MS, ScanBuffer } from "@/lib/scan-buffer";

const isTypingField = (el: Element | null) =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement | null)?.isContentEditable;

/**
 * Listens for a USB or Bluetooth barcode scanner in keyboard mode. Scanners "type" a whole code in a
 * few milliseconds and usually end with Enter, which a person cannot do. Keys typed into a text box are
 * left alone (that box handles its own Enter), except a driver's license barcode, which spans many lines.
 * Calls onScan with the full text, Enter keys turned into line breaks. The key logic is in lib/scan-buffer.
 */
export function useScanner(onScan: (text: string) => void, options: { enabled?: boolean; minLength?: number } = {}) {
  const { enabled = true, minLength = 4 } = options;
  const buffer = useRef<ScanBuffer | null>(null);
  const idTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handler = useRef(onScan);
  useEffect(() => {
    handler.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;
    const scan = new ScanBuffer(minLength);
    buffer.current = scan;
    const flush = () => {
      const text = scan.take();
      if (text) handler.current(text);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const result = scan.key({ key: e.key, typing: !!isTypingField(document.activeElement), now: performance.now() });
      if (result.prevent) e.preventDefault();
      if (result.flush) handler.current(result.flush);
      if (idTimer.current) clearTimeout(idTimer.current);
      // A license barcode is done when the keys stop coming.
      if (result.armIdTimer) idTimer.current = setTimeout(flush, ID_IDLE_FLUSH_MS);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (idTimer.current) clearTimeout(idTimer.current);
    };
  }, [enabled, minLength]);
}
