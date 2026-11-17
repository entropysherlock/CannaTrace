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

function parseKey(raw: string | undefined): MasterKey | null {
  if (!raw) return null;
  const text = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(text) ? Buffer.from(text, "hex") : Buffer.from(text, "base64");
  if (key.length !== 32) throw new SecretBoxError("AI_KEY_ENCRYPTION_KEY must be 32 random bytes, written as base64 or 64 hex characters.");
  return { id: createHash("sha256").update(key).digest("hex").slice(0, 8), key };
}

function keys(): { current: MasterKey | null; previous: MasterKey | null } {
  return { current: parseKey(process.env.AI_KEY_ENCRYPTION_KEY), previous: parseKey(process.env.AI_KEY_ENCRYPTION_KEY_PREVIOUS) };
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
