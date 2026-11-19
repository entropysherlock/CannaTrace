# NMS2S integration readiness report

**Status: PREPARED, NOT INTEGRATED.** CannaTrace has not exchanged a single request with New Mexico's NMS2S. The official API specification and UAT credentials have not been received (integrator enrollment requested from CCD). Nothing in this branch may be described as "NMS2S compatible" or "NMS2S certified".

Branch: `nms2s-readiness`. Not merged, not deployed.

## What this package contains

| Document | Purpose |
|---|---|
| [architecture.md](architecture.md) | Current sync architecture, the new NMS2S layer, and how they connect |
| [capability-matrix.md](capability-matrix.md) | Every capability, what is built, and what waits on the specification |
| [workflow-mapping.md](workflow-mapping.md) | CannaTrace workflows → state functions (to be filled from the spec) |
| [test-inventory.md](test-inventory.md) | Every automated test, what it proves, and against what |
| [evidence-template.md](evidence-template.md) | Template for recording real UAT evidence, kept apart from simulated results |
| [security-checklist.md](security-checklist.md) | Credential, isolation, audit, and traffic controls with their status |
| [gaps-and-blockers.md](gaps-and-blockers.md) | What is missing and what blocks it |
| [questions-for-ccd-rts.md](questions-for-ccd-rts.md) | Questions that need official answers before implementation |

## Phase 1: architecture audit (summary)

**Reusable as is**
- The state-sync outbox (`sync_events`, `src/lib/sync.ts`). Records are queued in the same transaction as the change and the audit entry, so a change can't happen without its report, and a rolled-back change leaves no report.
- Per-facility ordering with an advisory lock (`pg_try_advisory_lock(hashtext('sync:'+facility))`), stop-on-failure so later records never overtake a failed one, backoff (1, 5, 30, 120, 720 min), time budget, MANUAL and RESOLVED states with who/why.
- The `Adapter` seam (`ADAPTERS.NMS2S` is currently a manual adapter). The new bridge plugs in here.
- The append-only `audit_logs` table (database trigger forbids update/delete) and the `audit()` helper.
- AES-256-GCM secret storage (`src/lib/ai/secret-box.ts`), extended with explicit contexts so a credential is bound to business + facility + environment.
- Facility scoping: every engine function takes an `Actor` whose `facilityId` comes from the signed-in session; server actions check `compliance.manage`.
- Inventory engine (`receivePackage`, `adjustPackage`, `splitPackage`, merge, production, plants) and lab safety guards (`assertNotFailedLab`) are untouched.
- Tally Watch's CSV state-report comparison remains as the manual fallback.

**Had to change (done, additively)**
| Risk found | Why it matters | What was built |
|---|---|---|
| A timeout or dropped connection on a write is treated as retryable | The state may have applied it; a resend could duplicate a regulatory record | `UNKNOWN_OUTCOME` status; writes are only resent when known not applied; lookup or a person settles it |
| No request idempotency key | Retries and concurrent workers can't be deduplicated | `nms2s_requests` ledger keyed by a stable key derived from the sync event id, unique per facility + environment, atomic claim |
| Credentials are global env vars (Metrc) | One business's key would serve every facility; no rotation trail | `nms2s_credentials`: sealed per facility + environment, audited by field name and hint only |
| No state↔local id mapping | Reconciliation and later writes must refer to the state's own ids | `nms2s_id_map`, written only from a write response or a person's confirmation |
| State comparison only via uploaded CSV | No automated reconciliation; no "pending" category | Pure `reconcile()` with 9 categories and a saved, immutable reconciliation record |
| No environment separation | UAT and production could be confused | `UAT`/`PRODUCTION` on every row; simulator refuses production; production needs an explicit approval phrase |

**Remaining architectural risks**
- The sync queue's `retryEvent` lets a person resend a FAILED event. For NMS2S events the ledger refuses to resend an unknown outcome, so this is safe, but the compliance page doesn't yet show the ledger status or offer "settle" buttons (UI deferred until the spec defines what can be looked up).
- `EVENT_TYPES` is shared by all state systems. NMS2S may need records CannaTrace doesn't emit today (for example, distinct plant growth-phase or waste records). Unknown until the specification.
- Webhook delivery and sync processing run on the same scheduled job; NMS2S rate limits are unknown.

## Phases 2–5: what was built

`src/lib/nms2s/` (contract-agnostic; no endpoint, header, field, or status value is assumed)

| File | Role |
|---|---|
| `types.ts` | CannaTrace's own domain types and the `Nms2sTransport` interface. State ids are opaque strings. |
| `config.ts` | UAT/production configuration from env, all off by default; `OFFICIAL_SPEC = null`; the single call gate |
| `errors.ts` | Error kinds and the write/read retry policy |
| `redact.ts` | Credential redaction for logs, audit, and error text |
| `official-transport.ts` | The official transport: refuses every call with `SPEC_PENDING`; implementation checklist inside |
| `simulator.ts` | **Unofficial** in-memory simulator with configurable faults |
| `credentials.ts` | Sealed, facility-scoped credential storage |
| `ledger.ts` | Durable write ledger: idempotency, atomic claim, unknown outcomes, lookup and manual resolution, id linking |
| `reconcile.ts` | Pure reconciliation (state is authoritative; never writes) |
| `reconciliation.ts` | Paged read-only reconciliation run, saved permanently |
| `sync-bridge.ts` | Adapter that connects the existing sync queue to the ledger. **Not registered** in `ADAPTERS`. |

Database: migration `0028_nms2s_preparation.sql` (additive: 4 new tables, 1 enum, an immutability trigger on reconciliation records). No existing table was changed.

## Verification on this branch (simulated evidence only)

Run on 2026-11-19 against a fresh Postgres, `TZ=UTC`, following the CI steps:

| Check | Result |
|---|---|
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm run db:migrate` (fresh DB) + `db:seed` | pass |
| `npm test` (vitest, 45 files) | 444 passed, including 37 new NMS2S tests |
| `npm run build` | pass |
| `npm run test:e2e` (Playwright) | 76 passed |

These results show CannaTrace's own logic behaves correctly against its own simulator. **They are not evidence of compatibility with NMS2S.** Real evidence goes in [evidence-template.md](evidence-template.md).

## Definition of done (not met)

1. Official specification received and every `UNKNOWN` in the capability matrix answered.
2. `official-transport.ts` implemented from the specification only; status map and unit map filled.
3. Contract tests pass against UAT; UAT test cases executed and evidence recorded.
4. CCD/RTS sign-off for production; `OFFICIAL_SPEC` set; `ADAPTERS.NMS2S` switched to the bridge.
