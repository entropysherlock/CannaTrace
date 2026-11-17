import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
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
  await seedSampleCompany({ orgName: "High Desert Demo Co.", emailDomain: "demo.test", passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10) });
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
