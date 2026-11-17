import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const DEMO_COMPANY = "High Desert Demo Co.";
export const DEMO_OWNER = "owner@demo.test";

/**
 * Remove the made-up demo company left by an earlier showcase deploy.
 * The public live demo's sample businesses (marked is_demo) are not counted and are not a reason to stop.
 * Only acts when the demo company is the ONLY organization in the database and is recognised
 * by both its name and its owner account. If any real business exists, it changes nothing.
 * Everything is emptied in one step (TRUNCATE), which is the only way past the locks that stop
 * history rows from being edited or deleted one by one.
 */
export async function removeDemoCompany(): Promise<string> {
  return db.transaction(async (tx) => {
    const orgs = (
      await tx.execute<{ id: string; name: string; demo_owner: boolean }>(sql`
        select o.id, o.name,
               exists (select 1 from users u where u.org_id = o.id and u.email = ${DEMO_OWNER}) as demo_owner
        from organizations o
        where not o.is_demo`)
    ).rows;
    if (orgs.length === 0) return "No businesses yet. The first visitor will be asked to set one up.";
    const demo = orgs.filter((o) => o.name === DEMO_COMPANY && o.demo_owner);
    if (demo.length === 0) return "No demo company found. Nothing removed.";
    if (orgs.length > demo.length) {
      return "The demo company was found alongside a real business, so nothing was removed automatically. Ask a developer to remove it by hand.";
    }
    const tables = (
      await tx.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`)
    ).rows.map((r) => `"public"."${r.tablename}"`);
    await tx.execute(sql.raw(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`));
    return "Removed the demo company and all of its made-up data. The first visitor will be asked to set up the real business.";
  });
}
