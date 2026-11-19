import Decimal from "decimal.js";
import { canConvert, convert, UNIT_CODES, type UnitCode } from "@/lib/units";
import type { StatePackage, StatePlant } from "./types";

/**
 * Compare CannaTrace's records with the state system's, treating NMS2S as the authority for records
 * in its jurisdiction. This is a pure function: it reports, it never changes either side. Every
 * finding says what a person should check; nothing is overwritten, created, or deleted here.
 */

export type LocalCategory = "OPEN" | "CLOSED";

/**
 * How raw state status strings map to CannaTrace's open/closed categories. Empty until the official
 * specification lists the state's status values; unmapped values are reported, never guessed.
 */
export type StatusMap = Readonly<Record<string, LocalCategory>>;
export const OFFICIAL_STATUS_MAP: StatusMap = {};

export type LocalRecord = {
  entityType: "Package" | "Plant";
  localId: string;
  tag: string;
  licenseNumber: string;
  quantity: string | null;
  unit: UnitCode | null;
  status: string;
};

export type PendingWrite = { localEntityType: string; localEntityId: string; tag: string | null; status: string; operation: string };
export type IdLink = { entityType: string; localId: string; stateId: string };

export type FindingKind =
  | "MATCH"
  | "MISSING_LOCAL"
  | "MISSING_STATE"
  | "QUANTITY_DIFFERENCE"
  | "STATUS_DIFFERENCE"
  | "FACILITY_MISMATCH"
  | "ID_MISMATCH"
  | "PENDING_OUTCOME"
  | "NOT_COMPARABLE";

export type ReconcileFinding = {
  kind: FindingKind;
  entityType: "Package" | "Plant";
  tag: string;
  localId: string | null;
  stateId: string | null;
  local: { quantity: string | null; unit: string | null; status: string; licenseNumber: string } | null;
  state: { quantity: string | null; unit: string | null; status: string | null; licenseNumber: string } | null;
  detail: string;
  /** What a person should do. Never performed automatically. */
  action: string;
};

export type ReconcileReport = {
  counts: Record<FindingKind, number>;
  findings: ReconcileFinding[];
  /** Tag matches with no confirmed id link yet. Suggestions only: a person confirms them. */
  proposedLinks: { entityType: "Package" | "Plant"; localId: string; stateId: string; tag: string }[];
};

const LOCAL_OPEN: Record<"Package" | "Plant", string[]> = {
  Package: ["ACTIVE", "ALLOCATED", "ON_HOLD", "QUARANTINE"],
  Plant: ["ACTIVE"],
};
const PENDING = new Set(["PREPARED", "IN_FLIGHT", "RETRYABLE", "UNKNOWN_OUTCOME"]);
const TOLERANCE = new Decimal("0.0001");

