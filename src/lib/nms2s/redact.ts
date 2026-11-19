/**
 * Keep credentials out of logs, audit entries, error details, and saved findings.
 * Anything under a secret-looking key is replaced, and any known secret value is scrubbed from text.
 */

const SECRET_KEY = /(pass(word)?|secret|token|api[-_]?key|apikey|authorization|auth|credential|cookie|session|private|signature|bearer)/i;
export const REDACTED = "[redacted]";

export function redact<T>(value: T, secrets: readonly string[] = []): T {
  return walk(value, secrets.filter((s) => s && s.length >= 4), 0) as T;
}

function walk(value: unknown, secrets: readonly string[], depth: number): unknown {
  if (depth > 8) return REDACTED;
  if (typeof value === "string") return scrub(value, secrets);
  if (Array.isArray(value)) return value.map((v) => walk(v, secrets, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? REDACTED : walk(v, secrets, depth + 1);
    return out;
  }
  return value;
}

/** Remove known secret values and anything that looks like a bearer or basic credential from text. */
export function scrub(text: string, secrets: readonly string[] = [], max = 500): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join(REDACTED);
  out = out.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`);
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

/** What a person may see of a secret: its last four characters. */
export function hint(value: string): string {
  const v = value.trim();
  return v.length <= 8 ? "…" : `…${v.slice(-4)}`;
}
