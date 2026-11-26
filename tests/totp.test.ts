import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  hotp,
  looksLikeRecoveryCode,
  otpauthUrl,
  stepAt,
  totp,
  verifyTotp,
} from "@/lib/totp";

// RFC 6238 appendix B, SHA-1 secret "12345678901234567890", 6 digits (the last 6 of the published 8-digit values).
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("totp", () => {
  it("matches the RFC 6238 test vectors", () => {
    const cases: [number, string][] = [
      [59, "287082"],
      [1111111109, "081804"],
      [1111111111, "050471"],
      [1234567890, "005924"],
      [2000000000, "279037"],
    ];
    for (const [seconds, code] of cases) expect(totp(RFC_SECRET, seconds * 1000)).toBe(code);
  });

  it("round-trips base32", () => {
    const secret = generateSecret();
    expect(base32Encode(base32Decode(secret))).toBe(secret);
  });

  it("accepts the code from the neighbouring steps but not further away", () => {
    const now = 1_700_000_000_000;
    const secret = generateSecret();
    const at = (offset: number) => totp(secret, now + offset * 30_000);
    expect(verifyTotp(secret, at(0), now, null)).toBe(stepAt(now));
    expect(verifyTotp(secret, at(-1), now, null)).toBe(stepAt(now) - 1);
    expect(verifyTotp(secret, at(1), now, null)).toBe(stepAt(now) + 1);
    expect(verifyTotp(secret, at(3), now, null)).toBeNull();
  });

  it("refuses a code that was already used", () => {
    const now = 1_700_000_000_000;
    const secret = generateSecret();
    const code = totp(secret, now);
    const step = verifyTotp(secret, code, now, null);
    expect(step).not.toBeNull();
    expect(verifyTotp(secret, code, now, step)).toBeNull();
  });

  it("ignores spaces and rejects junk", () => {
    const now = 1_700_000_000_000;
    const secret = generateSecret();
    const code = totp(secret, now);
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now, null)).not.toBeNull();
    expect(verifyTotp(secret, "abcdef", now, null)).toBeNull();
    expect(verifyTotp(secret, "", now, null)).toBeNull();
  });

  it("builds an otpauth link", () => {
    const url = otpauthUrl("a@b.com", "Leaf2Sale", "ABC");
    expect(url).toContain("otpauth://totp/");
    expect(url).toContain("secret=ABC");
    expect(url).toContain("issuer=Leaf2Sale");
  });

  it("makes distinct recovery codes that hash the same however they are typed", () => {
    const codes = generateRecoveryCodes(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) {
      expect(looksLikeRecoveryCode(c)).toBe(true);
      expect(hashRecoveryCode(c.toUpperCase().replace("-", " "))).toBe(hashRecoveryCode(c));
    }
    expect(looksLikeRecoveryCode("123456")).toBe(false);
  });

  it("hotp is deterministic", () => {
    expect(hotp(RFC_SECRET, 1)).toBe("287082");
  });
});
