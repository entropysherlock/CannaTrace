# Project Apex acceptance matrix

Verdicts are for what was executed. "Met" never means "proven for everything".

| Criterion | Verdict | Evidence |
|---|---|---|
| Zero unexplained inventory discrepancies | Met (simulated scope) | 365-day rerun: ledger vs database stock matched daily; package quantity equals its movement history; every completed sale line fully sourced |
| Zero unexplained financial discrepancies | Met (simulated scope) | Daily per-store reconciliation, 0 mismatches over 365 days; extension sales, promos, returns and rewards matched independent expectations. Limits: rewards redemption not simulated, offline discount path differs from the register path |
| Zero cross-org access | Met (tested and reviewed paths) | adversarial suite; three reviewers found none |
| Zero cross-facility access | **Not met** | APEX-12 and APEX-34 are fixed, but facility-limited staff can still edit business-wide objects (APEX-44), edit roles held at other facilities (APEX-42) and read org-level audit rows (APEX-43) |
| Zero delegated-manager privilege escalation | Met for the paths reviewed | APEX-11 fixed; the authorization reviewer found none left. It changes behavior: delegates can no longer grant above their own level |
| Zero duplicate commits | Met (tested) | concurrent pay, void, return, offline sync (APEX-36), package tag, Tally confirm and undo |
| Zero untraceable movements | Met (simulated scope) | movement history equals quantity for every package |
| Zero unhandled critical failures | Met after fix | APEX-07 and APEX-31 (both process-ending connection errors). Power loss and multi-instance not tested |
| Zero audit gaps | Partly met | cart edits and rewards now audited (APEX-30); anonymous online reservation creation still has no audit row |
| Zero unresolved Critical or High | Met by my ratings, with a caveat | none rated High is open; the compliance reviewer rated the adjust-to-zero waste bypass (part of APEX-25) medium-high and I rated it Medium because I could not verify an NM rule requiring a hold on adjustments |
| Commercial readiness at least 90 | **Not met** | 68, by the method in the executive report |
| All regression tests pass | Met | 726 passed, 3 skipped (gated stress) on a clean database; CI green on the last pushed commit |
| Every new bug has a regression test | Met with exceptions | APEX-24, 37, 39 have no dedicated test (listed in the register) |
| Real isolated PostgreSQL, never production | Met | embedded local Postgres; no production connection; no deploy; PR not merged |
| NMS2S validated | **Not claimed** | state reporting was not exercised against any real system |
