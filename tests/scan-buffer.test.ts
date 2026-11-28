import { describe, expect, it } from "vitest";
import { ScanBuffer, looksLikeIdStart } from "../src/lib/scan-buffer";
import { parseIdBarcode } from "../src/lib/pos-math";

const LICENSE = "@\n\x1e\rANSI 636014080102DL00410288ZC03290034DLDAQD1234562\nDCSPUBLIC\nDACJOHN\nDBB03141988\nDBA03142028\nDAJNM\nDCGUSA\n";

/** Feed text to the buffer like a scanner: one key every `gapMs`, Enter for line breaks, control characters dropped. */
function scan(text: string, opts: { gapMs?: number; typing?: boolean; caps?: boolean } = {}) {
  const buf = new ScanBuffer();
  const { gapMs = 3, typing = false, caps = false } = opts;
  let now = 1000;
  const flushed: string[] = [];
  const prevented: boolean[] = [];
  for (const ch of text) {
    if (ch === "\x1e") continue; // arrives as Ctrl+^, which the hook ignores
    const key = ch === "\n" || ch === "\r" ? "Enter" : caps && /[A-Za-z]/.test(ch) ? (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()) : ch;
    now += gapMs;
    const r = buf.key({ key, typing, now });
    prevented.push(r.prevent);
    if (r.flush) flushed.push(r.flush);
  }
  const rest = buf.take(); // the idle timer firing after the last key
  if (rest) flushed.push(rest);
  return { flushed, prevented };
}

describe("keyboard-mode scanner: driver's license", () => {
  it("reads a normal license in one piece", () => {
    const { flushed } = scan(LICENSE);
    expect(flushed).toHaveLength(1);
    expect(parseIdBarcode(flushed[0])).toMatchObject({ birthDate: "1988-03-14", idExpires: "2028-03-14", state: "NM" });
  });

  it("reads it when the scanner drops the leading @ (set to strip prefixes)", () => {
    const { flushed } = scan(LICENSE.replace("@", ""));
    expect(flushed).toHaveLength(1);
    expect(parseIdBarcode(flushed[0])).toMatchObject({ birthDate: "1988-03-14" });
  });

  it("reads it when a non-US keyboard layout types a different first character", () => {
    const { flushed } = scan(LICENSE.replace("@", '"'));
    expect(flushed).toHaveLength(1);
    expect(parseIdBarcode(flushed[0])).toMatchObject({ birthDate: "1988-03-14" });
  });

  it("reads it with Caps Lock on, which flips every letter's case", () => {
    const { flushed } = scan(LICENSE, { caps: true });
    expect(flushed).toHaveLength(1);
    expect(parseIdBarcode(flushed[0])).toMatchObject({ birthDate: "1988-03-14", idExpires: "2028-03-14", firstName: "John" });
  });

  it("copes with a slow Bluetooth scanner", () => {
    const { flushed } = scan(LICENSE, { gapMs: 40 });
    expect(flushed).toHaveLength(1);
  });

  it("does not let the barcode's keys reach the page (a space would press a focused button)", () => {
    const { prevented } = scan(LICENSE.replace("@", ""));
    // After the key that completes "ANSI ", every key is held back from the page.
    expect(prevented.slice(7).every(Boolean)).toBe(true);
  });

  it("still reads it when focus was in a text box before the first key", () => {
    const { flushed } = scan(LICENSE, { typing: true });
    expect(flushed).toHaveLength(1);
  });
});

describe("keyboard-mode scanner: other codes and people", () => {
  it("reads a product tag that ends with Enter", () => {
    expect(scan("PKG-000155\n").flushed).toEqual(["PKG-000155"]);
  });

  it("ignores a person typing slowly", () => {
    expect(scan("ANSI 6360", { gapMs: 150 }).flushed).toEqual([]);
    expect(scan("hello\n", { gapMs: 150 }).flushed).toEqual([]);
  });

  it("ignores typing in a text box", () => {
    expect(scan("PKG-000155\n", { typing: true }).flushed).toEqual([]);
  });

  it("recognises license starts", () => {
    expect(looksLikeIdStart("@")).toBe(true);
    expect(looksLikeIdStart("ANSI 6360")).toBe(true);
    expect(looksLikeIdStart("ansi 6360")).toBe(true);
    expect(looksLikeIdStart("PKG-000155")).toBe(false);
    expect(looksLikeIdStart("ANSIBLE")).toBe(false);
  });
});

describe("license text that arrives in lower case", () => {
  it("parses once the case is put back", () => {
    expect(parseIdBarcode(LICENSE.toLowerCase())).toMatchObject({ birthDate: "1988-03-14", idExpires: "2028-03-14" });
  });
});

import { isScannedCode, nextBurstCount } from "@/lib/scan-buffer";

describe("scanner bursts typed into the product box (scanners that send no Enter)", () => {
  it("counts fast characters in a row, and resets when someone types slowly", () => {
    let fast = 0;
    for (let i = 2; i <= 9; i++) fast = nextBurstCount(fast, 4, i);
    expect(fast).toBe(8);
    expect(nextBurstCount(fast, 300, 10)).toBe(0);
    expect(nextBurstCount(0, 4, 1)).toBe(0);
  });
  it("treats a long fast run of code characters as a scan, and not a person or a name", () => {
    expect(isScannedCode("012345678905", 11)).toBe(true);
    expect(isScannedCode("0123456", 6)).toBe(false);
    expect(isScannedCode("blue mesa jar", 12)).toBe(false);
  });
});
