import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { OAuthError, exchangeCode, makeCode, parseAuthorize, readClient, registerClient, validRedirect } from "@/lib/oauth";

const verifier = "a".repeat(43) + "-._~";
const challenge = createHash("sha256").update(verifier).digest("base64url");
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-test-secret-test-secret";
});

async function client(uris = [REDIRECT]) {
  return (await registerClient({ redirect_uris: uris, client_name: "Claude" })).client_id;
}
const query = (clientId: string, over: Record<string, string> = {}) => ({ client_id: clientId, redirect_uri: REDIRECT, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "xyz", ...over });
const approval = { orgId: "o", facilityId: "f", userId: "u", userName: "Owner", canWrite: false };
const fails = async (p: Promise<unknown>, code: string) => expect(await p.then(() => null, (e) => (e instanceof OAuthError ? e.code : e))).toBe(code);

describe("OAuth sign-in for AI apps", () => {
  it("accepts https and local http return addresses only", () => {
    expect(validRedirect(REDIRECT)).toBe(true);
    expect(validRedirect("http://localhost:3000/cb")).toBe(true);
    for (const bad of ["http://evil.com/cb", "javascript:alert(1)", "claude://cb", "https://x.com/cb#frag", "https://u:p@x.com/cb", "not a url", 5]) expect(validRedirect(bad)).toBe(false);
  });

  it("registers an app and reads it back, and rejects bad registrations", async () => {
    const id = await client();
    expect(await readClient(id)).toEqual({ name: "Claude", redirectUris: [REDIRECT] });
    expect(await readClient("garbage")).toBeNull();
    await fails(registerClient({ redirect_uris: ["http://evil.com/cb"] }), "invalid_request");
    await fails(registerClient({ redirect_uris: [] }), "invalid_request");
  });

  it("only approves a registered app, return address, and PKCE S256", async () => {
    const id = await client();
    expect((await parseAuthorize(query(id))).clientName).toBe("Claude");
    await fails(parseAuthorize(query("nope")), "invalid_client");
    await fails(parseAuthorize(query(id, { redirect_uri: "https://evil.com/cb" })), "invalid_request");
    await fails(parseAuthorize(query(id, { code_challenge_method: "plain" })), "invalid_request");
    await fails(parseAuthorize(query(id, { code_challenge: "short" })), "invalid_request");
    await fails(parseAuthorize(query(id, { response_type: "token" })), "invalid_request");
  });

  it("refuses a code with the wrong verifier, app, return address, or a tampered body", async () => {
    const id = await client();
    const code = await makeCode(await parseAuthorize(query(id)), approval);
    const good = { code, clientId: id, redirectUri: REDIRECT, verifier };
    await fails(exchangeCode({ ...good, verifier: "b".repeat(50) }), "invalid_grant");
    await fails(exchangeCode({ ...good, clientId: await client(["https://chatgpt.com/cb"]) }), "invalid_grant");
    await fails(exchangeCode({ ...good, redirectUri: "https://claude.ai/other" }), "invalid_grant");
    await fails(exchangeCode({ ...good, code: code.slice(0, -3) + "abc" }), "invalid_grant");
    await fails(exchangeCode({ ...good, verifier: "short" }), "invalid_grant");
  });

  it("does not accept a note signed with the sign-in cookie's key, or an app id as a code", async () => {
    const id = await client();
    const forged = await new SignJWT({ cid: id, ruri: REDIRECT, ch: challenge, orgId: "o", facilityId: "f", userId: "u", userName: "x", canWrite: true })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("https://leaf2sale.com")
      .setAudience("oauth-code")
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
    await fails(exchangeCode({ code: forged, clientId: id, redirectUri: REDIRECT, verifier }), "invalid_grant");
    await fails(exchangeCode({ code: id, clientId: id, redirectUri: REDIRECT, verifier }), "invalid_grant");
  });
});
