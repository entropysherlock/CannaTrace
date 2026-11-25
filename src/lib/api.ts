import Decimal from "decimal.js";
import type { ApiKey } from "@/db/schema";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { authenticateApiKey } from "./integrations";
import { InventoryError } from "./inventory-math";
import type { Actor } from "./inventory";

export type ApiContext = { key: ApiKey; actor: Actor };

class BadRequest extends Error {}

/** Read the request body, which must be a JSON object. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    throw new BadRequest("The request body must be valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequest("The request body must be a JSON object, like {\"newQuantity\": \"98.5\"}.");
  return body as Record<string, unknown>;
}

/** Requests one API key may make per minute. */
export const API_REQUESTS_PER_MINUTE = 300;

/** Count this request against the key's current minute. Returns false when the key is over its limit. */
export async function takeApiRequest(keyId: string): Promise<boolean> {
  const [row] = (
    await db.execute<{ count: number }>(sql`
      insert into api_rate_windows (key_id, window_start, count) values (${keyId}, date_trunc('minute', now()), 1)
      on conflict (key_id, window_start) do update set count = api_rate_windows.count + 1
      returning count`)
  ).rows;
  // Old windows are of no use; clear them now and then instead of on every request.
  if (Math.random() < 0.01) await db.execute(sql`delete from api_rate_windows where window_start < now() - interval '1 hour'`);
  return row.count <= API_REQUESTS_PER_MINUTE;
}

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Decode a path piece, turning a broken % escape into a clear 400-style message instead of a server error. */
export function safeDecode(piece: string): string {
  try {
    return decodeURIComponent(piece);
  } catch {
    throw new InventoryError("That tag has a broken % escape. Use letters, digits, dashes, dots, or underscores.");
  }
}

export const apiError = (status: number, message: string) => json(status, { error: message });

/** Wrap an API route: check the key, check write access, and turn errors into clear JSON. */
export function apiRoute<P>(
  options: { write?: boolean },
  handler: (request: Request, context: ApiContext, params: P) => Promise<unknown>,
) {
  return async (request: Request, route: { params: Promise<P> }) => {
    const key = await authenticateApiKey(request.headers.get("authorization"));
    if (!key) return apiError(401, "Send a valid API key as: Authorization: Bearer ct_...");
    if (options.write && !key.canWrite) return apiError(403, "This API key is read-only. Create a key with write access to make changes.");
    if (!(await takeApiRequest(key.id)))
      return Response.json({ error: `Too many requests. Each API key may make ${API_REQUESTS_PER_MINUTE} requests a minute; wait a moment and try again.` }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "30" } });
    const actor: Actor = { userId: `api:${key.id}`, userName: `API key "${key.name}"`, orgId: key.orgId, facilityId: key.facilityId };
    try {
      return json(200, await handler(request, { key, actor }, await route.params));
    } catch (error) {
      if (error instanceof InventoryError) return apiError(422, error.message);
      if (error instanceof BadRequest) return apiError(400, error.message);
      console.error(error);
      return apiError(500, "Something went wrong on our side. Nothing was changed.");
    }
  };
}

/** Numbers stored as exact decimals are sent as strings so no precision is lost. */
export const num = (value: Decimal.Value | null) => (value === null ? null : new Decimal(value).toString());

export function pageParams(url: URL): { limit: number; offset: number } {
  // Whole numbers only; anything else falls back to the default instead of reaching the database.
  const whole = (name: string, fallback: number) => {
    const raw = url.searchParams.get(name);
    if (raw === null || !/^\d{1,9}$/.test(raw.trim())) return fallback;
    return Number(raw.trim());
  };
  return { limit: Math.min(Math.max(whole("limit", 100), 1), 500), offset: whole("offset", 0) };
}
