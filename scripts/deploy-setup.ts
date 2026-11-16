/**
 * Runs before every production build (npm run vercel-build):
 * 1. brings the database up to date with every migration in ./drizzle, and
 * 2. if DEMO_PASSWORD is set and the demo is not loaded yet, loads the demo company.
 * Safe to run on every deploy: migrations that already ran are skipped, and so is the demo.
 */
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "@/lib/db";
import { seedDemo } from "./seed";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set. Connect a Postgres database in your hosting settings.");
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 32) throw new Error("AUTH_SECRET must be set to a random string of at least 32 characters.");

  console.log("Updating the database...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Database is up to date.");

  const demo = process.env.DEMO_PASSWORD;
  if (!demo) {
    console.log("DEMO_PASSWORD is not set, so no demo data was loaded.");
  } else if (demo.length < 12 || demo === "demo1234") {
    throw new Error("DEMO_PASSWORD must be at least 12 characters and not the public local password. Anyone who guesses it can sign in.");
  } else {
    await seedDemo(demo);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
