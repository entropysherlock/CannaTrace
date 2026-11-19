/** Plain-English wording for audit entries, so the trail reads as sentences rather than codes. */

const ACTIONS: Record<string, string> = {
  RECEIVE: "received",
  RECEIVE_SHIPMENT: "received from a shipment",
  MOVE: "moved",
  ADJUST: "adjusted",
  SPLIT: "split",
  CREATED_BY_SPLIT: "created by splitting",
  MERGE: "merged",
  CREATED_BY_MERGE: "created by merging",
  STATUS_CHANGE: "changed the status of",
  LAB_RESULT: "recorded a lab result for",
  DESTROY: "destroyed",
  PHASE_CHANGE: "changed the growth phase of",
  KEY_CONNECTED: "connected an AI key for",
  LIMITS_CHANGED: "changed the limits of",
  STATE_SYSTEM_CHANGE: "changed the state system of",
  MARK_HANDLED: "marked handled",
  TAKE_OVER: "took over",
  "FACILITY.ADDED": "added",
  "FACILITY.HIDDEN": "hid",
  "FACILITY.SHOWN": "showed",
  "FACILITY.UPDATED": "updated",
  IMPORT: "imported",
  CREATE: "created",
  REVOKE: "revoked",
  TURN_ON: "turned on",
  TURN_OFF: "turned off",
};

const ENTITIES: Record<string, string> = {
  TALLYAI: "Tally AI",
  STATERECORD: "state record",
  APIKEY: "API key",
  PLANTBATCH: "plant batch",
  IDLINK: "id link",
};

export function actionLabel(action: string): string {
  const key = action.toUpperCase();
  return ACTIONS[key] ?? key.toLowerCase().replace(/[._]+/g, " ");
}

export function entityLabel(entityType: string): string {
  const key = entityType.replace(/[^a-z]/gi, "").toUpperCase();
  return ENTITIES[key] ?? entityType.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[._]+/g, " ").toLowerCase();
}

/** The name a person recognizes a record by (tag, number, or name) from the entry's own snapshot. */
export function recordName(before: unknown, after: unknown): string | null {
  for (const snap of [after, before]) {
    if (!snap || typeof snap !== "object") continue;
    const s = snap as Record<string, unknown>;
    for (const k of ["tag", "number", "name", "manifestNumber", "prefix", "url", "email"]) {
      if (typeof s[k] === "string" && s[k]) return String(s[k]).slice(0, 80);
    }
  }
  return null;
}

/** Where to open the record, for the kinds that have their own page. */
export function recordHref(entityType: string, entityId: string): string | null {
  switch (entityType) {
    case "Package":
      return `/inventory/${entityId}`;
    case "Harvest":
      return `/cultivation/harvests/${entityId}`;
    case "PlantBatch":
      return `/cultivation/batches/${entityId}`;
    case "Order":
      return `/distribution/orders/${entityId}`;
    case "Sale":
      return `/pos/sales/${entityId}/receipt`;
    default:
      return null;
  }
}

/** What changed: each field whose value differs between before and after, as short text. */
export function changedFields(before: unknown, after: unknown): { field: string; from: string; to: string }[] {
  const b = before && typeof before === "object" ? (before as Record<string, unknown>) : {};
  const a = after && typeof after === "object" ? (after as Record<string, unknown>) : {};
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v).slice(0, 120) : String(v).slice(0, 120));
  const out: { field: string; from: string; to: string }[] = [];
  for (const field of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (/id$/i.test(field) && field !== "id") continue;
    const from = show(b[field]);
    const to = show(a[field]);
    if (from !== to) out.push({ field: field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase(), from, to });
  }
  return out.slice(0, 12);
}
