# Project Apex bug register (updated for Apex II)

Branch `qa/apex-simulation`, start SHA `b4e8cad43625dd8dbe5183dddd4153e4d6cd9565`. "Confirmed" means a failing test or an end-to-end read of the code path. "Reported" means an independent read-only reviewer traced it and I re-read the cited code for the ones marked verified; it was not reproduced by a test.

## Fixed in this branch (each has a regression test)

| ID | Severity | Defect | Evidence | Fix | Regression test |
|---|---|---|---|---|---|
| APEX-01 | High | Offline sales were re-priced at today's tax rates instead of the rates the customer was charged (earlier finding 1) | Probe failed: total 4.87 re-booked at changed rates | `OfflineSale.rates` is sent by the register and used by the server; a rate change is noted for review. Older queued sales without rates fall back to current rates, as before | `apex-findings` F1, `offline-client` |
| APEX-02 | Medium | Daily upload allowance was handed back by deleting uploads (finding 2) | Probe: 3 uploads, delete all, 3 more allowed | Allowance counts started uploads in the audit log, under a per-person lock | F2, `attachments` |
| APEX-03 | Low | Odd `limit`/`offset` values (10.7, 1e30, Infinity) reached the database (finding 3) | Probe | `pageParams` accepts whole numbers only | F3 |
| APEX-04 | Medium | Malformed offline sale payloads (null line, non-UUID ids, object fields) caused HTTP 500 (finding 4) | Probe, 13 malformed shapes | Full payload validation; every refusal is an `InventoryError` | F4 |
| APEX-05 | Medium | A phone linked in the same second as a password change survived it (finding 6) | Probe | Comparison is to the whole second, matching how the timestamp is stored | F6 |
| APEX-06 | Medium | Offline sales kept no purchase-limit class snapshot, so a later item edit changed history (finding 8) | Probe | Snapshot stored on the sale line | F8 |
| APEX-07 | High | The database pool had no `error` handler. A dropped idle connection is an uncaught exception that ends the Node process | Adversarial test killed backends mid-batch: "Unhandled Error: Connection terminated unexpectedly" | `pool.on("error")` logs and lets the pool reconnect | adversarial "pool survives a lost idle connection" |
| APEX-08 | High | Webhook address filter missed hex IPv4-mapped IPv6 (`[::ffff:a9fe:a9fe]`, `[::ffff:7f00:1]`, `64:ff9b::`, `fe90::`): SSRF to cloud metadata / localhost for an owner-level user | Reviewer; I re-read `isPrivateAddress` and confirmed the hex form falls through | Hex-mapped forms decoded; link-local range corrected | adversarial "webhook addresses hidden inside IPv6" |
| APEX-09 | Medium | (Introduced and fixed within this branch) the offline endpoint would have trusted a client-claimed `limitCategory: NONE` to skip the limit check | Reviewer flagged it on my first fix | Limit check uses the server's class; a looser claim is noted for review | adversarial "cannot hide a purchase limit" |
| APEX-10 | High (at scale) | `sales` had no index by store and date. At 1,000,000 sales: dashboard 2.9 s, manager review queue and badge 200 ms, one-day sales lookup 290 ms | EXPLAIN showed a parallel sequential scan; stress timings | Migration `0046` adds three indexes; dashboard queries gained matching date bounds | stress test (`APEX_STRESS=1`), numbers in the performance report |

Earlier findings already fixed before Apex and re-verified: 5 (revoked devices keep sessions), 9 (impossible calendar dates in ID barcodes), 10 (successful Tally operations reported as failures after a refresh error). Finding 7 (concurrent Tally Undo) was probed with four simultaneous undos and is correct: exactly one succeeds.

## Fixed in Apex II (each has a regression test that fails without the fix, unless noted)

