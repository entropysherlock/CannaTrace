import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { auditLogs, facilities, licenseTypeEnum, organizations, users } from "@/db/schema";
import { db } from "./db";
import { InventoryError } from "./inventory-math";

/** True until the first owner account exists. The setup screen only works while this is true. */
export async function needsSetup(): Promise<boolean> {
  return (await db.$count(users)) === 0;
}

/**
 * Create the real business: organization, first licensed facility, and owner account.
 * Refused once any account exists, so nobody can use it to take over a running system.
 */
export async function createFirstOwner(input: {
  businessName: string;
  facilityName: string;
  licenseNumber: string;
  licenseType: string;
  state: string;
  ownerName: string;
  email: string;
  password: string;
}): Promise<{ userId: string; orgId: string; facilityId: string; name: string }> {
  const text = (value: string, message: string, max = 120) => {
    const t = value.trim().slice(0, max);
    if (!t) throw new InventoryError(message);
    return t;
  };
  const businessName = text(input.businessName, "Enter your business name.");
  const facilityName = text(input.facilityName, "Enter a name for this facility, for example its street or nickname.");
  const licenseNumber = text(input.licenseNumber, "Enter the facility's state license number.", 60).toUpperCase();
  if (!(licenseTypeEnum.enumValues as readonly string[]).includes(input.licenseType)) throw new InventoryError("Choose the license type.");
  const state = input.state.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) throw new InventoryError("Enter the two-letter state code, for example NM.");
  const ownerName = text(input.ownerName, "Enter your name.", 100);
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InventoryError("Enter a valid email address.");
  if (input.password.length < 12) throw new InventoryError("Use a password of at least 12 characters. This account can see and change everything.");
  const passwordHash = await bcrypt.hash(input.password, 12);

  return db.transaction(async (tx) => {
    // One setup at a time, and only on an empty system.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('first-owner-setup'))`);
    if ((await tx.$count(users)) > 0) throw new InventoryError("This system is already set up. Sign in instead.");
    const [org] = await tx.insert(organizations).values({ name: businessName }).returning();
    const [facility] = await tx
      .insert(facilities)
      .values({ orgId: org.id, name: facilityName, licenseNumber, licenseType: input.licenseType as "RETAIL", state })
      .returning();
    const [user] = await tx.insert(users).values({ orgId: org.id, name: ownerName, email, passwordHash, role: "OWNER" }).returning();
    await tx.insert(auditLogs).values({
      orgId: org.id,
      facilityId: facility.id,
      userId: user.id,
      userName: ownerName,
      entityType: "Organization",
      entityId: org.id,
      action: "SETUP",
      after: { businessName, facilityName, licenseNumber, licenseType: input.licenseType, state, owner: email },
    });
    return { userId: user.id, orgId: org.id, facilityId: facility.id, name: ownerName };
  });
}
