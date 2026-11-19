import type { Nms2sEnvironment, TransportKind } from "./types";
import { Nms2sError } from "./errors";

/**
 * Server configuration for NMS2S. Every value comes from the environment and every default is "off".
 *
 *   NMS2S_ENVIRONMENT          UAT or PRODUCTION. Unset means the integration is disabled.
 *   NMS2S_UAT_BASE_URL         Base URL for UAT, as issued by CCD/RTS. No default: never guessed.
 *   NMS2S_PRODUCTION_BASE_URL  Base URL for production, as issued by CCD/RTS. No default.
 *   NMS2S_TRAFFIC_ENABLED      Must be "1" before any request goes to the official API.
 *   NMS2S_PRODUCTION_APPROVED  Must equal PRODUCTION_APPROVAL_PHRASE before production traffic or credentials.
 *   NMS2S_TIMEOUT_MS           Per-request time limit (default 15000).
 *
 * OFFICIAL_SPEC is set in code, not by environment, when the official specification has been
 * implemented and UAT has passed. While it is null the official transport refuses every call.
 */

export const OFFICIAL_SPEC: { version: string; receivedOn: string } | null = null;

export const PRODUCTION_APPROVAL_PHRASE = "CCD-APPROVED-PRODUCTION";

export type Nms2sConfig = {
  environment: Nms2sEnvironment | null;
  baseUrl: string | null;
  trafficEnabled: boolean;
  productionApproved: boolean;
  timeoutMs: number;
};

export function readConfig(env: Record<string, string | undefined> = process.env): Nms2sConfig {
  const raw = (env.NMS2S_ENVIRONMENT ?? "").trim().toUpperCase();
  const environment = raw === "UAT" || raw === "PRODUCTION" ? raw : null;
  const url = environment === "UAT" ? env.NMS2S_UAT_BASE_URL : environment === "PRODUCTION" ? env.NMS2S_PRODUCTION_BASE_URL : undefined;
  const timeout = Number(env.NMS2S_TIMEOUT_MS);
  return {
    environment,
    baseUrl: url?.trim() || null,
    trafficEnabled: env.NMS2S_TRAFFIC_ENABLED === "1",
    productionApproved: env.NMS2S_PRODUCTION_APPROVED === PRODUCTION_APPROVAL_PHRASE,
    timeoutMs: Number.isFinite(timeout) && timeout >= 1000 && timeout <= 120_000 ? timeout : 15_000,
  };
}

/**
 * The one gate every call passes. The simulator may run only outside production; the official API
 * needs a received specification, traffic switched on, a configured URL, and for production an
 * explicit approval.
 */
export function assertCallAllowed(config: Nms2sConfig, environment: Nms2sEnvironment, kind: TransportKind): void {
  if (kind === "SIMULATOR") {
    if (environment === "PRODUCTION" || config.environment === "PRODUCTION")
      throw new Nms2sError("TRAFFIC_DISABLED", "The unofficial simulator can't be used for production.");
    return;
  }
  if (!OFFICIAL_SPEC) throw new Nms2sError("SPEC_PENDING", "The official NMS2S API specification has not been received.");
  if (!config.environment) throw new Nms2sError("NOT_CONFIGURED", "NMS2S_ENVIRONMENT is not set.");
  if (config.environment !== environment) throw new Nms2sError("NOT_CONFIGURED", `This server is configured for ${config.environment}, not ${environment}.`);
  if (!config.trafficEnabled) throw new Nms2sError("TRAFFIC_DISABLED", "NMS2S_TRAFFIC_ENABLED is not 1.");
  if (!config.baseUrl) throw new Nms2sError("NOT_CONFIGURED", `No base URL is configured for ${environment}.`);
  if (environment === "PRODUCTION" && !config.productionApproved) throw new Nms2sError("TRAFFIC_DISABLED", "Production NMS2S traffic has not been approved on this server.");
}
