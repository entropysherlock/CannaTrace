import { describe, expect, it } from "vitest";
import { darkPixels, dotsFor, zplFromBitmap } from "../src/lib/labels/zpl";

describe("zpl", () => {
  it("sizes labels in dots", () => {
    expect(dotsFor(25.4, 203)).toBe(203);
    expect(dotsFor(50.8, 300)).toBe(600);
  });
  it("packs a bitmap into padded hex rows", () => {
    // 10 wide x 2 tall: row 0 all black, row 1 only the first pixel black.
    const dark = new Uint8Array(20);
    dark.fill(1, 0, 10);
    dark[10] = 1;
    const zpl = zplFromBitmap(dark, 10, 2, 3);
    expect(zpl).toContain("^GFA,4,4,2,FFC08000");
    expect(zpl).toContain("^PW10^LL2");
    expect(zpl).toContain("^PQ3,0,1,N");
    expect(zpl.startsWith("^XA")).toBe(true);
    expect(zpl.endsWith("^XZ")).toBe(true);
  });
  it("rejects a wrongly sized bitmap and clamps copies", () => {
    expect(() => zplFromBitmap(new Uint8Array(3), 2, 2)).toThrow();
    expect(zplFromBitmap(new Uint8Array(1), 1, 1, 999)).toContain("^PQ50");
    expect(zplFromBitmap(new Uint8Array(1), 1, 1, 0)).toContain("^PQ1");
  });
  it("treats dark opaque pixels as black", () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0, 120, 120, 120, 255]);
    expect(Array.from(darkPixels(rgba, 4, 1))).toEqual([1, 0, 0, 1]);
  });
});
