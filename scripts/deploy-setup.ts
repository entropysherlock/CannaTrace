/**
 * Runs before every build on Vercel (npm run vercel-build). On the production deployment it:
 * 1. brings the database up to date with every migration in ./drizzle, and
 * 2. removes the made-up demo company if an earlier deploy loaded it.
 * Production never loads demo data. The first visitor is sent to /setup to create the real business.
 */
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "@/lib/db";
import { removeDemoCompany } from "./remove-demo";

async function main() {
  // Preview deployments (pull requests, branches) never touch a database while building: a preview
  // that shared production's settings would otherwise migrate the live database, or remove data, from
  // unmerged code. Only the production deployment of main brings the database up to date.
  if (process.env.VERCEL_ENV === "preview") {
    console.log("Preview deployment: skipping database setup. Previews never change a database while building.");
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set. Connect a Postgres database in your hosting settings.");
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 32) throw new Error("AUTH_SECRET must be set to a random string of at least 32 characters.");

  console.log("Updating the database...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Database is up to date.");
  console.log(await removeDemoCompany());
  if (process.env.DEMO_PASSWORD) console.log("DEMO_PASSWORD is set but no longer used. You can delete it from your hosting settings.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end().catch(() => {}));
