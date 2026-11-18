import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { apiKeys, facilities, invites, organizations, users } from "@/db/schema";
import { allowedEmails, canSignIn, liveDemoOn, signupsOpen } from "@/lib/access";
import { db, pool } from "@/lib/db";
import { authenticateApiKey, createApiKey } from "@/lib/integrations";
import { sessionFromToken } from "@/lib/session";
import { acceptInvite } from "@/lib/team";

const hasDb = Boolean(process.env.DATABASE_URL);
const run = `ACC${Date.now().toString(36)}`;
const saved = { ...process.env };
/** The lock as production has it: nothing set. */
const locked = () => {
  delete process.env.OPEN_ACCESS;
  delete process.env.ALLOWED_SIGNIN_EMAILS;
  delete process.env.SIGNUPS_OPEN;
  delete process.env.LIVE_DEMO;
};
afterEach(() => {
  for (const k of ["OPEN_ACCESS", "ALLOWED_SIGNIN_EMAILS", "SIGNUPS_OPEN", "LIVE_DEMO"]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("invite-only access", () => {
  it("lets only Caleb and Carly sign in by default, with no sign-up and no live demo", () => {
    locked();
    expect(allowedEmails()).toEqual(["calebwestfall1989@gmail.com", "ccwestfall85@gmail.com"]);
    expect(canSignIn("CalebWestfall1989@gmail.com ")).toBe(true);
    expect(canSignIn("ccwestfall85@gmail.com")).toBe(true);
    expect(canSignIn("someone@else.com")).toBe(false);
    expect(canSignIn("")).toBe(false);
    expect(signupsOpen()).toBe(false);
    expect(liveDemoOn()).toBe(false);
  });
  it("can be changed from the server's settings without new code", () => {
    locked();
    process.env.ALLOWED_SIGNIN_EMAILS = "a@x.com, B@Y.com";
    expect(canSignIn("b@y.com")).toBe(true);
    expect(canSignIn("calebwestfall1989@gmail.com")).toBe(false);
    process.env.SIGNUPS_OPEN = "true";
    process.env.LIVE_DEMO = "on";
    expect([signupsOpen(), liveDemoOn()]).toEqual([true, true]);
  });
});

const cookie = (s: { userId: string; orgId: string; facilityId: string; name: string }) => {
  const iat = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...s, role: "OWNER" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt(iat).setExpirationTime(iat + 3600).sign(new TextEncoder().encode(process.env.AUTH_SECRET));
};

describe.skipIf(!hasDb)("the lock in practice (database)", () => {
  let stranger: { userId: string; orgId: string; facilityId: string; name: string };
  beforeAll(async () => {
    const [org] = await db.insert(organizations).values({ name: `Stranger ${run}` }).returning();
    const [f] = await db.insert(facilities).values({ orgId: org.id, name: "Shop", licenseNumber: run, licenseType: "RETAIL", state: "NM" }).returning();
    const [u] = await db.insert(users).values({ orgId: org.id, name: "Stranger", email: `${run}@stranger.invalid`, passwordHash: "x", role: "OWNER" }).returning();
    stranger = { userId: u.id, orgId: org.id, facilityId: f.id, name: u.name };
  });
  afterAll(() => pool.end());

  it("signs out anyone who isn't on the list, even if they signed in before the lock", async () => {
    const token = await cookie(stranger);
    process.env.OPEN_ACCESS = "1";
    expect(await sessionFromToken(token)).not.toBeNull();
    locked();
    expect(await sessionFromToken(token)).toBeNull();
  });

  it("stops API keys made by a business outside the list", async () => {
    process.env.OPEN_ACCESS = "1";
    const { key } = await createApiKey({ ...stranger, userName: "Stranger" }, { name: "Export", canWrite: false });
    expect(await authenticateApiKey(`Bearer ${key}`)).not.toBeNull();
    locked();
    expect(await authenticateApiKey(`Bearer ${key}`)).toBeNull();
    await db.delete(apiKeys).where(eq(apiKeys.orgId, stranger.orgId));
  });

  it("won't turn an invite into an account for someone not on the list", async () => {
    locked();
    const { createHash, randomBytes } = await import("node:crypto");
    const token = randomBytes(24).toString("base64url");
    await db.insert(invites).values({
      orgId: stranger.orgId,
      email: `${run}-invitee@stranger.invalid`,
      role: "MANAGER",
      tokenHash: createHash("sha256").update(token).digest("hex"),
      invitedBy: stranger.userId,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    await expect(acceptInvite(token, { name: "Invitee", password: "a-long-enough-password" })).rejects.toThrow(/invite-only/);
  });
});
