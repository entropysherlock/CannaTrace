import { sql } from "drizzle-orm";
import { counters } from "@/db/schema";
import type { Tx } from "./db";

/** Next running number for a facility, safe when two people ask at once. */
export async function nextNumber(tx: Tx, facilityId: string, kind: "SO" | "MAN" | "INV" | "S" | "R" | "PU" | "PO"): Promise<string> {
  const [row] = await tx
    .insert(counters)
    .values({ facilityId, kind, value: 1 })
    .onConflictDoUpdate({ target: [counters.facilityId, counters.kind], set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  return `${kind}-${String(row.value).padStart(5, "0")}`;
}
