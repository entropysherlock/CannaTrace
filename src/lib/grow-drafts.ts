import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { DEFAULT_VEG_DAYS } from "@/lib/grow-timing";

/**
 * Helpers for the grow: which plants have been in veg long enough to flower, and which room they go to. The Grow
 * guide uses them to fill in its forms, and the Tally tools use them to plan the same move.
 */

type Scope = { orgId: string; facilityId: string };
type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => (await db.execute<Row>(q)).rows;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/**
 * The room flowering plants go to: the one that already holds the most flowering plants, or else the only room
 * with "flower" in its name. Null when it isn't clear, so Tally never guesses where plants should go.
 */
export async function flowerRoom(f: Scope): Promise<{ id: string; name: string } | null> {
  const used = await rows(sql`
    select l.id, l.name, count(*)::int as n from plants p join locations l on l.id = p.location_id
    where p.org_id = ${f.orgId} and p.facility_id = ${f.facilityId} and p.status = 'ACTIVE' and p.phase = 'FLOWERING'
    group by l.id, l.name order by n desc, l.name limit 2`);
  if (used.length && (used.length === 1 || Number(used[0].n) > Number(used[1].n))) return { id: s(used[0].id), name: s(used[0].name) };
  const named = await rows(sql`select id, name from locations where org_id = ${f.orgId} and facility_id = ${f.facilityId} and name ilike '%flower%' limit 2`);
  return named.length === 1 ? { id: s(named[0].id), name: s(named[0].name) } : null;
}

/** Vegetative plants that have been in veg for as long as their strain says (or the default), grouped by batch. */
export async function plantsDueToFlower(f: Scope, batchId?: string) {
  const found = await rows(sql`
    select b.id as batch_id, b.name as batch, st.name as strain, coalesce(st.veg_days, ${DEFAULT_VEG_DAYS}::int)::int as veg_days,
      st.veg_days is null as default_days,
      array_agg(p.id order by p.tag) as plant_ids, max(floor(extract(epoch from now() - p.phase_changed_at) / 86400))::int as days
    from plants p join plant_batches b on b.id = p.batch_id join strains st on st.id = p.strain_id
    where p.org_id = ${f.orgId} and p.facility_id = ${f.facilityId} and p.status = 'ACTIVE' and p.phase = 'VEGETATIVE' and p.harvest_id is null
      and floor(extract(epoch from now() - p.phase_changed_at) / 86400) >= coalesce(st.veg_days, ${DEFAULT_VEG_DAYS}::int)
      ${batchId ? sql`and b.id = ${batchId}` : sql``}
    group by b.id, b.name, st.name, st.veg_days order by min(p.phase_changed_at) limit 100`);
  return found.map((r) => ({
    batchId: s(r.batch_id),
    batch: s(r.batch),
    strain: s(r.strain),
    vegDays: Number(r.veg_days),
    defaultDays: r.default_days === true,
    days: Number(r.days),
    plantIds: (r.plant_ids as string[]) ?? [],
  }));
}
