import "server-only";
import { asc, eq } from "drizzle-orm";
import { itemCategories } from "@/db/schema";
import { db } from "./db";

/** Category names for the "+ Add item" dialog's suggestions. */
export async function itemCategoryNames(orgId: string): Promise<string[]> {
  const rows = await db.select({ name: itemCategories.name }).from(itemCategories).where(eq(itemCategories.orgId, orgId)).orderBy(asc(itemCategories.name));
  return rows.map((r) => r.name);
}
