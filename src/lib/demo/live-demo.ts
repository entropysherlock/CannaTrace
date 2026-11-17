import "server-only";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import { facilities, organizations, users } from "@/db/schema";
import { db } from "@/lib/db";
import { InventoryError } from "@/lib/inventory-math";
import type { SessionToken } from "@/lib/session";
import { seedSampleCompany } from "./sample-company";

/**
 * The public live demo: one shared sample business per day (UTC). The first visitor of the day
 * creates it; everyone else that day joins it. Older days are switched off, so the demo starts
 * clean every morning. Nobody signs in with a password: the demo owner has an unusable one.
 */

export const DEMO_BUSINESS_NAME = "Desert Bloom Cannabis Co. (sample)";
/** Tally questions allowed per demo day across all visitors. */
export const DEMO_ASSISTANT_DAILY_LIMIT = Number(process.env.DEMO_ASSISTANT_DAILY_LIMIT ?? 150);

export function liveDemoEnabled(): boolean {
  return process.env.LIVE_DEMO !== "off";
}

export function demoDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

const SEED_TIMEOUT_MS = 3 * 60 * 1000;

async function seedDemoOrg(orgId: string, day: string): Promise<void> {
  await seedSampleCompany({
    orgId,
    orgName: DEMO_BUSINESS_NAME,
    emailDomain: `demo-${day}.cannatrace.invalid`,
    passwordHash: await bcrypt.hash(randomUUID(), 10),
  });
  await db.update(organizations).set({ demoReady: true }).where(eq(organizations.id, orgId));
  // Earlier days are switched off: their visitors' sign-ins stop working and they start fresh.
  const old = db
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(eq(organizations.isDemo, true), lt(organizations.demoDay, day)));
  await db.update(users).set({ active: false }).where(and(sql`${users.orgId} in ${old}`, eq(users.active, true)));
}

/** Today's demo business, created and filled on first use. Waits if another visitor is creating it. */
export async function todaysDemoOrg(now = new Date()): Promise<string> {
  const day = demoDayKey(now);
  for (let attempt = 0; attempt < 60; attempt++) {
    const [inserted] = await db
      .insert(organizations)
      .values({ name: DEMO_BUSINESS_NAME, isDemo: true, demoDay: day })
      .onConflictDoNothing({ target: organizations.demoDay })
      .returning({ id: organizations.id });
    if (inserted) {
      await seedDemoOrg(inserted.id, day);
      return inserted.id;
    }
    const [org] = await db.select().from(organizations).where(eq(organizations.demoDay, day));
    if (!org) continue;
    if (org.demoReady) return org.id;
    if (Date.now() - org.createdAt.getTime() > SEED_TIMEOUT_MS) {
      // A filling that never finished (the server stopped part way). Set it aside and start again.
      await db
        .update(organizations)
        .set({ demoDay: `${day}-unfinished-${org.id}` })
        .where(and(eq(organizations.id, org.id), eq(organizations.demoReady, false)));
      continue;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new InventoryError("The live demo is still being set up. Refresh the page in a few seconds.");
}

/** A sign-in for today's demo, as its owner, at its first facility. */
export async function liveDemoSession(now = new Date()): Promise<SessionToken> {
  const orgId = await todaysDemoOrg(now);
  const [owner] = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.role, "OWNER"), eq(users.active, true)))
    .orderBy(asc(users.createdAt))
    .limit(1);
  const [facility] = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(eq(facilities.orgId, orgId))
    .orderBy(asc(facilities.createdAt), asc(facilities.name))
    .limit(1);
  if (!owner || !facility) throw new InventoryError("The live demo is not available right now. Please try again later.");
  return { userId: owner.id, orgId, facilityId: facility.id, role: owner.role, name: owner.name };
}

/** Count one Tally question against the demo's daily allowance. False when it is used up. */
export async function takeDemoAssistantCall(orgId: string): Promise<boolean> {
  const rows = await db
    .update(organizations)
    .set({ demoAssistantCalls: sql`${organizations.demoAssistantCalls} + 1` })
    .where(
      and(
        eq(organizations.id, orgId),
        eq(organizations.isDemo, true),
        lt(organizations.demoAssistantCalls, DEMO_ASSISTANT_DAILY_LIMIT),
      ),
    )
    .returning({ id: organizations.id });
  return rows.length > 0;
}
