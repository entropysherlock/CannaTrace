import Decimal from "decimal.js";

export type SystemName = "MOCK" | "METRC" | "BIOTRACK" | "NMS2S";

export const SYSTEM_LABELS: Record<SystemName, string> = {
  MOCK: "Practice mode (nothing is sent)",
  METRC: "Metrc",
  BIOTRACK: "BioTrack",
  NMS2S: "NMS2S (New Mexico)",
};

/** Which saved changes the state needs to hear about, keyed by "<record>:<action>" from the audit trail. */
const EVENT_TYPES: Record<string, string> = {
  "Package:RECEIVE": "PACKAGE_RECEIVED",
  "Package:ADJUST": "PACKAGE_ADJUSTED",
  "Package:MOVE": "PACKAGE_MOVED",
  "Package:CREATED_BY_SPLIT": "PACKAGE_CREATED_FROM_PACKAGES",
  "Package:CREATED_BY_MERGE": "PACKAGE_CREATED_FROM_PACKAGES",
  "Package:CREATED_BY_PRODUCTION": "PACKAGE_CREATED_FROM_PACKAGES",
  "Package:CREATED_FROM_HARVEST": "PACKAGE_CREATED_FROM_HARVEST",
  "Package:DESTROY": "PACKAGE_DESTROYED",
  "Package:LAB_RESULT": "LAB_RESULT_RECORDED",
  "PlantBatch:CREATE": "PLANT_BATCH_CREATED",
  "PlantBatch:TAG_PLANTS": "PLANTS_TAGGED",
  "PlantBatch:DESTROY_PLANTS": "PLANT_BATCH_PLANTS_DESTROYED",
  "Plant:PHASE_CHANGE": "PLANT_PHASE_CHANGED",
  "Plant:MOVE": "PLANT_MOVED",
  "Plant:DESTROY": "PLANT_DESTROYED",
  "Harvest:CREATE": "HARVEST_CREATED",
  "Harvest:WASTE": "HARVEST_WASTE_RECORDED",
  "Harvest:FINISH": "HARVEST_FINISHED",
  "Order:SHIP": "TRANSFER_SHIPPED",
  "Order:DELIVER": "TRANSFER_DELIVERED",
  "Sale:COMPLETE": "RETAIL_SALE",
  "Sale:VOID": "RETAIL_SALE_VOIDED",
};

export function eventTypeFor(entityType: string, action: string): string | null {
  return EVENT_TYPES[`${entityType}:${action}`] ?? null;
}

type Json = Record<string, unknown> | null | undefined;
const str = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const amount = (value: unknown) => {
  try {
    return new Decimal(str(value)).toString();
  } catch {
    return str(value);
  }
};
const plants = (count: unknown, word = "plant") => `${str(count)} ${word}${str(count) === "1" ? "" : "s"}`;
const unit = (value: unknown) => str(value).toLowerCase().replace("each", "ea");

/** One plain sentence saying what happened, for the sync status page. */
export function describeEvent(type: string, before: Json, after: Json): string {
  const b = before ?? {};
  const a = after ?? {};
  const tag = str(a.tag ?? b.tag);
  switch (type) {
    case "PACKAGE_RECEIVED":
      return `Received package ${tag}: ${amount(a.quantity)} ${unit(a.unit)}`;
    case "PACKAGE_ADJUSTED":
      return `Adjusted package ${tag} from ${amount(b.quantity)} to ${amount(a.quantity)} ${unit(a.unit)}`;
    case "PACKAGE_MOVED":
      return `Moved package ${tag} to a new location`;
    case "PACKAGE_CREATED_FROM_PACKAGES":
      return `Created package ${tag} (${amount(a.quantity)} ${unit(a.unit)}) from ${Array.isArray(a.from) ? a.from.join(", ") : str(a.from ?? a.run) || "other packages"}`;
    case "PACKAGE_CREATED_FROM_HARVEST":
      return `Packaged ${amount(a.quantity)} ${unit(a.unit)} as ${tag} from harvest ${str(a.harvest)}`;
    case "PACKAGE_DESTROYED":
      return `Destroyed package ${tag} (${amount(b.quantity)} ${unit(b.unit)})`;
    case "LAB_RESULT_RECORDED":
      return `Recorded a ${str(a.status).toLowerCase()} lab result from ${str(a.labName)}`;
    case "PLANT_BATCH_CREATED":
      return `Started plant batch ${str(a.name)} with ${str(a.count)} ${str(a.source).toLowerCase()}s`;
    case "PLANTS_TAGGED":
      return `Tagged ${plants(a.tagged)} (${str(a.firstTag)} to ${str(a.lastTag)})`;
    case "PLANT_BATCH_PLANTS_DESTROYED":
      return `Destroyed ${plants(a.destroyed, "untagged plant")} from a batch`;
    case "PLANT_PHASE_CHANGED":
      return `Plant ${tag} changed to ${str(a.phase).toLowerCase()}`;
    case "PLANT_MOVED":
      return `Plant ${tag} moved to a new room`;
    case "PLANT_DESTROYED":
      return `Destroyed plant ${tag}`;
    case "HARVEST_CREATED":
      return `Harvested ${plants(a.plantCount)} as ${str(a.name)}: ${amount(a.wetWeightGrams)} g wet`;
    case "HARVEST_WASTE_RECORDED":
      return `Logged ${amount(a.wasteGrams)} g of harvest waste`;
    case "HARVEST_FINISHED":
      return `Finished a harvest: ${amount(a.packagedGrams)} g packaged, ${amount(a.wasteGrams)} g waste`;
    case "TRANSFER_SHIPPED":
      return `Shipped ${str(a.packages)} package${str(a.packages) === "1" ? "" : "s"} on manifest ${str(a.manifestNumber)}`;
    case "TRANSFER_DELIVERED":
      return `Delivery received by ${str(a.receivedBy)}`;
    case "RETAIL_SALE":
      return `Retail sale ${str(a.number)} for $${str(a.total)}`;
    case "RETAIL_SALE_VOIDED":
      return `Voided retail sale ${str(a.number)}`;
    default:
      return type.replaceAll("_", " ").toLowerCase();
  }
}