| ID | Severity | Defect | Fix | Test |
|---|---|---|---|---|
| APEX-31 | High | CI failure: a database client killed while checked out emitted an unhandled `error` and ended the process (the pool-level handler of APEX-07 did not cover checked-out clients) | per-client `error` listener on every connection | tests/apex-adversarial.test.ts |
| APEX-11 | Medium (deliberate behavior change) | A delegated manager could grant or reset to roles above their own permissions, edit owner accounts, widen facility access, invite above themselves | `team.ts`: no-escalation rule on grants, role edits, facility lists, invites; facility-limited staff cannot invite | tests/apex-authz.test.ts, tests/team-engine.test.ts |
| APEX-12 | Medium | Facility-restricted staff could edit, hide or add facilities and rooms outside their access | `assertFacilityAccess` / `assertWholeBusiness` in `facilities.ts` and the settings actions | tests/apex-authz.test.ts |
| APEX-13 | Medium | Partial returns refunded an average share of the sale, ignoring line promos | per-line `promo_discount`; refunds are net of the line promo; refunds always sum to the sale total | tests/apex-finance2.test.ts, and the 365-day ext sales |
| APEX-14 | Medium | A late offline sale for a closed drawer landed in the syncing person's drawer | attributed to the original drawer, its expected cash raised, audited `LATE_OFFLINE_SALE` | tests/apex-finance2.test.ts |
| APEX-15 | Low | Offline sales accepted fractions of counted items | whole-unit check | tests/apex-finance2.test.ts |
| APEX-16 | Low-Medium | Cost per unit rounded to 4 decimals | numeric(18,8) in packages, production inputs and runs; shared `roundCost` | tests/apex-finance2.test.ts, tests/manufacturing-math.test.ts |
| APEX-17 | Medium | A retail return into a package reserved for a wholesale order under-billed the invoice (10 units shipped, $35 billed instead of $50) | the order allocation grows with the restock | tests/apex-finance2.test.ts |
| APEX-18 | Policy | Discount presets could be 100% | capped at 90% | tests/apex-finance2.test.ts |
| APEX-19 | Low | No API rate limit, unpaginated `/items`, filter-after-limit, bad `%` returned 500 | DB-backed 300/min window with 429, pagination, safe decode | tests/apex-hardening.test.ts |
| APEX-20 | Low | Login timing revealed registered emails; one attacker could lock any email | decoy hash; lockout keyed by email and address, with a wider per-email cap | tests/apex-hardening.test.ts (timing reasoned, not timed) |
| APEX-21 | Low | Label SVG could load an external image | data-URL allowlist | tests/apex-hardening.test.ts |
| APEX-22 | Low | Per-day purchase limits off by default in states that need them | on by default where the state counts per day | tests/apex-compliance.test.ts |
| APEX-23 | Medium | Offline sales never counted toward later daily limits | ID number captured offline and counted | tests/apex-compliance.test.ts |
| APEX-24 | Low | Bulk edit could change an item's limit class with no extra permission | `pos.manage` check at propose time | code only, no dedicated test |
| APEX-26 | Medium | Wholesale shipment to a retailer ignored untested product | retail lab gate in `shipOrder` (matches licence types containing retail/dispens only) | tests/apex-compliance.test.ts |
| APEX-27 | High (blocked sales) | Packages made by split or merge carried no lab result and could not be sold in states that test first | child inherits the parent's passing result; migration 0049 backfills existing children | tests/apex-compliance.test.ts |
| APEX-29 (part) | Low | Stand-in Tally model switchable in production; full error objects logged | off when `VERCEL_ENV=production`; only the error name is logged | tests/apex-compliance.test.ts |
| APEX-30 | Low | No audit rows for cart line removal or reduction, or rewards attach/detach | audit rows added (online reservation creation by an anonymous shopper has no actor and is still unaudited) | tests/apex-compliance.test.ts |
| APEX-32 | High (found by reviewer) | A synced offline sale was never queued for state reporting (`Sale:OFFLINE_SYNC` had no event mapping): silent under-reporting | mapped to `RETAIL_SALE` | tests/apex-compliance.test.ts |
| APEX-33 | High (found by reviewer, reproduced) | Voiding a retail sale into a wholesale-reserved package under-billed the invoice | same allocation growth as APEX-17 | tests/apex-finance2.test.ts |
| APEX-34 | Medium (found by reviewer) | A user at one facility could take over a shipped package from another facility, or from an external customer's order, by uploading a manifest with a guessable number and their own quantity | the order must have been shipped to the receiving facility's licence, quantity capped at what shipped | tests/qa-round-fixes.test.ts |
| APEX-35 | Medium (found by reviewer) | A 90% promotion, a 90% cart discount and rewards stacked to about 99% off | checkout refuses when the stack leaves under 10% paid | tests/apex-finance2.test.ts |
| APEX-36 | Low (found by reviewer) | Two simultaneous syncs of one offline sale raised a raw database error | reported as a duplicate | tests/apex-compliance.test.ts |
| APEX-37 | Low | Offline limit check counted the store's current day, not the sale's day | uses the sale's day | covered by existing offline tests, no dedicated test |
| APEX-38 | Low (found by the extended simulation) | Manufacturing "Labor and other cost" rejected an explicit 0 | 0 accepted | extended simulation (365 runs) |
| APEX-39 | Low (found by reviewer) | Facility-limited holders could revoke another facility's API key or webhook if they knew its id | revoke and toggle are scoped to the facility | existing integration tests; no dedicated attack test |
| e2e | n/a | The wholesale e2e shipped untested product to a retailer after APEX-26 | the e2e records a passing lab result first | CI |

