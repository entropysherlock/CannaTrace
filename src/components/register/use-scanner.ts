"use client";

import { useEffect, useRef } from "react";

const isTypingField = (el: Element | null) =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement | null)?.isContentEditable;

/**
 * Listens for a USB or Bluetooth barcode scanner in keyboard mode. Scanners "type" a whole code in a
 * few milliseconds and usually end with Enter, which a person cannot do. Keys typed into a text box are
 * left alone (that box handles its own Enter), except a driver's license barcode, which starts with "@"
 * and spans many lines. Calls onScan with the full text, Enter keys turned into line breaks.
 */
export function useScanner(onScan: (text: string) => void, options: { enabled?: boolean; minLength?: number } = {}) {
  const { enabled = true, minLength = 4 } = options;
  const buffer = useRef("");
  const last = useRef(0);
  const idTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handler = useRef(onScan);
  useEffect(() => {
    handler.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;
    const flush = () => {
      const text = buffer.current;
      buffer.current = "";
      if (text.replace(/\n/g, "").length >= minLength) handler.current(text);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const now = performance.now();
      const gap = now - last.current;
      last.current = now;
      const idMode = buffer.current.startsWith("@");
      // Typing in a box: let it be, unless an ID barcode burst is already under way.
      if (isTypingField(document.activeElement) && !idMode) {
        buffer.current = "";
        return;
      }
      if (gap > 60 && !idMode) buffer.current = "";
      if (e.key === "Enter") {
        if (idMode) {
          buffer.current += "\n";
          e.preventDefault();
        } else if (buffer.current.length >= minLength) {
          e.preventDefault();
          flush();
          return;
        }
      } else if (e.key.length === 1) {
        if (buffer.current === "" && e.key === "@") e.preventDefault();
        buffer.current += e.key;
        if (idMode) e.preventDefault();
      } else if (e.key === "Tab" && idMode) {
        e.preventDefault();
        buffer.current += "\n";
      }
      if (buffer.current.startsWith("@")) {
        // An ID barcode is done when the keys stop coming.
        if (idTimer.current) clearTimeout(idTimer.current);
        idTimer.current = setTimeout(flush, 150);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (idTimer.current) clearTimeout(idTimer.current);
    };
  }, [enabled, minLength]);
}
