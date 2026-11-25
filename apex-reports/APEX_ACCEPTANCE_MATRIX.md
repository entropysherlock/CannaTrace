# Project Apex acceptance matrix

Verdicts are for what was executed. "Met" never means "proven for everything".

| Criterion | Verdict | Evidence |
|---|---|---|
| Zero unexplained inventory discrepancies | Met (simulated scope) | 365 days, 102,930 sales, 28,776 packages: ledger vs database stock matched at the end and on checks through the year; package quantity equals the sum of its movements for every package |
| Zero unexplained financial discrepancies | Met (simulated scope) | Daily per-store reconciliation of count, subtotal, discounts, excise, sales tax, total and refunds: 0 mismatches over 365 days; drawer expected cash and injected variances matched at all 2,190 closes; wholesale invoices matched to the cent |
| Zero cross-org access | Met (tested and reviewed paths) | adversarial suite, reviewers |
| Zero cross-facility access | **Not met** | APEX-12 (restricted staff can edit other facilities of their business). Sales, carts, packages and drawers were isolated in tests |
| Zero duplicate commits | Met (tested) | 4x concurrent pay, void, return; 5x offline sync; 4x package tag; 4x Tally confirm and undo |
| Zero untraceable movements | Met (simulated scope) | every package's quantity equals its movement history; every completed sale line fully sourced to packages |
| Zero unhandled critical failures | Met after fix | APEX-07 (process-ending pool error) found by killing database connections mid-batch and fixed. Other hard failures (power loss, multi-instance) not tested |
| Zero audit gaps | Partly met | every package and completed sale has an audit row (invariant). Reviewers report none for cart edits, rewards attach and online reservations (APEX-30) |
| All regression tests pass | Met | 697 passed, 3 skipped (stress, gated) on a freshly migrated and seeded database |
| Every new bug has a regression test | Met for APEX-01 to 10; APEX-10's test is the gated stress run | |
| Prior QA findings independently verified | Done | 6 reproduced and fixed; 3 already fixed and re-verified; concurrent Undo found correct |
| Real isolated PostgreSQL, never production | Met | embedded local Postgres; no production connection used; no deploy |
| NMS2S validated | **Not claimed** | state reporting was not exercised; the reviewers note MOCK defaults and unvalidated Metrc |
