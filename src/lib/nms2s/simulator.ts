import { Decimal } from "decimal.js";
import { Nms2sError, type Nms2sErrorKind } from "./errors";
import type { CallContext, LookupResult, Nms2sTransport, Page, PageRequest, StatePackage, StatePlant, TransportCapabilities, WriteOperation, WriteResult } from "./types";

/**
 * UNOFFICIAL NMS2S SIMULATOR — FOR CANNATRACE TESTING ONLY.
 *
 * This is NOT New Mexico's NMS2S API and does not model its contract. It implements CannaTrace's
 * own transport interface in memory so CannaTrace's retry, idempotency, reconciliation, and isolation
 * logic can be exercised before the official specification and UAT credentials exist. Passing
 * against the simulator is not evidence of state compatibility.
 */
export const SIMULATOR_NOTICE = "Unofficial CannaTrace simulator. Not the New Mexico NMS2S API.";

export type Fault =
  | { kind: Exclude<Nms2sErrorKind, "UNKNOWN_OUTCOME">; retryAfterSeconds?: number }
  /** The write is applied, then the answer is lost, as with a timeout after the state saved it. */
  | { kind: "TIMEOUT_AFTER_APPLY" }
  /** The call hangs until the caller's signal aborts; nothing is applied. */
  | { kind: "TIMEOUT_BEFORE_APPLY" };

type Account = { licenses: Set<string>; canWrite: boolean };
type License = { packages: Map<string, StatePackage>; plants: Map<string, StatePlant> };

export type SimulatorOptions = {
  /** Whether the simulator honors idempotency keys. Both settings are tested, since the real API's behavior is unknown. */
  honorsIdempotencyKeys?: boolean;
  supportsLookup?: boolean;
  /** Milliseconds each call waits, to make concurrent calls interleave. */
  latencyMs?: number;
};

export class Nms2sSimulator implements Nms2sTransport {
  readonly kind = "SIMULATOR" as const;
  readonly label = SIMULATOR_NOTICE;
  private accounts = new Map<string, Account>();
  private licenses = new Map<string, License>();
  private faults: Fault[] = [];
  private applied = new Map<string, { op: string; stateReference: string }>();
  private seq = 0;
  readonly calls: { method: string; license: string; idempotencyKey?: string }[] = [];
  readonly writesApplied: { license: string; op: WriteOperation; idempotencyKey: string }[] = [];

  constructor(private options: SimulatorOptions = {}) {}

  capabilities(): TransportCapabilities {
    return {
      readPackages: "SUPPORTED",
      readPlants: "SUPPORTED",
      idempotencyKeys: this.options.honorsIdempotencyKeys === false ? "UNSUPPORTED" : "SUPPORTED",
      lookupByClientReference: this.options.supportsLookup === false ? "UNSUPPORTED" : "SUPPORTED",
      writes: { PACKAGE_ADJUST: "SUPPORTED", PACKAGE_SPLIT: "SUPPORTED" },
    };
  }

  // ---- scenario setup -------------------------------------------------------------------------

  addAccount(apiKey: string, licenses: string[], options: { canWrite?: boolean } = {}) {
    this.accounts.set(apiKey, { licenses: new Set(licenses), canWrite: options.canWrite !== false });
    for (const l of licenses) if (!this.licenses.has(l)) this.licenses.set(l, { packages: new Map(), plants: new Map() });
  }

  seedPackage(license: string, pkg: Omit<StatePackage, "stateId" | "licenseNumber"> & { stateId?: string }) {
    const stateId = pkg.stateId ?? this.nextId("SIM-PKG");
    this.license(license).packages.set(pkg.tag, { ...pkg, stateId, licenseNumber: license });
    return stateId;
  }

  seedPlant(license: string, plant: Omit<StatePlant, "stateId" | "licenseNumber"> & { stateId?: string }) {
    const stateId = plant.stateId ?? this.nextId("SIM-PLT");
    this.license(license).plants.set(plant.tag, { ...plant, stateId, licenseNumber: license });
    return stateId;
  }

  /** Queue faults; each call consumes the next one. */
  failNext(...faults: Fault[]) {
    this.faults.push(...faults);
  }

  package(license: string, tag: string): StatePackage | undefined {
    return this.licenses.get(license)?.packages.get(tag);
  }

  // ---- transport ------------------------------------------------------------------------------

  async listPackages(ctx: CallContext, page: PageRequest): Promise<Page<StatePackage>> {
    await this.enter(ctx, "listPackages");
    return paginate([...this.license(ctx.licenseNumber).packages.values()], page);
  }

  async listPlants(ctx: CallContext, page: PageRequest): Promise<Page<StatePlant>> {
    await this.enter(ctx, "listPlants");
    return paginate([...this.license(ctx.licenseNumber).plants.values()], page);
  }

  async submit(ctx: CallContext, op: WriteOperation, idempotencyKey: string): Promise<WriteResult> {
    const fault = await this.enter(ctx, "submit", idempotencyKey, true);
    const key = `${ctx.licenseNumber}:${idempotencyKey}`;
    const before = this.applied.get(key);
    if (before && this.options.honorsIdempotencyKeys !== false) return { outcome: "DUPLICATE", stateReference: before.stateReference, detail: "Already applied with this key." };
    const result = this.apply(ctx.licenseNumber, op);
    this.applied.set(key, { op: op.kind, stateReference: result.stateReference! });
    this.writesApplied.push({ license: ctx.licenseNumber, op, idempotencyKey });
    if (fault?.kind === "TIMEOUT_AFTER_APPLY") throw new Nms2sError("UNKNOWN_OUTCOME", "Simulated: applied, then the answer was lost.");
    return result;
  }

