# API capability matrix

"State API" says what the official NMS2S API offers. Every entry stays **Unknown** until the specification is received. Nothing in CannaTrace assumes an answer.

| # | Capability | State API | CannaTrace preparation | Simulator coverage | Needed to finish |
|---|---|---|---|---|---|
| 1 | UAT and production environments | Unknown (URLs not issued) | Built: `NMS2S_ENVIRONMENT`, per-environment base URL, traffic switch, production approval phrase | n/a | Base URLs from CCD/RTS |
| 2 | Authentication scheme | Unknown | Built: credential storage that accepts any named fields, sealed per facility and environment | Single `apiKey` field | Field names and header format |
| 3 | Facility / license scoping of credentials | Unknown | Built: one credential set per facility and environment | Credentials restricted to licenses; read-only accounts | Whether one integrator key covers many licenses |
| 4 | Read packages | Unknown | Built: `listPackages` interface, paged reader, reconciliation | Supported, paged | Endpoint, filters, fields |
| 5 | Read plants | Unknown | Built: `listPlants` interface, plant status reconciliation | Supported, paged | Endpoint, fields, phases |
| 6 | Pagination | Unknown | Built: opaque cursor, page cap, repeated-cursor guard | Cursor-based | Cursor or offset? Page size limits |
| 7 | Package adjustment | Unknown | Built: `PACKAGE_ADJUST` intent mapped from `PACKAGE_ADJUSTED` events | Supported | Endpoint, reason codes, units |
| 8 | Package split (new package from package) | Unknown | Built: `PACKAGE_SPLIT` intent mapped from split events only | Supported | Endpoint; one call per child or batch? |
| 9 | Merge, production, harvest packaging | Unknown | Not mapped (stays manual) | — | Specification |
| 10 | Plants: create, tag, phase change, move, destroy | Unknown | Events exist in `EVENT_TYPES`; not mapped (manual) | — | Specification |
| 11 | Harvests, waste | Unknown | Events exist; not mapped (manual) | — | Specification |
| 12 | Transfers / manifests | Unknown | Events exist; not mapped (manual) | — | Specification |
| 13 | Retail sales, voids, returns | Unknown | Events exist; not mapped (manual) | — | Specification |
| 14 | Lab results | Unknown | Events exist; not mapped (manual) | — | Specification |
| 15 | Client idempotency key | Unknown | Built: key per sync event, ledger dedupe works with or without state support | Both modes tested | Whether the state honors one, and how |
| 16 | Look up a write's outcome | Unknown | Built: `lookup()`; manual resolution with a required note when unsupported | Both modes tested | Whether, and by what reference |
| 17 | Error format and status codes | Unknown | Built: error kinds and retry policy; official mapping left to the transport | Every kind | Error schema |
| 18 | Rate limits | Unknown | Built: throttled writes treated as unknown outcome until confirmed safe | Rate limit with retry-after | Limits, headers, whether throttled writes are applied |
| 19 | Status values | Unknown | Built: `OFFICIAL_STATUS_MAP` (empty); unmapped statuses reported, never guessed | Test-only map | Status list |
| 20 | Units of measure | Unknown | Reconciliation compares only CannaTrace unit codes; anything else is "not comparable" | Unit codes | Unit list |
| 21 | State identifiers | Unknown | Built: opaque `stateId`; `nms2s_id_map` | `SIM-` ids | Id format and stability |
