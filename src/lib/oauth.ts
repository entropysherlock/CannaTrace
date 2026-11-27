import "server-only";
import { createHash, createHmac } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { createApiKey } from "./integrations";
import { SITE_URL } from "./site";

/**
 * Sign-in for outside AI apps (OAuth 2.1 with PKCE), so a customer can connect Claude or ChatGPT by
 * pressing Approve instead of pasting a key. Nothing here is stored in the database:
 *  - an app's client_id is a signed note of its name and allowed return addresses,
 *  - the authorization code is a signed 5-minute note of who approved what,
 *  - the access token is an ordinary API key, made when the code is exchanged, so it shows up on the
 *    Integrations page, is limited to one facility, appears in the audit trail, and is revoked there.
 */

export class OAuthError extends Error {
  constructor(
    public code: "invalid_request" | "invalid_client" | "invalid_grant" | "unsupported_grant_type" | "access_denied",
    message: string,
  ) {
    super(message);
  }
}

// A separate key from the sign-in cookie's, so a note made here can never be used as a sign-in or the reverse.
const signingKey = () => {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) throw new Error("AUTH_SECRET is missing or too short. Set it in your environment (see .env.example).");
  return createHmac("sha256", secret).update("leaf2sale-oauth-v1").digest();
};

export const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Cache-Control": "no-store" };

/** Return addresses an app may use: https anywhere, or http on the same computer (for desktop apps). */
export function validRedirect(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 500) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

const cleanName = (raw: unknown) => (typeof raw === "string" ? raw.replace(/[^\p{L}\p{N} ._()'-]/gu, "").trim().slice(0, 60) : "") || "AI app";

export async function registerClient(body: Record<string, unknown>) {
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 5 || !uris.every(validRedirect))
    throw new OAuthError("invalid_request", "redirect_uris must list 1 to 5 https addresses (or http://localhost).");
  const name = cleanName(body.client_name);
  const clientId = await new SignJWT({ redirect_uris: uris, name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(SITE_URL)
    .setAudience("oauth-client")
    .setIssuedAt()
    .setExpirationTime("365d")
    .sign(signingKey());
  return {
    client_id: clientId,
    client_name: name,
    redirect_uris: uris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

export async function readClient(clientId: unknown): Promise<{ name: string; redirectUris: string[] } | null> {
  if (typeof clientId !== "string") return null;
  try {
    const { payload } = await jwtVerify(clientId, signingKey(), { issuer: SITE_URL, audience: "oauth-client" });
    const uris = payload.redirect_uris;
    if (!Array.isArray(uris) || !uris.every(validRedirect)) return null;
    return { name: cleanName(payload.name), redirectUris: uris };
  } catch {
    return null;
  }
}

export type AuthorizeRequest = { clientId: string; clientName: string; redirectUri: string; challenge: string; state: string };

const CHALLENGE = /^[A-Za-z0-9_-]{43}$/; // a SHA-256 digest, base64url

/** Check an approval request. A bad app or return address is never redirected to; the person sees an error instead. */
export async function parseAuthorize(p: Record<string, string | string[] | undefined>): Promise<AuthorizeRequest> {
  const one = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  const client = await readClient(one("client_id"));
  if (!client) throw new OAuthError("invalid_client", "This app is not recognised. Start the connection again from the app.");
  if (!client.redirectUris.includes(one("redirect_uri"))) throw new OAuthError("invalid_request", "The return address does not match what the app registered.");
  if (one("response_type") !== "code") throw new OAuthError("invalid_request", "Unsupported response_type.");
  if (!CHALLENGE.test(one("code_challenge")) || one("code_challenge_method") !== "S256") throw new OAuthError("invalid_request", "The app must use PKCE with S256.");
  return { clientId: one("client_id"), clientName: client.name, redirectUri: one("redirect_uri"), challenge: one("code_challenge"), state: one("state").slice(0, 512) };
}

export type Approval = { orgId: string; facilityId: string; userId: string; userName: string; canWrite: boolean };

export async function makeCode(req: AuthorizeRequest, approval: Approval): Promise<string> {
  return new SignJWT({ cid: req.clientId, cname: req.clientName, ruri: req.redirectUri, ch: req.challenge, ...approval })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(SITE_URL)
    .setAudience("oauth-code")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(signingKey());
}

/** Swap an approval code, plus the app's PKCE secret, for an access token (a new API key for one facility). */
export async function exchangeCode(input: { code: string; clientId: string; redirectUri: string; verifier: string }) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier)) throw new OAuthError("invalid_grant", "Bad code_verifier.");
  let p: Awaited<ReturnType<typeof jwtVerify>>["payload"];
  try {
    p = (await jwtVerify(input.code, signingKey(), { issuer: SITE_URL, audience: "oauth-code" })).payload;
  } catch {
    throw new OAuthError("invalid_grant", "That code is invalid or has expired. Start the connection again.");
  }
  if (p.cid !== input.clientId || p.ruri !== input.redirectUri) throw new OAuthError("invalid_grant", "The code was issued to a different app or return address.");
  if (createHash("sha256").update(input.verifier).digest("base64url") !== p.ch) throw new OAuthError("invalid_grant", "PKCE check failed.");
  const canWrite = p.canWrite === true;
  const name = `${cleanName(p.cname)} (AI connector)`;
  const actor = { userId: String(p.userId), userName: `${String(p.userName)} (via ${cleanName(p.cname)})`, orgId: String(p.orgId), facilityId: String(p.facilityId) };
  const { key } = await createApiKey(actor, { name, canWrite });
  return { access_token: key, token_type: "Bearer", scope: canWrite ? "read write" : "read" };
}

export const metadata = {
  resource: () => ({ resource: `${SITE_URL}/api/mcp`, authorization_servers: [SITE_URL], bearer_methods_supported: ["header"], scopes_supported: ["read", "write"] }),
  server: () => ({
    issuer: SITE_URL,
    authorization_endpoint: `${SITE_URL}/oauth/authorize`,
    token_endpoint: `${SITE_URL}/api/oauth/token`,
    registration_endpoint: `${SITE_URL}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["read", "write"],
  }),
};
