import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time codes (RFC 6238, built on RFC 4226) for two-step sign-in. This is the standard
 * every authenticator app speaks (Google Authenticator, Authy, 1Password, Microsoft Authenticator):
 * 6 digits, a new code every 30 seconds, HMAC-SHA1. Pure functions, no database.
 */

export const STEP_SECONDS = 30;
export const DIGITS = 6;
/** Codes one step either side of now still count, so a slow typist or a slightly wrong phone clock is fine. */
export const WINDOW_STEPS = 1;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const index = ALPHABET.indexOf(ch);
    if (index === -1) throw new Error("Not a valid base32 secret.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret: 160 bits, as base32 text (what the authenticator app stores). */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The one-time code for a counter value (RFC 4226). */
export function hotp(secret: string, counter: number, digits = DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export const stepAt = (epochMs: number): number => Math.floor(epochMs / 1000 / STEP_SECONDS);

export function totp(secret: string, epochMs: number, digits = DIGITS): string {
  return hotp(secret, stepAt(epochMs), digits);
}

const sameText = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Checks a typed code. Returns the time step it matched, or null. A step at or before `lastUsedStep`
 * is refused, so a code that was just used (or seen over someone's shoulder) cannot be used again.
 */
export function verifyTotp(secret: string, typed: string, epochMs: number, lastUsedStep: number | null = null): number | null {
  const code = typed.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepAt(epochMs);
  let matched: number | null = null;
  // Every step is checked, whatever the answer, so timing does not reveal which one matched.
  for (let step = now - WINDOW_STEPS; step <= now + WINDOW_STEPS; step++) {
    if (sameText(hotp(secret, step), code) && (lastUsedStep === null || step > lastUsedStep)) matched = step;
  }
  return matched;
}

/** The address an authenticator app scans (a QR code holds this text). */
export function otpauthUrl(account: string, issuer: string, secret: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/** The secret in groups of four, easier to read off a screen and type into an app. */
export const groupSecret = (secret: string): string => secret.replace(/(.{4})/g, "$1 ").trim();

// ---- Recovery codes: for a lost phone. Each works once. ----

export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** Ten codes like "k3m9x-t7q2d", shown once. 10 characters from 31 letters and digits is about 50 bits each. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

/** Lower-case, no dashes or spaces: so "K3M9X T7Q2D" and "k3m9x-t7q2d" are the same code. */
export const normalizeRecoveryCode = (code: string): string => code.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Only this hash is stored, so a copy of the database cannot be used to sign in. */
export const hashRecoveryCode = (code: string): string => createHash("sha256").update(`leaf2sale-recovery:${normalizeRecoveryCode(code)}`).digest("hex");

/** Does the typed text look like a recovery code rather than a 6-digit code? */
export const looksLikeRecoveryCode = (typed: string): boolean => normalizeRecoveryCode(typed).length === 10;
