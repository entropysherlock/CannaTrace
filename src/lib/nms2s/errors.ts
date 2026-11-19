/**
 * Error kinds for NMS2S calls and what CannaTrace may safely do next.
 *
 * The rule that matters: a write may only be sent again automatically when CannaTrace knows the
 * state did NOT apply it. Anything that might have reached the state and been applied (a timeout,
 * a dropped connection after sending, a server error) becomes UNKNOWN_OUTCOME and must be resolved
 * by lookup or reconciliation before anything else is sent for that record.
 *
 * Which HTTP statuses or error bodies map to each kind is NOT defined here: that comes from the
 * official specification. The official transport throws Nms2sError with the right kind.
 */

export type Nms2sErrorKind =
  | "NOT_CONFIGURED"
  | "TRAFFIC_DISABLED"
  | "SPEC_PENDING"
  | "AUTH_FAILED"
  | "FORBIDDEN"
  | "MALFORMED"
  | "REJECTED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  /** The request never left CannaTrace (DNS failure, connection refused before sending). */
  | "NETWORK_BEFORE_SEND"
  /** The request may have reached the state and been applied, but no answer came back. */
  | "UNKNOWN_OUTCOME";

export type Retry = "NEVER" | "AFTER_FIX" | "AUTOMATIC" | "RECONCILE_FIRST";

export class Nms2sError extends Error {
  constructor(
    public kind: Nms2sErrorKind,
    message: string,
    public retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "Nms2sError";
  }
}

/** For reads, which never change state data, anything temporary can be retried. */
export function readRetry(kind: Nms2sErrorKind): Retry {
  if (["RATE_LIMITED", "SERVER_ERROR", "NETWORK_BEFORE_SEND", "UNKNOWN_OUTCOME"].includes(kind)) return "AUTOMATIC";
  if (["AUTH_FAILED", "FORBIDDEN", "NOT_CONFIGURED", "TRAFFIC_DISABLED", "SPEC_PENDING"].includes(kind)) return "AFTER_FIX";
  return "NEVER";
}

/**
 * For writes. SERVER_ERROR is treated as possibly applied until the specification states that the
 * API guarantees a 5xx was not applied. RATE_LIMITED is retried only if the specification confirms a
 * throttled write is never applied; until then it is also treated as unknown (see questions for CCD/RTS).
 */
export function writeRetry(kind: Nms2sErrorKind, confirmedNotApplied: ReadonlySet<Nms2sErrorKind> = DEFAULT_NOT_APPLIED): Retry {
  if (kind === "UNKNOWN_OUTCOME" || kind === "SERVER_ERROR") return "RECONCILE_FIRST";
  if (kind === "RATE_LIMITED") return confirmedNotApplied.has("RATE_LIMITED") ? "AUTOMATIC" : "RECONCILE_FIRST";
  if (kind === "NETWORK_BEFORE_SEND") return "AUTOMATIC";
  if (["AUTH_FAILED", "FORBIDDEN", "NOT_CONFIGURED", "TRAFFIC_DISABLED", "SPEC_PENDING"].includes(kind)) return "AFTER_FIX";
  return "NEVER";
}

/** Error kinds known never to be applied by the state. Extend only from the official specification. */
export const DEFAULT_NOT_APPLIED: ReadonlySet<Nms2sErrorKind> = new Set(["NETWORK_BEFORE_SEND", "AUTH_FAILED", "FORBIDDEN", "NOT_CONFIGURED", "TRAFFIC_DISABLED", "SPEC_PENDING"]);

/** Anything thrown by a transport that isn't an Nms2sError: an aborted or timed-out call is an unknown outcome. */
export function toNms2sError(error: unknown): Nms2sError {
  if (error instanceof Nms2sError) return error;
  const name = (error as { name?: string })?.name;
  if (name === "AbortError" || name === "TimeoutError") return new Nms2sError("UNKNOWN_OUTCOME", "No answer before the time limit; the state may have applied it.");
  return new Nms2sError("UNKNOWN_OUTCOME", error instanceof Error ? error.message : String(error));
}

export function explainNms2sError(kind: Nms2sErrorKind): string {
  const text: Record<Nms2sErrorKind, string> = {
    NOT_CONFIGURED: "NMS2S isn't set up for this facility and environment.",
    TRAFFIC_DISABLED: "Sending to NMS2S is switched off on this server.",
    SPEC_PENDING: "The official NMS2S connection is not built yet: CannaTrace is waiting for the state's API specification.",
    AUTH_FAILED: "NMS2S didn't accept the saved credentials.",
    FORBIDDEN: "These credentials aren't allowed to do that for this license.",
    MALFORMED: "NMS2S couldn't read the request. This is a CannaTrace problem; it has been logged.",
    REJECTED: "NMS2S refused the record. Correct it and report it again.",
    NOT_FOUND: "NMS2S has no record with that identifier.",
    RATE_LIMITED: "NMS2S asked CannaTrace to slow down.",
    SERVER_ERROR: "NMS2S had a problem. It may or may not have saved the record; CannaTrace will check before sending again.",
    NETWORK_BEFORE_SEND: "CannaTrace couldn't reach NMS2S. Nothing was sent.",
    UNKNOWN_OUTCOME: "The answer from NMS2S never arrived. The state may have saved the record; CannaTrace will check before sending again.",
  };
  return text[kind];
}
