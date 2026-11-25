# Project Apex bug register

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

## Open: confirmed by reading the code, not fixed here

| ID | Severity | Defect | Why not fixed here |
|---|---|---|---|
| APEX-11 | Medium | A team manager holding only `users.manage` can reset the password of, or promote someone to, a role with more permissions than their own (`team.ts` `lockTarget`, `createPasswordReset`, `changeUserRole`) | Needs a decision on the delegation model |
| APEX-12 | Medium | A staff member restricted to one facility can edit or hide another facility in the same business if they know its id (`facilities.ts` `updateFacility`, `setFacilityHidden`, `updateRoom` filter by org only) | Needs the action layer to pass facility access |
| APEX-13 | Medium | Partial returns refund an average share of the sale total, ignoring which line carried the promo or reward discount (`pos.ts` ~1106). Cumulative refunds still equal the total | Policy decision |
| APEX-14 | Medium | An offline sale whose original drawer is closed is counted into the syncing person's drawer, so one drawer is over and the other short; only a review note records it | Needs an adjustment mechanism |
| APEX-15 | Low | Offline sales do not check whole-unit quantities for EACH items | Small, deferred |
| APEX-16 | Low to Medium | Manufacturing cost per unit is rounded to 4 decimals and can become 0 or be off by a third for tiny units | Needs a schema decision |
| APEX-17 | Low | A retail return into a package already allocated to a wholesale order may under-bill the invoice (reported, plausible, not run) | Not reproduced |
| APEX-18 | Policy | Discount presets can be set to 100%, conflicting with the 90% cap applied to promotions | Policy |
| APEX-19 | Low | API keys have no rate limit; `/api/v1/items` is unpaginated; `/api/v1/sales` filters after `limit`; a bad `%` escape returns 500 | Deferred |
| APEX-20 | Low | Login timing reveals registered emails; eight bad passwords lock that email for 15 minutes (lockout by anyone) | Design trade-off |
| APEX-21 | Low | A label SVG can reference an external image URL that loads in other users' browsers (tracking beacon; no script) | Deferred |

## Open: compliance and Tally findings from the independent reviewers (reported, not reproduced)

| ID | Item |
|---|---|
| APEX-22 | Per-day purchase limits are off by default; states whose rules are per-day (not NM) are not enforced until a store enables it |
| APEX-23 | Offline sales skip ID, age and limit gates (by design, noted for review) and are never counted toward later daily totals |
| APEX-24 | Chat bulk edit can set an item's limit class to NONE with no extra permission |
| APEX-25 | Destroy rules (72-hour hold, 50% mix) are enforced only in `destroyPackage`; adjustment to zero, plant destruction and harvest waste have no hold or witness |
| APEX-26 | A lab PASS is self-attested (no COA or lab check); wholesale ship and allocation block only FAIL, not PENDING |
| APEX-27 | Split and merge children carry no lab results of their own, so in NM a split of a passing package may be unsellable until a result is re-entered (reported; not exercised, the simulator does not split) |
| APEX-28 | State reporting defaults to a MOCK adapter that marks events SENT; Metrc is untested against a live account; NMS2S and BioTrack are manual |
| APEX-29 | Tally: a confirm card can show stale before/after values for 15 minutes; an aborted or timed-out question can bill tokens without counting against the budget; file names can mimic the trusted attachment label; `ASSISTANT_FAKE=1` has no production guard; full error objects are logged |
| APEX-30 | Missing audit rows for cart edits, rewards attach/detach and online reservations (reported, low) |
