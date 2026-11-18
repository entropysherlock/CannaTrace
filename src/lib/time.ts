import { AsyncLocalStorage } from "node:async_hooks";
import { eq } from "drizzle-orm";
import { facilities } from "@/db/schema";
import { db } from "./db";
import { todayIn } from "./distribution-math";

/**
 * Each facility keeps time in its own state's time zone: "today" for age checks, daily purchase limits,
 * license expiry, invoice due dates, end-of-day, and the dates sent to the state. The zone is the one
 * that covers most of the state (Michigan's four Central-time counties and similar edges are not modelled).
 */
const STATE_ZONES: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix", AR: "America/Chicago", CA: "America/Los_Angeles",
  CO: "America/Denver", CT: "America/New_York", DE: "America/New_York", DC: "America/New_York", FL: "America/New_York",
  GA: "America/New_York", HI: "Pacific/Honolulu", ID: "America/Boise", IL: "America/Chicago", IN: "America/Indiana/Indianapolis",
  IA: "America/Chicago", KS: "America/Chicago", KY: "America/New_York", LA: "America/Chicago", ME: "America/New_York",
  MD: "America/New_York", MA: "America/New_York", MI: "America/Detroit", MN: "America/Chicago", MS: "America/Chicago",
  MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago", NV: "America/Los_Angeles", NH: "America/New_York",
  NJ: "America/New_York", NM: "America/Denver", NY: "America/New_York", NC: "America/New_York", ND: "America/Chicago",
  OH: "America/New_York", OK: "America/Chicago", OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago", UT: "America/Denver",
  VT: "America/New_York", VA: "America/New_York", WA: "America/Los_Angeles", WV: "America/New_York", WI: "America/Chicago",
  WY: "America/Denver",
};

/** Where CannaTrace started; used only when a facility's state is unknown. */
export const DEFAULT_ZONE = "America/Denver";

export const zoneForState = (state: string | null | undefined): string => STATE_ZONES[(state ?? "").toUpperCase()] ?? DEFAULT_ZONE;

const cache = new Map<string, { zone: string; at: number }>();
const TTL_MS = 5 * 60_000;

type Reader = Pick<typeof db, "select">;

/** A facility's time zone (cached for a few minutes; a facility's state rarely changes). */
export async function facilityZone(facilityId: string, reader: Reader = db): Promise<string> {
  const hit = cache.get(facilityId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.zone;
  const [row] = await reader.select({ state: facilities.state }).from(facilities).where(eq(facilities.id, facilityId));
  const zone = zoneForState(row?.state);
  cache.set(facilityId, { zone, at: Date.now() });
  return zone;
}

/** Forget a facility's cached zone, after its state changes. */
export const forgetFacilityZone = (facilityId: string) => cache.delete(facilityId);

/** Today's date (YYYY-MM-DD) at a facility. */
export async function facilityToday(facilityId: string, reader: Reader = db): Promise<string> {
  return todayIn(await facilityZone(facilityId, reader));
}

const zoneStore = new AsyncLocalStorage<string>();

/**
 * The time zone of the facility the current work is for. Tally's tools and Watch's checks read it; their
 * entry points set it with `inFacilityZone`. Outside one, it is the default zone.
 */
export const currentZone = (): string => zoneStore.getStore() ?? DEFAULT_ZONE;

export async function inFacilityZone<T>(facilityId: string, work: () => Promise<T>): Promise<T> {
  const zone = await facilityZone(facilityId);
  return zoneStore.run(zone, work);
}