## Open (not fixed), with my severity rating

| ID | Severity | Defect | Why open |
|---|---|---|---|
| APEX-40 | Medium | Rewards: points are never taken below zero on a return or void, so a shopper who spends points and then returns the purchase keeps the reward value (about $5 per 100 points) | Needs a policy choice: allow negative balances, block redeeming points from returnable sales, or recover dollars. Existing rule is deliberate |
| APEX-41 | Medium | Refund method is not tied to the original tender (a CASH refund on a debit sale; a cash refund can exceed the cash portion of a split) | Policy decision |
| APEX-25 | Medium (the reviewer rated one part medium-high) | Adjusting a package to zero with a waste-like reason skips the 72-hour hold and mix check in `destroyPackage`; no witness or second-person rule exists for waste, destroy or adjustments; no manager approval for large adjustments | Whether NM requires these for adjustments is not something I could verify, so I did not invent a rule |
| APEX-23b | Medium | An offline sale is recorded even if over a limit, under age or of untested product (flag only) | Deliberate: the customer already paid; the review queue is the only control |
| APEX-28 | Low | The MOCK reporting adapter stores events as SENT (the pages label them "practice, not sent"); practice events are never backfilled if a facility later switches to a real system | Labelled in the UI; backfill needs a design |
| APEX-42 | Low | Facility-limited `users.manage` holders can edit or delete custom roles held by people at other facilities, and list or unlink other members' phones | Sabotage, not escalation |
| APEX-43 | Low | Facility-limited `audit.view` holders see organization-level audit rows (invites, role changes, resets) | Design decision on org-level rows |
| APEX-44 | Low (design) | Items, strains, vendors, price lists, promotions, discount presets and reward settings are business-wide, so a facility-limited manager changes them everywhere | No facility column exists on those tables |
| APEX-45 | Low | Tally `business_overview`, `watch_findings` and `recent_tally_changes` have no permission requirement beyond being signed in | Same facility only |
| APEX-46 | Low | Sign-in throttle trusts the first `x-forwarded-for` entry (safe on Vercel, which overwrites it); API key failures are not rate limited; `ASSISTANT_FAKE` is guarded only by `VERCEL_ENV` | Hosting-dependent |
| APEX-47 | Low | Tally limits count questions, not tokens (up to 8 model rounds each); a confirm card can show stale values for 15 minutes; an aborted question can bill tokens without counting; a file name can mimic the trusted attachment label | Not fixed |
| APEX-48 | Low | Offline sales accept a register-supplied discount up to 100% (flagged only); offline quantity precision is sub-cent inconsistent; manufacturing input cost rounding drift under $0.0001 per run; cash refunds can drive expected cash negative; a return may restock into a package that has since shipped (suspected, not run) | Small |
| APEX-49 | Low | The Dutchie/NMS2S importer format and the app copy that mentions NMS2S are not validated against real NMS2S exports | Do not read the app text as validation |

NMS2S: **not validated.** No code path was exercised against NMS2S, Metrc or BioTrack. The NMS2S adapter is manual only and access has been requested, not granted.
