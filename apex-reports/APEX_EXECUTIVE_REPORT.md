# Project Apex II: executive report (enterprise hardening)

**What it is.** Apex II fixed what Apex found, extended the 365-day simulation, reran it and the one-million-sale stress test, and had three independent read-only reviewers challenge the new code.

**Bottom line.** The target was not met. Commercial readiness is **68/100 against a target of 90**. No item I rate Critical or High is open, but one reviewer rated an open waste-rule gap (APEX-25) medium-high, and the cross-facility criterion is only partly met (see the matrix). The simulation reconciled to the independent ledger with zero mismatches again, and the reviewers found two more High defects that the simulation could not see (offline sales never queued for state reporting, and a void that under-billed a wholesale invoice). Both are fixed. NMS2S is not validated.

## What was run
| Item | Result |
|---|---|
| Simulated days | 365, seed 20260101, rerun from day 0 on a freshly migrated database after all fixes |
| Main ledger | 102,930 retail sales (520 voided, 4,170 offline, 2,018 returns), 5,070 plants, 39 harvests, 88 wholesale invoices, 2,190 drawer closes: 0 daily mismatches, 0 inline findings, 0 invariant violations |
| New this round | A daily extension in its own business, 365 days: 365 manufacturing runs (cost to 8 decimals checked against an independent calculation), 365 sales with a 20% item promotion, 365 reward members (points earned and taken back), every promo sale returned one unit at a time (refunds summed to the sale total), 365 label records rendered and validated, 365 Tally propose/confirm moves with attacks (wrong user, tampered token, other business, replayed card). 0 findings after APEX-38 |
| Stress | 1,000,000 sales loaded in 91 s; indexed lookups 0.2 to 4 ms; 30-day dashboard 0.34 s; 90-day dashboard 1.2 s (unchanged, still the slowest); 12-register burst, 480 sales, 0 errors, 95 sales/s |
| Tests | 726 passed, 3 skipped (gated stress) on a clean database; type check and lint clean (4 existing warnings) |
| CI | All checks green on the last pushed commit before this report. The check ran the unit tests and 140 Playwright tests |

## Labels: executed, mocked, untested
- **Executed with real code and a real database:** everything in Apex, plus manufacturing, promotions, rewards, label rendering and validation, and Tally with a scripted stand-in model.
- **Simulated (not real-world):** logical days with real timestamps; generated customers and lab results; concurrency from one process.
- **Mocked:** `next/cache` revalidation. Tally used the scripted stand-in model, so no live-model behavior was tested.
- **Not tested:** state reporting against any real state system (NMS2S, Metrc and BioTrack all untested), multiple instances, the production pool of 5, power loss, browser attacks, TLS and headers, dependency vulnerabilities, labels sent to a printer, rewards redemption at scale (the extension earns and returns points but does not redeem). Every generated starter label was blocked only by the missing state logo upload, which is business setup.

## What the reviewers found
Three independent reviewers (authorization, financial, compliance and Tally) read the new code. Fixed after their reports: offline sales not queued for state reporting (APEX-32), void into a reserved package under-billing (APEX-33, reproduced by the reviewer), manifest takeover across facilities (APEX-34), stacked discounts giving product away (APEX-35), duplicate offline sync error (APEX-36), API key and webhook revoke scoping (APEX-39). Not fixed, with reasons: APEX-40 to 49 in the bug register. The reviewers did not run every suspicion; each item is labelled in the register.

## Findings this round
Twenty-six items fixed (APEX-11 to 39 where numbered), listed with tests in the bug register. The CI failure itself was a real production bug (APEX-31). Thirteen open entries remain. Four are Medium: rewards clawback (APEX-40), refund method versus tender (APEX-41), waste and witness rules (APEX-25) and the deliberate flag-only offline rule (APEX-23b). The rest are Low.

## Scores
Method (unchanged from Apex, nothing relaxed): each dimension starts at 100. Subtract 12 per open High, 6 per Medium, 2 per Low. Subtract up to 12 for important areas that were not tested. Commercial readiness is the mean of the other eight minus 10 for no validated state integration and no pilot customers.

| Dimension | Apex | Apex II | Basis |
|---|---|---|---|
| Reliability | 90 | 90 | no open items; power loss and multi-instance untested (-10) |
| Inventory integrity | 86 | 92 | open: possible restock into a shipped package, suspected (-2); splits, merges and cycle counts not simulated at scale (-6) |
| Financial accuracy | 76 | 72 | open: rewards clawback (-6), refund method (-6), four Lows (-8); rewards redemption and live card processing untested (-8). Lower than before because the reviewers found more |
| Security | 72 | 74 | open: seven Lows (-14); browser attacks, headers, dependency scan, penetration test not done (-12) |
| Compliance readiness | 50 | 56 | open: adjust-to-zero bypass (-6), no witness rule (-6), offline flag-only rule (-6), two Lows (-4); state reporting unvalidated (-12); untested (-10) |
| Performance | 86 | 86 | 90-day dashboard 1.2 s at 1M sales (-6); untested (-8) |
| Scalability | 82 | 82 | pool of 5 (-6); multi-instance untested (-12) |
| AI reliability | 62 | 72 | open: four Lows (-8); no live-model runs (-20) |
| **Commercial readiness** | 65 | **68** | mean 78 minus 10 |

The score did not reach 90. It would need a validated state integration, a pilot, live-model testing, a facility column on shared objects, and decisions on APEX-25, 40 and 41. I did not adjust any weight or criterion to move it.

## Reproduce
`APEX_SEED=20260101 APEX_DAYS=365 APEX_SALES=94 APEX_PACK=12 APEX_PLANTS=130 npx vitest run tests/apex-sim.test.ts` (resumable via `APEX_CHECKPOINT`, `APEX_BUDGET_MIN`). Stress: `APEX_STRESS=1 npx vitest run tests/apex-stress.test.ts`. Both are wired into `.github/workflows/apex.yml` (weekly and on demand). With no settings the simulation runs a 110-day smoke inside the normal suite.

## Caveats
The first Apex II run stopped at about day 96 because my new extension passed an explicit zero labor cost that the application rejected (APEX-38); that run was discarded and the reported run restarted from day 0. The extension has its own business, so the main ledger numbers are identical to Apex by construction. The extension is checked by the same independent-expectation method but is much smaller than the main run: one sale and one production run a day.

A first and a second attempt at the full run were discarded after my own simulator faults (a checkpoint-resume bug and two harvest-step bugs) left the database out of step with the ledger; the reported run is the third, uninterrupted from day 0 to 365. The `qa/project-apex` branch and `tests/apex-pos-invariants.test.ts` named in the brief do not exist in this repository, so nothing was reused from them. The compliance and Tally reviewer findings were not reproduced by tests.
