import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { auditLogs, facilities, licenseTypeEnum, organizations, users } from "@/db/schema";
import { db } from "./db";
import { InventoryError } from "./inventory-math";

/** True until the first owner account exists. The setup screen only works while this is true. */
export async function needsSetup(): Promise<boolean> {
  return (await db.$count(users)) === 0;
}

export const MIN_PASSWORD = 12;

export function checkEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new InventoryError("Enter a valid email address.");
  return email;
}

export function checkPassword(password: string): void {
  if (password.length < MIN_PASSWORD) throw new InventoryError(`Use a password of at least ${MIN_PASSWORD} characters.`);
  if (password.length > 200) throw new InventoryError("That password is too long.");
}

/** How many new businesses may sign up per hour, across the whole site, to slow down automated sign-ups. */
const SIGNUPS_PER_HOUR = Number(process.env.SIGNUPS_PER_HOUR ?? 20);

export type BusinessInput = {
  businessName: string;
  facilityName: string;
  licenseNumber: string;
  licenseType: string;
  state: string;
  ownerName: string;
  email: string;
  password: string;
};

/**
 * Create a business: organization, first licensed facility, and owner account.
 * With onlyIfEmpty (the first-run setup screen) it is refused once any account exists.
 */
export async function createBusiness(
  input: BusinessInput,
  options: { onlyIfEmpty: boolean },
): Promise<{ userId: string; orgId: string; facilityId: string; name: string }> {
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
  const email = checkEmail(input.email);
  if (input.password.length < MIN_PASSWORD)
    throw new InventoryError(`Use a password of at least ${MIN_PASSWORD} characters. This account can see and change everything.`);
  checkPassword(input.password);
  const passwordHash = await bcrypt.hash(input.password, 12);

  return db.transaction(async (tx) => {
    // One new business at a time, so the checks below cannot race each other.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('first-owner-setup'))`);
    if (options.onlyIfEmpty) {
      if ((await tx.$count(users)) > 0) throw new InventoryError("This system is already set up. Sign in instead.");
    } else {
      const recent = await tx.$count(organizations, sql`${organizations.createdAt} > now() - interval '1 hour'`);
      if (recent >= SIGNUPS_PER_HOUR) throw new InventoryError("Too many new sign-ups right now. Please try again in an hour.");
    }
    if ((await tx.$count(users, sql`${users.email} = ${email}`)) > 0)
      throw new InventoryError("An account with that email already exists. Sign in instead.");
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
      action: options.onlyIfEmpty ? "SETUP" : "SIGNUP",
      after: { businessName, facilityName, licenseNumber, licenseType: input.licenseType, state, owner: email },
    });
    return { userId: user.id, orgId: org.id, facilityId: facility.id, name: ownerName };
  });
}

/** The first-run setup screen: only works on an empty system. */
export function createFirstOwner(input: BusinessInput) {
  return createBusiness(input, { onlyIfEmpty: true });
}