export type ErrorCode =
  | "NOT_CONFIGURED"
  | "AUTH_FAILED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "REJECTED"
  | "DUPLICATE"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "NETWORK"
  | "UNKNOWN";

export type SendResult =
  | { outcome: "SENT"; externalId?: string }
  | { outcome: "MANUAL"; detail: string }
  | { outcome: "ERROR"; code: ErrorCode; retryable: boolean; detail: string };

/** Turn an HTTP status from a state system into one of our error kinds. */
export function classifyHttpStatus(status: number): { code: ErrorCode; retryable: boolean } {
  if (status === 401) return { code: "AUTH_FAILED", retryable: false };
  if (status === 403) return { code: "FORBIDDEN", retryable: false };
  if (status === 404) return { code: "NOT_FOUND", retryable: false };
  if (status === 409) return { code: "DUPLICATE", retryable: false };
  if (status === 429) return { code: "RATE_LIMITED", retryable: true };
  if (status === 400 || status === 422) return { code: "REJECTED", retryable: false };
  if (status >= 500) return { code: "SERVER_ERROR", retryable: true };
  return { code: "UNKNOWN", retryable: false };
}

/** Minutes to wait before each automatic retry. After the last one a person has to step in. */
export const RETRY_MINUTES = [1, 5, 30, 120, 720];
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;

/** When to try again after a failed attempt, or null when automatic retries are used up. */
export function nextRetryAt(attemptsSoFar: number, now: Date): Date | null {
  const minutes = RETRY_MINUTES[attemptsSoFar - 1];
  return minutes === undefined ? null : new Date(now.getTime() + minutes * 60_000);
}

export type Explanation = { title: string; meaning: string; fix: string };

/** What went wrong and what to do about it, in plain English. */
export function explainError(code: string | null, system: SystemName): Explanation {
  const name = SYSTEM_LABELS[system] ?? system;
  switch (code as ErrorCode) {
    case "NOT_CONFIGURED":
      return {
        title: `${name} is not connected yet`,
        meaning: `This facility is set to report to ${name}, but the keys CannaTrace needs to sign in have not been added.`,
        fix: "Ask whoever manages your hosting to add the keys listed in the README, then press Retry. Nothing has been lost; the record is waiting here.",
      };
    case "AUTH_FAILED":
      return {
        title: `${name} did not accept the sign-in`,
        meaning: "The API key or password CannaTrace has on file was refused. Keys are often replaced when an employee leaves or a password changes.",
        fix: `Create a new API key in ${name}, update it in your hosting settings, then press Retry.`,
      };
    case "FORBIDDEN":
      return {
        title: `${name} says this account is not allowed to do that`,
        meaning: "The sign-in worked, but the user the key belongs to does not have permission for this kind of record at this license.",
        fix: `In ${name}, give that user permission for this action at this facility, then press Retry.`,
      };
    case "NOT_FOUND":
      return {
        title: `${name} could not find the record this refers to`,
        meaning: "Usually the package or plant tag does not exist in the state system, often because an earlier record never arrived or the tag was typed differently there.",
        fix: `Look the tag up in ${name}. If it is missing, enter the earlier step by hand first, then press Retry.`,
      };
    case "REJECTED":
      return {
        title: `${name} rejected this record`,
        meaning: "The state system read the record and refused it. The exact reason it gave is shown below.",
        fix: "Fix what the message describes (often a quantity, date, or name that does not match the state's records), then press Retry. If it cannot be fixed here, enter it in the state system by hand and mark it handled.",
      };
    case "DUPLICATE":
      return {
        title: `${name} already has this record`,
        meaning: "The state system says this was already reported, most likely because it was entered there by hand or an earlier attempt went through.",
        fix: `Check ${name}. If the record is there and correct, mark this as handled.`,
      };
    case "RATE_LIMITED":
      return {
        title: `${name} asked CannaTrace to slow down`,
        meaning: "Too many records were sent in a short time. This is temporary.",
        fix: "Nothing to do. CannaTrace will try again on its own.",
      };
    case "SERVER_ERROR":
      return {
        title: `${name} is having problems`,
        meaning: "The state system returned an error on its side. Your record is fine.",
        fix: "Nothing to do yet. CannaTrace will try again on its own. If this lasts more than a few hours, check the state system's status page.",
      };
    case "NETWORK":
      return {
        title: `Could not reach ${name}`,
        meaning: "The connection timed out or dropped before the state system answered.",
        fix: "Nothing to do yet. CannaTrace will try again on its own.",
      };
    default:
      return {
        title: "Something unexpected went wrong",
        meaning: "CannaTrace got a response it does not recognise. The details are shown below.",
        fix: "Press Retry once. If it fails again, enter the record in the state system by hand and mark it handled.",
      };
  }
}
