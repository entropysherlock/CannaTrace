/**
 * Turns the key presses of a USB or Bluetooth scanner in keyboard mode into whole scans.
 * Kept free of React and the DOM so every scanner behaviour can be tested.
 *
 * A scanner "types" a code in a few milliseconds, usually ending with Enter. A driver's license barcode is
 * longer and spans many lines. It normally starts with "@", but that first character is not reliable: a
 * non-US keyboard layout turns it into something else, and some scanners are set to drop it. So a license
 * is also recognised by its "ANSI " or "AAMVA" header, in any letter case (Caps Lock flips it).
 */

/** Longest pause between two keys of one scan. A person typing is slower than this. */
export const MAX_KEY_GAP_MS = 80;
/** A license barcode is finished when no key has come for this long. */
export const ID_IDLE_FLUSH_MS = 150;

/** True when the text so far is the start of a driver's license or state ID barcode. */
export function looksLikeIdStart(text: string): boolean {
  return text.startsWith("@") || /^[^A-Za-z0-9]*(ANSI |AAMVA)/i.test(text);
}

export type ScanKeyInput = {
  key: string;
  /** Focus is in a text box, select or other typing field. */
  typing: boolean;
  /** performance.now() for this key press. */
  now: number;
};

export type ScanKeyResult = {
  /** Stop the key from also reaching the page (typing into a field, activating a focused button). */
  prevent: boolean;
  /** A complete scan, ready to use. */
  flush: string | null;
  /** The text so far is a license barcode: finish it after ID_IDLE_FLUSH_MS of quiet. */
  armIdTimer: boolean;
};

const NONE: ScanKeyResult = { prevent: false, flush: null, armIdTimer: false };

export class ScanBuffer {
  private text = "";
  private last = 0;

  constructor(private readonly minLength = 4) {}

  /** What has been collected so far. Only for tests. */
  peek() {
    return this.text;
  }

  /** The collected text as a scan, or null when it is too short to be one. Always clears the buffer. */
  take(): string | null {
    const text = this.text;
    this.text = "";
    return text.replace(/\n/g, "").length >= this.minLength ? text : null;
  }

  key({ key, typing, now }: ScanKeyInput): ScanKeyResult {
    const gap = now - this.last;
    this.last = now;
    const inId = looksLikeIdStart(this.text);
    // Typing in a box: let it be, unless a license barcode burst is already under way.
    // The "@" that opens a license barcode is the exception: a scanner fires it even while focus sits in
    // a field (the ID number or a date box is often focused), so start collecting there. Nobody types "@"
    // into the register's boxes.
    if (typing && !inId) {
      if (key === "@") {
        this.text = "@";
        return { prevent: true, flush: null, armIdTimer: true };
      }
      this.text = "";
      return NONE;
    }
    if (gap > MAX_KEY_GAP_MS && !inId) this.text = "";

    let prevent = false;
    if (key === "Enter") {
      if (inId) {
        this.text += "\n";
        prevent = true;
      } else if (this.text.length >= this.minLength) {
        return { prevent: true, flush: this.take(), armIdTimer: false };
      }
    } else if (key.length === 1) {
      if (this.text === "" && key === "@") prevent = true;
      this.text += key;
      if (inId) prevent = true;
    } else if (key === "Tab" && inId) {
      prevent = true;
      this.text += "\n";
    }
    // The key that completes the header ("ANSI ") must not leak to the page either (a space would press a focused button).
    const nowId = looksLikeIdStart(this.text);
    return { prevent: prevent || nowId, flush: null, armIdTimer: nowId };
  }
}

/** Characters arriving closer together than this (ms) are a scanner, not a person typing. */
export const BURST_GAP_MS = 50;
/** This many fast characters in a row means a scanner is typing a code into a box. */
export const BURST_MIN_KEYS = 7;
/** Quiet time (ms) after a burst before the code is treated as finished, for scanners that send no Enter key. */
export const BURST_DONE_MS = 180;

/** Count of fast characters in a row, given the gap since the last change and how long the box text is now. */
export function nextBurstCount(fastSoFar: number, gapMs: number, valueLength: number): number {
  return gapMs < BURST_GAP_MS && valueLength > 1 ? fastSoFar + 1 : 0;
}

/** True when the text, typed in a scanner burst, looks like a code to ring up (no spaces or odd characters). */
export const isScannedCode = (value: string, fast: number): boolean => fast >= BURST_MIN_KEYS && /^[A-Za-z0-9._-]+$/.test(value);
