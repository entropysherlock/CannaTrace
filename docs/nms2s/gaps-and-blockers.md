# Known gaps and blockers

## Blockers (external)

| # | Blocker | Owner | Unblocks |
|---|---|---|---|
| B-1 | Integrator enrollment approval | CCD (requested from the Compliance Manager) | Everything below |
| B-2 | Official NMS2S API specification | CCD/RTS | Official transport, status and unit maps, intent mappings |
| B-3 | UAT base URL, UAT credentials, UAT test license(s) and test packages and plants | CCD/RTS | Contract tests and UAT cases |
| B-4 | Production approval process | CCD | Production use |

## Gaps (CannaTrace work remaining)

| # | Gap | Depends on | Notes |
|---|---|---|---|
| G-1 | `official-transport.ts` implementation | B-2 | Checklist is in the file header |
| G-2 | `OFFICIAL_STATUS_MAP` and unit mapping | B-2 | Until then every state status is "not comparable" |
| G-3 | Write intents beyond adjust and split | B-2 | See workflow-mapping.md |
| G-4 | UI: credentials form, ledger view with "check with NMS2S" and "I checked" actions, reconciliation report | None (can start now; small) | Must use `requirePermission("compliance.manage")` |
| G-5 | Scheduled reconciliation and a Tally Watch check fed by API reads, replacing the CSV upload | B-3 | Reuse findings categories |
| G-6 | Rate limit pacing in the queue | B-2 | Queue runs one record at a time per facility today |
| G-7 | Switch `ADAPTERS.NMS2S` from manual to the bridge | UAT pass | One-line change, with a feature flag |
| G-8 | Requeue a settled event automatically (today a person presses Retry in State reporting) | G-4 | |
| G-9 | Ledger retention and archiving | Answer to Q-16 | |

## Things deliberately not done

- No guessed endpoints, headers, field names, status values, reason codes or units.
- No production configuration, deployment or merge.
- No change to existing inventory, lab, permission or audit behavior.
- Metrc credentials stay global env vars (out of scope; the same per-facility pattern could be applied later).
