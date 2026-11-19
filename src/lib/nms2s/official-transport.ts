import { OFFICIAL_SPEC } from "./config";
import { Nms2sError } from "./errors";
import type { Nms2sTransport, TransportCapabilities } from "./types";

/**
 * The official New Mexico NMS2S transport: deliberately empty.
 *
 * The state's API specification (endpoints, authentication, request and response schemas, error
 * format, pagination, rate limits, idempotency guarantees) has not been received. Every method
 * refuses with SPEC_PENDING so nothing can be sent by accident and no contract is guessed.
 *
 * To implement, from the official documentation only:
 *   1. Fill in capabilities() from the specification.
 *   2. Map each method to the documented call, translating to and from the types in ./types.
 *   3. Throw Nms2sError with the right kind for each documented error (see ./errors). Network failures
 *      after the request was written must be UNKNOWN_OUTCOME, never a plain retryable error.
 *   4. Never log request headers or bodies without passing them through ./redact.
 *   5. Run the contract tests in tests/nms2s-transport-contract.test.ts against UAT with this transport.
 *   6. Set OFFICIAL_SPEC in ./config only after UAT evidence has been collected.
 */
export function officialTransport(): Nms2sTransport {
  const pending = async (): Promise<never> => {
    throw new Nms2sError("SPEC_PENDING", OFFICIAL_SPEC ? "This call has not been implemented from the specification yet." : "The official NMS2S API specification has not been received.");
  };
  return {
    kind: "OFFICIAL",
    label: "New Mexico NMS2S (official API, not yet implemented)",
    capabilities: (): TransportCapabilities => ({
      readPackages: "UNKNOWN",
      readPlants: "UNKNOWN",
      idempotencyKeys: "UNKNOWN",
      lookupByClientReference: "UNKNOWN",
      writes: { PACKAGE_ADJUST: "UNKNOWN", PACKAGE_SPLIT: "UNKNOWN" },
    }),
    listPackages: pending,
    listPlants: pending,
    submit: pending,
    lookup: pending,
  };
}