export function reconcile(input: {
  licenseNumber: string;
  local: LocalRecord[];
  statePackages: StatePackage[];
  statePlants: StatePlant[];
  pending: PendingWrite[];
  links: IdLink[];
  statusMap?: StatusMap;
}): ReconcileReport {
  const statusMap = normalizeMap(input.statusMap ?? OFFICIAL_STATUS_MAP);
  const findings: ReconcileFinding[] = [];
  const proposedLinks: ReconcileReport["proposedLinks"] = [];
  const pendingByTag = new Map<string, PendingWrite[]>();
  const pendingById = new Set<string>();
  for (const p of input.pending)
    if (PENDING.has(p.status)) {
      pendingById.add(`${p.localEntityType}:${p.localEntityId}`);
      if (p.tag) pendingByTag.set(p.tag.toUpperCase(), [...(pendingByTag.get(p.tag.toUpperCase()) ?? []), p]);
    }
  const linkByLocal = new Map(input.links.map((l) => [`${l.entityType}:${l.localId}`, l.stateId]));

  const state = new Map<string, { entityType: "Package" | "Plant"; rec: StatePackage | StatePlant }>();
  for (const p of input.statePackages) state.set(`Package:${p.tag.toUpperCase()}`, { entityType: "Package", rec: p });
  for (const p of input.statePlants) state.set(`Plant:${p.tag.toUpperCase()}`, { entityType: "Plant", rec: p });
  const seen = new Set<string>();

  for (const l of input.local) {
    const key = `${l.entityType}:${l.tag.toUpperCase()}`;
    seen.add(key);
    const s = state.get(key)?.rec;
    const localOpen = LOCAL_OPEN[l.entityType].includes(l.status);
    const base = {
      entityType: l.entityType,
      tag: l.tag,
      localId: l.localId,
      stateId: s?.stateId ?? null,
      local: { quantity: l.quantity, unit: l.unit, status: l.status, licenseNumber: l.licenseNumber },
      state: s ? { quantity: "quantity" in s ? s.quantity : null, unit: "unit" in s ? s.unit : null, status: s.status, licenseNumber: s.licenseNumber } : null,
    };
    const pending = pendingById.has(`${l.entityType}:${l.localId}`) || pendingByTag.has(l.tag.toUpperCase());
    if (pending) {
      findings.push({ ...base, kind: "PENDING_OUTCOME", detail: "A report to the state for this record has no confirmed outcome yet, so a difference here may not be real.", action: "Resolve the pending report (look it up or confirm by hand), then compare again." });
      continue;
    }
    if (!s) {
      if (localOpen) findings.push({ ...base, kind: "MISSING_STATE", detail: "Open in CannaTrace but not found in the state system for this license.", action: "Check whether it was ever reported. Do not create it in the state from here; report it through the documented workflow." });
      continue;
    }
    if (s.licenseNumber !== input.licenseNumber || l.licenseNumber !== input.licenseNumber) {
      findings.push({ ...base, kind: "FACILITY_MISMATCH", detail: `The state lists it under license ${s.licenseNumber}; CannaTrace has it at ${l.licenseNumber}.`, action: "Confirm which facility holds it. A transfer may be missing on one side." });
      continue;
    }
    const linked = linkByLocal.get(`${l.entityType}:${l.localId}`);
    if (linked && linked !== s.stateId) {
      findings.push({ ...base, kind: "ID_MISMATCH", detail: `CannaTrace linked this record to state id ${linked}, but the state's record with this tag has id ${s.stateId}.`, action: "Check whether the tag was reused or re-issued before changing the link." });
      continue;
    }
    if (!linked) proposedLinks.push({ entityType: l.entityType, localId: l.localId, stateId: s.stateId, tag: l.tag });

    const category = s.status === null ? undefined : statusMap.get(s.status.trim().toLowerCase());
    if (s.status !== null && !category) {
      findings.push({ ...base, kind: "NOT_COMPARABLE", detail: `The state status "${s.status}" isn't mapped yet.`, action: "Add it to the status map from the official specification." });
      continue;
    }
    const stateOpen = category === "OPEN";
    if (category && stateOpen !== localOpen) {
      findings.push({ ...base, kind: "STATUS_DIFFERENCE", detail: `${localOpen ? "Open" : "Closed"} in CannaTrace (${l.status.toLowerCase()}) but ${stateOpen ? "open" : "closed"} in the state (${s.status}).`, action: "The state record is authoritative. Find the missing step and record it on the side that lacks it." });
      continue;
    }
    if (l.entityType === "Package" && localOpen) {
      const q = compareQuantity(l, s as StatePackage);
      if (q === "NOT_COMPARABLE") {
        findings.push({ ...base, kind: "NOT_COMPARABLE", detail: "The quantities use units that can't be compared.", action: "Check the unit mapping for this item." });
        continue;
      }
      if (q) {
        findings.push({ ...base, kind: "QUANTITY_DIFFERENCE", detail: `CannaTrace has ${l.quantity} ${l.unit}; the state has ${q.state} ${l.unit} (difference ${q.diff}).`, action: "Recount. If the state is right, record an adjustment in CannaTrace with a reason; if CannaTrace is right, correct it in the state through the documented workflow." });
        continue;
      }
    }
    findings.push({ ...base, kind: "MATCH", detail: "Matches.", action: "None." });
  }

  for (const [key, { entityType, rec }] of state) {
    if (seen.has(key)) continue;
    const category = rec.status === null ? undefined : statusMap.get(rec.status.trim().toLowerCase());
    if (category === "CLOSED") continue;
    const pending = pendingByTag.has(rec.tag.toUpperCase());
    findings.push({
      kind: pending ? "PENDING_OUTCOME" : rec.licenseNumber !== input.licenseNumber ? "FACILITY_MISMATCH" : "MISSING_LOCAL",
      entityType,
      tag: rec.tag,
      localId: null,
      stateId: rec.stateId,
      local: null,
      state: { quantity: "quantity" in rec ? rec.quantity : null, unit: "unit" in rec ? rec.unit : null, status: rec.status, licenseNumber: rec.licenseNumber },
      detail: pending ? "A pending report may account for this record." : `In the state system${category ? "" : " (status not mapped)"} but not in CannaTrace.`,
      action: pending ? "Resolve the pending report first." : "Receive or import it in CannaTrace if it is really here. CannaTrace does not create it automatically.",
    });
  }

  const counts = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<FindingKind, number>;
  for (const f of findings) counts[f.kind]++;
  return { counts, findings, proposedLinks };
}

export const KINDS: FindingKind[] = ["MATCH", "MISSING_LOCAL", "MISSING_STATE", "QUANTITY_DIFFERENCE", "STATUS_DIFFERENCE", "FACILITY_MISMATCH", "ID_MISMATCH", "PENDING_OUTCOME", "NOT_COMPARABLE"];

function normalizeMap(map: StatusMap) {
  return new Map(Object.entries(map).map(([k, v]) => [k.trim().toLowerCase(), v]));
}

function compareQuantity(l: LocalRecord, s: StatePackage): { state: string; diff: string } | null | "NOT_COMPARABLE" {
  if (l.quantity === null || l.unit === null || s.quantity === null) return "NOT_COMPARABLE";
  const su = (s.unit ?? "").toUpperCase() as UnitCode;
  if (!UNIT_CODES.includes(su) || !canConvert(su, l.unit)) return "NOT_COMPARABLE";
  let theirs: Decimal;
  try {
    theirs = convert(s.quantity, su, l.unit).toDecimalPlaces(4);
  } catch {
    return "NOT_COMPARABLE";
  }
  const diff = theirs.sub(l.quantity);
  return diff.abs().lte(TOLERANCE) ? null : { state: theirs.toString(), diff: diff.toString() };
}
