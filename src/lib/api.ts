import Decimal from "decimal.js";
import type { ApiKey } from "@/db/schema";
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

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

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
