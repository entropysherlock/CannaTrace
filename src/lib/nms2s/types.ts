/**
 * CannaTrace's internal view of the NMS2S integration.
 *
 * IMPORTANT: these are CannaTrace's own domain types, not the state's API contract. New Mexico's
 * official NMS2S API specification has not been received. When it arrives, an official transport
 * translates between these types and the documented requests and responses. Nothing here names a
 * state endpoint, header, field, or status value, and no state identifier format is assumed: state
 * identifiers are opaque strings.
 */

export type Nms2sEnvironment = "UAT" | "PRODUCTION";

/** Which implementation is answering. OFFICIAL is the real state API; SIMULATOR is CannaTrace's unofficial stand-in. */
export type TransportKind = "OFFICIAL" | "SIMULATOR";

/** What the transport is known to support. "UNKNOWN" until the official specification says otherwise. */
export type Support = "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN";

export type TransportCapabilities = {
  readPackages: Support;
  readPlants: Support;
  /** Whether the API honors a client-supplied idempotency key so a resent write is not applied twice. */
  idempotencyKeys: Support;
  /** Whether a write's outcome can be looked up afterwards by the client reference. */
  lookupByClientReference: Support;
  writes: Partial<Record<WriteOperationKind, Support>>;
};

/** Everything a transport needs to make a call for one facility. Credentials are opaque to everything but the transport. */
export type CallContext = {
  environment: Nms2sEnvironment;
  /** CannaTrace's facility id (for logging and isolation) and the facility's state license number. */
  facilityId: string;
  licenseNumber: string;
  credentials: Readonly<Record<string, string>>;
  signal?: AbortSignal;
};

export type PageRequest = { cursor?: string | null; pageSize: number };
export type Page<T> = { records: T[]; nextCursor: string | null };

/** A package as the state reports it, normalized by the transport into CannaTrace's terms. */
export type StatePackage = {
  stateId: string;
  tag: string;
  licenseNumber: string;
  quantity: string | null;
  /** CannaTrace unit code (G, EACH, ...) when the transport could map it, otherwise the state's raw unit. */
  unit: string | null;
  /** Raw state status string. Mapped to an internal category by StatusMap during reconciliation. */
  status: string | null;
  itemName?: string | null;
};

export type StatePlant = {
  stateId: string;
  tag: string;
  licenseNumber: string;
  status: string | null;
  phase?: string | null;
};

/**
 * Writes CannaTrace may need to report. These are CannaTrace workflow intents, not state endpoints;
 * each official mapping must be confirmed against the specification before it is enabled.
 */
export type WriteOperationKind = "PACKAGE_ADJUST" | "PACKAGE_SPLIT";

export type PackageAdjust = {
  kind: "PACKAGE_ADJUST";
  packageTag: string;
  /** Signed change, as a decimal string in `unit`. */
  quantityChange: string;
  newQuantity: string;
  unit: string;
  /** CannaTrace's adjustment reason (its label). Mapping to the state's reason list comes from the specification. */
  reason: string;
  note: string | null;
  occurredAt: string;
};

export type PackageSplit = {
  kind: "PACKAGE_SPLIT";
  sourceTag: string;
  newTag: string;
  quantity: string;
  unit: string;
  note: string | null;
  occurredAt: string;
};

export type WriteOperation = PackageAdjust | PackageSplit;

export type WriteResult =
  | { outcome: "ACCEPTED"; stateReference: string | null; stateIds?: { entityType: "Package" | "Plant"; localTag: string; stateId: string }[] }
  | { outcome: "DUPLICATE"; stateReference: string | null; detail: string };

export type LookupResult = { found: "APPLIED"; stateReference: string | null } | { found: "NOT_APPLIED" } | { found: "UNKNOWN"; detail: string };

/**
 * The single seam between CannaTrace and a state system. The official implementation is written
 * from the specification; the simulator implements the same interface for local testing.
 */
export interface Nms2sTransport {
  readonly kind: TransportKind;
  /** Human-readable name that makes clear which system answered. */
  readonly label: string;
  capabilities(): TransportCapabilities;
  listPackages(ctx: CallContext, page: PageRequest): Promise<Page<StatePackage>>;
  listPlants(ctx: CallContext, page: PageRequest): Promise<Page<StatePlant>>;
  submit(ctx: CallContext, op: WriteOperation, idempotencyKey: string): Promise<WriteResult>;
  lookup(ctx: CallContext, op: WriteOperation, idempotencyKey: string): Promise<LookupResult>;
}