  async lookup(ctx: CallContext, _op: WriteOperation, idempotencyKey: string): Promise<LookupResult> {
    await this.enter(ctx, "lookup", idempotencyKey);
    if (this.options.supportsLookup === false) return { found: "UNKNOWN", detail: "Simulated API has no lookup." };
    const hit = this.applied.get(`${ctx.licenseNumber}:${idempotencyKey}`);
    return hit ? { found: "APPLIED", stateReference: hit.stateReference } : { found: "NOT_APPLIED" };
  }

  // ---- internals ------------------------------------------------------------------------------

  private async enter(ctx: CallContext, method: string, idempotencyKey?: string, write = false): Promise<Fault | undefined> {
    this.calls.push({ method, license: ctx.licenseNumber, idempotencyKey });
    if (this.options.latencyMs) await new Promise((r) => setTimeout(r, this.options.latencyMs));
    const fault = this.faults.shift();
    if (fault?.kind === "TIMEOUT_BEFORE_APPLY") {
      await new Promise<void>((resolve, reject) => {
        if (ctx.signal?.aborted) return reject(abortError());
        ctx.signal?.addEventListener("abort", () => reject(abortError()), { once: true });
        if (!ctx.signal) resolve();
      });
      throw new Nms2sError("UNKNOWN_OUTCOME", "Simulated timeout.");
    }
    if (fault && fault.kind !== "TIMEOUT_AFTER_APPLY") {
      throw new Nms2sError(fault.kind, `Simulated ${fault.kind.toLowerCase().replace(/_/g, " ")}.`, "retryAfterSeconds" in fault ? (fault.retryAfterSeconds ?? null) : null);
    }
    const account = this.accounts.get(ctx.credentials.apiKey ?? "");
    if (!account) throw new Nms2sError("AUTH_FAILED", "Simulated: unknown credentials.");
    if (!account.licenses.has(ctx.licenseNumber)) throw new Nms2sError("FORBIDDEN", "Simulated: these credentials don't cover this license.");
    if (write && !account.canWrite) throw new Nms2sError("FORBIDDEN", "Simulated: these credentials are read-only.");
    return fault;
  }

  private apply(license: string, op: WriteOperation): { outcome: "ACCEPTED"; stateReference: string; stateIds?: { entityType: "Package"; localTag: string; stateId: string }[] } {
    const lic = this.license(license);
    const stateReference = this.nextId("SIM-TXN");
    if (op.kind === "PACKAGE_ADJUST") {
      const pkg = lic.packages.get(op.packageTag);
      if (!pkg) throw new Nms2sError("NOT_FOUND", `Simulated: no package ${op.packageTag}.`);
      if (!/^-?\d+(\.\d+)?$/.test(op.quantityChange)) throw new Nms2sError("MALFORMED", "Simulated: quantity is not a number.");
      const next = new Decimal(pkg.quantity ?? 0).add(op.quantityChange);
      if (next.isNeg()) throw new Nms2sError("REJECTED", "Simulated: quantity would go below zero.");
      lic.packages.set(op.packageTag, { ...pkg, quantity: next.toString() });
      return { outcome: "ACCEPTED", stateReference };
    }
    const source = lic.packages.get(op.sourceTag);
    if (!source) throw new Nms2sError("NOT_FOUND", `Simulated: no package ${op.sourceTag}.`);
    if (lic.packages.has(op.newTag)) throw new Nms2sError("REJECTED", `Simulated: ${op.newTag} already exists.`);
    const left = new Decimal(source.quantity ?? 0).sub(op.quantity);
    if (left.isNeg()) throw new Nms2sError("REJECTED", "Simulated: not enough in the source package.");
    lic.packages.set(op.sourceTag, { ...source, quantity: left.toString() });
    const stateId = this.nextId("SIM-PKG");
    lic.packages.set(op.newTag, { stateId, tag: op.newTag, licenseNumber: license, quantity: new Decimal(op.quantity).toString(), unit: op.unit, status: "Active", itemName: source.itemName });
    return { outcome: "ACCEPTED", stateReference, stateIds: [{ entityType: "Package", localTag: op.newTag, stateId }] };
  }

  private license(l: string): License {
    let lic = this.licenses.get(l);
    if (!lic) this.licenses.set(l, (lic = { packages: new Map(), plants: new Map() }));
    return lic;
  }

  private nextId(prefix: string) {
    return `${prefix}-${String(++this.seq).padStart(6, "0")}`;
  }
}

function paginate<T extends { tag: string }>(all: T[], page: PageRequest): Page<T> {
  if (!Number.isInteger(page.pageSize) || page.pageSize < 1 || page.pageSize > 500) throw new Nms2sError("MALFORMED", "Simulated: page size must be 1 to 500.");
  const sorted = [...all].sort((a, b) => a.tag.localeCompare(b.tag));
  const decoded = page.cursor ? Buffer.from(page.cursor, "base64url").toString() : "0";
  const start = /^\d+$/.test(decoded) ? Number(decoded) : -1;
  if (start < 0) throw new Nms2sError("MALFORMED", "Simulated: bad cursor.");
  const records = sorted.slice(start, start + page.pageSize);
  const next = start + page.pageSize;
  return { records: records.map((r) => ({ ...r })), nextCursor: next < sorted.length ? Buffer.from(String(next)).toString("base64url") : null };
}

function abortError() {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}
