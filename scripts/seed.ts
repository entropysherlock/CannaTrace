import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { platformAdmins, users } from "@/db/schema";
import { db, pool } from "@/lib/db";
import { seedSampleCompany } from "@/lib/demo/sample-company";

/**
 * Load the demo company for local development and tests. Every demo account gets the given password.
 */
export async function seedDemo(DEMO_PASSWORD: string): Promise<boolean> {
  if ((await db.$count(users, eq(users.email, "owner@demo.test"))) > 0) {
    console.log("Demo data is already loaded; skipping seed.");
    return false;
  }
  const { users: team } = await seedSampleCompany({ orgName: "High Desert Demo Co.", emailDomain: "demo.test", passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10) });
  // Local and test databases only: the demo owner can try the support console. Production never runs this seed.
  const owner = team.find((u) => u.role === "OWNER")!;
  await db.insert(platformAdmins).values({ userId: owner.id, addedByName: "Local seed" }).onConflictDoNothing();
  console.log(`Seeded "High Desert Demo Co.". Sign in as owner@demo.test with the demo password.`);
  return true;
}
// Run directly (npm run db:seed): load the demo with the local password.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/seed.ts")) {
  seedDemo(process.env.DEMO_PASSWORD || "demo1234")
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
