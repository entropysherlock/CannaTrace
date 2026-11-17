import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encrypts customer API keys at rest with AES-256-GCM. The master key comes from the environment
 * (AI_KEY_ENCRYPTION_KEY: 32 random bytes, base64 or hex) and never touches the database. Each value
 * is bound to its business (the org id is authenticated data), so a stored key copied to another
 * business's row cannot be decrypted there. AI_KEY_ENCRYPTION_KEY_PREVIOUS lets the master key be
 * rotated: old values still decrypt and are re-encrypted with the new key on the next save.
 */

export class SecretBoxError extends Error {}

type MasterKey = { id: string; key: Buffer };

/** Shortest master secret accepted: anything shorter is too easy to guess. */
export const MIN_SECRET_CHARS = 32;

function parseKey(raw: string | undefined): MasterKey | null {
  if (!raw) return null;
  const text = raw.trim().replace(/^["']|["']$/g, "");
  if (!text) return null;
  let key: Buffer;
  if (/^[0-9a-f]{64}$/i.test(text)) key = Buffer.from(text, "hex");
  else if (/^[A-Za-z0-9+/]{43}=$/.test(text)) key = Buffer.from(text, "base64");
  else if (text.length >= MIN_SECRET_CHARS) key = createHash("sha256").update(`cannatrace-ai-key:${text}`).digest();
  else throw new SecretBoxError(`AI_KEY_ENCRYPTION_KEY is too short (${text.length} characters). Use the generated value (44 characters).`);
  return { id: createHash("sha256").update(key).digest("hex").slice(0, 8), key };
}

function keys(): { current: MasterKey | null; previous: MasterKey | null } {
  return { current: parseKey(process.env.AI_KEY_ENCRYPTION_KEY), previous: parseKey(process.env.AI_KEY_ENCRYPTION_KEY_PREVIOUS) };
}

/** Whether the master key is present and usable, without revealing anything about its value. */
/** Length of the configured secret, for telling someone why it was refused. Never the value. */
export function secretLength(): number {
  return (process.env.AI_KEY_ENCRYPTION_KEY ?? "").trim().length;
}

export function encryptionStatus(): "ready" | "missing" | "invalid" {
  if (!process.env.AI_KEY_ENCRYPTION_KEY?.trim()) return "missing";
  try {
    return keys().current ? "ready" : "missing";
  } catch {
    return "invalid";
  }
}

/** True when this server can store customer keys. */
export function encryptionReady(): boolean {
  try {
    return keys().current !== null;
  } catch {
    return false;
  }
}

const aad = (orgId: string) => Buffer.from(`cannatrace:ai-key:${orgId}`);

export function sealSecret(plaintext: string, orgId: string): string {
  const { current } = keys();
  if (!current) throw new SecretBoxError("Key storage is not set up on this server (AI_KEY_ENCRYPTION_KEY is missing).");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", current.key, iv);
  cipher.setAAD(aad(orgId));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", current.id, iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function openSecret(sealed: string, orgId: string): string {
  const [version, keyId, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !keyId || !iv || !tag || !body) throw new SecretBoxError("The stored key is in an unknown format.");
  const { current, previous } = keys();
  const master = [current, previous].find((k) => k?.id === keyId);
  if (!master) throw new SecretBoxError("The stored key was saved with an encryption key this server no longer has.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", master.key, Buffer.from(iv, "base64"));
    decipher.setAAD(aad(orgId));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretBoxError("The stored key could not be decrypted for this business.");
  }
}

/** Whether a sealed value uses an older master key and should be re-encrypted. */
export function needsReseal(sealed: string): boolean {
  const { current } = keys();
  return Boolean(current) && sealed.split(".")[1] !== current!.id;
}

/** What a person may see of a key: its type and last four characters, never the rest. */
export function keyHint(apiKey: string): string {
  const k = apiKey.trim();
  return `${k.startsWith("sk-ant-") ? "sk-ant-" : ""}…${k.slice(-4)}`;
}

/**
 * Encrypt file bytes (Tally attachments) with the same master key, bound to the business and the file,
 * so a stored file copied to another row or business cannot be decrypted there.
 * Layout: keyId(8 ascii) | iv(12) | tag(16) | ciphertext.
 */
export function sealBytes(plain: Buffer, context: string): Buffer {
  const { current } = keys();
  if (!current) throw new SecretBoxError("File storage is not set up on this server (AI_KEY_ENCRYPTION_KEY is missing).");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", current.key, iv);
  cipher.setAAD(Buffer.from(`cannatrace:file:${context}`));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from(current.id, "ascii"), iv, cipher.getAuthTag(), body]);
}

export function openBytes(sealed: Buffer, context: string): Buffer {
  const keyId = sealed.subarray(0, 8).toString("ascii");
  const { current, previous } = keys();
  const master = [current, previous].find((k) => k?.id === keyId);
  if (!master) throw new SecretBoxError("This file was saved with an encryption key this server no longer has.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", master.key, sealed.subarray(8, 20));
    decipher.setAAD(Buffer.from(`cannatrace:file:${context}`));
    decipher.setAuthTag(sealed.subarray(20, 36));
    return Buffer.concat([decipher.update(sealed.subarray(36)), decipher.final()]);
  } catch {
    throw new SecretBoxError("This file could not be decrypted.");
  }
}
