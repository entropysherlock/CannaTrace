# Project Apex: executive report

**What it is.** A seeded, 365-day simulation of a vertically integrated New Mexico cannabis business run through CannaTrace's real business code against a real, isolated PostgreSQL database, checked every day against an independent reference ledger, plus adversarial, security and 1,000,000-sale stress testing. Nothing was deployed and production was never touched.

**Bottom line.** In everything simulated, CannaTrace's inventory and money matched the independent ledger exactly: 102,930 retail sales, 5,070 plants, 28,776 packages, 39 harvests, 88 wholesale invoices, 2,190 drawer closes, zero mismatches. Apex also found and fixed ten defects, including one that could end the server process and one SSRF bypass, and left twenty confirmed or reported issues open (see the bug register). It is not evidence that the product is ready for state reporting: NMS2S was not validated, and several compliance gaps are open.

## What was run
| Item | Count |
|---|---|
| Simulated days | 365 (seed 20260101, reproducible) |
| Facilities | 1 cultivation, 1 manufacturing (created, not simulated), 1 distribution, 3 retail |
| Employees (users) | 50 (cashiers, managers and roles created; permission differences not exercised by the simulator) |
| Retail SKUs | 100 (flower, concentrate, edible, accessories; every price has odd cents) |
| Plants / harvests | 5,070 tagged, 5,013 harvested, 57 destroyed / 39 |
| Packages in database | 28,776 |
| Retail sales | 102,930 recorded: 102,410 completed, 520 voided; 4,170 rung up offline; 2,018 returns |
| Wholesale | 88 invoices, $523,570.00 billed, 5 customers; 38 internal manifest transfers (305,788 g out = in) |
| Failed-lab attempts blocked | 35 |
| Audit rows / movements | 562,124 / 297,724 |

## Labels: executed, mocked, untested
- **Executed with real code and a real database:** cultivation through packaging, lab pass/fail and release, manifested transfer, wholesale order-to-payment, register sales with discounts, taxes, three payment types, offline sync, returns, voids, drawer counts and variances, a mid-year tax change, and the adversarial and security scenarios.
- **Simulated (not real-world):** the clock is logical days; database timestamps are real. Customers, IDs and lab results are generated. Concurrency is many requests from one test process, not many servers.
- **Mocked:** nothing in the business logic. Only `next/cache` revalidation is stubbed, as in the existing tests.
- **Not tested:** manufacturing runs at scale, rewards and promotions at scale, label printing, Tally during the year, state reporting, multiple instances, production pool size of 5, power or network loss beyond a database-connection kill, browser attacks.

## Findings
Ten fixed (APEX-01 to 10), listed with evidence in the bug register. The ones that matter most: a dropped idle database connection could crash the process; an owner could reach cloud-metadata or localhost through a webhook address; offline sales were taxed at the wrong rates after a rate change; and at one million sales the dashboard took about 3 seconds and the review queue 200 ms because `sales` had no store-and-date index. After the fixes the 30-day dashboard takes 0.34 s, the review queue under 1 ms; the 90-day dashboard still takes 1.2 s.

Open and most important: delegated-manager privilege escalation (APEX-11), facility-restricted staff editing other facilities (APEX-12), refund allocation on partial returns (APEX-13), offline cash landing in the wrong drawer (APEX-14), and the compliance gaps APEX-22 to 28.

## Scores
Method: each dimension starts at 100. Subtract 12 per open High, 6 per Medium, 2 per Low. Subtract up to 12 for important areas that were not tested. Commercial readiness is the mean of the other eight minus 10 for no validated state integration and no pilot customer. The weights are my judgement; the arithmetic and the evidence are below. Treat them as a way to compare before and after, not as a certification.

| Dimension | Before | After | Basis |
|---|---|---|---|
| Reliability | 72 | 90 | before: pool crash (12), malformed offline 500 (6), untested −10; after: untested −10 |
| Inventory integrity | 86 | 86 | no discrepancies; APEX-15, 17 (2+2), manufacturing and merges not simulated −10 |
| Financial accuracy | 64 | 76 | before: offline tax (12), drawer attribution (6), partial returns (6), manufacturing cost (2), 100% discount (2), promos and rewards untested −8 ; after: offline tax fixed |
| Security | 46 | 72 | before: SSRF (12), upload quota (6), device window (6), pagination (2), plus open APEX-11, 12 (12) and three Lows (6), untested −10; after: the four fixed |
| Compliance readiness | 44 | 50 | state reporting unvalidated (12), APEX-22 to 27 (6+6+6+6+2+2), offline snapshot (6, fixed), untested −10 |
| Performance | 68 | 86 | before: dashboard (12), review queue (6), date scans (6), untested −8; after: 90-day dashboard (6), untested −8 |
| Scalability | 70 | 82 | before: store/date scans at 1M (12), pool of 5 (6), untested −12; after: pool and untested |
| AI reliability | 62 | 62 | Tally findings unchanged (stale confirm 6, budget 6, three Lows 6), untested −20 (no live-model runs) |
| Commercial readiness | 54 | 65 | mean of the above minus 10 |

## Reproduce
`APEX_SEED=20260101 APEX_DAYS=365 APEX_SALES=94 APEX_PACK=12 APEX_PLANTS=130 npx vitest run tests/apex-sim.test.ts` (resumable via `APEX_CHECKPOINT`, `APEX_BUDGET_MIN`). Stress: `APEX_STRESS=1 npx vitest run tests/apex-stress.test.ts`. Both are wired into `.github/workflows/apex.yml` (weekly and on demand). With no settings the simulation runs a 110-day smoke inside the normal suite.

## Caveats
A first and a second attempt at the full run were discarded after my own simulator faults (a checkpoint-resume bug and two harvest-step bugs) left the database out of step with the ledger; the reported run is the third, uninterrupted from day 0 to 365. The `qa/project-apex` branch and `tests/apex-pos-invariants.test.ts` named in the brief do not exist in this repository, so nothing was reused from them. The compliance and Tally reviewer findings were not reproduced by tests.
