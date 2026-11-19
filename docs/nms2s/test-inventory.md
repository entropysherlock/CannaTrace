# Test inventory

**All results below are simulated:** they run against CannaTrace's code and its unofficial simulator. Planned UAT cases are listed separately and have **not** been executed.

## How to run

```bash
npx vitest run tests/nms2s-unit.test.ts                 # no database needed
npx vitest run tests/nms2s-engine.test.ts               # needs DATABASE_URL (migrated)
npx vitest run tests/nms2s-transport-contract.test.ts   # simulator; official only with NMS2S_CONTRACT_TARGET=official
npm test && npm run test:e2e                            # full regression
```

## Automated (simulated), last run 2026-11-19: 37/37 pass

| ID | File | Test | Proves |
|---|---|---|---|
| U-01 | unit | is off unless the environment is set, and never guesses a URL | Default-off config |
| U-02 | unit | refuses every official call while the specification is pending | No real traffic possible |
| U-03 | unit | lets the simulator run outside production only | Simulator can't stand in for production |
| U-04 | unit | official transport refuses everything and claims no capability | No invented contract |
| U-05 | unit | never retries a write automatically when it might already have been applied | Duplicate prevention policy |
| U-06 | unit | retries reads freely | Read recovery |
| U-07 | unit | treats a timeout or any unexpected exception as an unknown outcome | Safe default |
| U-08 | unit | redacts secret-looking keys and known values | No credential leakage |
| U-09 | unit | binds sealed credentials to their facility and environment | Credential isolation |
| U-10 | unit | labels itself as unofficial | Simulator labeling |
| U-11 | unit | pages through records deterministically, rejects bad page requests | Pagination, malformed requests |
| U-12 | unit | isolates licenses and checks credentials and permissions | Invalid credentials, permission failures, multi-facility |
| U-13 | unit | applies authorized splits and adjustments, refuses bad ones, honors request keys | Writes, duplicates |
| U-14 | unit | can lose an answer after applying, and says so on lookup | Timeout after success |
| U-15 | unit | simulates rate limits, server errors and an API without request keys | Rate limiting, why blind resends are unsafe |
| U-16 | unit | sorts every record into exactly one category and changes nothing | All reconciliation categories, read-only |
| U-17 | unit | reports unmapped state statuses instead of guessing | No invented business rules |
| U-18 | unit | compares plants by status | Plant reconciliation |
| E-01 | engine | stores credentials sealed per facility and environment | Encryption at rest, copy-to-other-row fails, production save blocked |
| E-02 | engine | can rotate and remove credentials, with an audit trail that holds no secret | Auditability |
| E-03 | engine | sends a write once; replays never send again | Idempotency, same key + different body refused |
| E-04 | engine | lets only one of many concurrent workers send the same write | Concurrency |
| E-05 | engine | holds a write whose answer was lost, never resends blindly, settles by lookup | Recovery after unknown outcome |
| E-06 | engine | resends once the state confirms it was never applied | Recovery after timeout before apply |
| E-07 | engine | asks a person to settle when the state can't be asked, and needs a note | Manual resolution, facility authorization, audit |
| E-08 | engine | classifies refusals | Network, auth, rate limit, malformed, rejected, forbidden |
| E-09 | engine | treats a request left in flight by a stopped worker as unknown | Crash recovery |
| E-10 | engine | refuses production; simulator can't stand in | Environment safety |
| E-11 | engine | never puts a credential in the ledger or the audit log | No leakage |
| E-12 | engine | reports a real adjustment and split through the sync queue, once each | End to end from inventory engine; id mapping; merges stay manual |
| E-13 | engine | holds the facility's queue behind a lost answer, in order, and recovers | Ordering, pending-outcome reconciliation |
| E-14 | engine | reconciles read-only, keeps facilities apart, saves a permanent record | Data integrity, isolation, immutability, link confirmation |
| E-15 | engine | retries a read page after a temporary failure; stops on permission failure | Read recovery |
| C-01..03 | contract | capabilities, pagination, bad credentials | The behavior any transport must have (simulator now; official later) |
| C-04 | contract | request key not applied twice | Skipped for official unless UAT writes are explicitly allowed |

Regression: the existing 407 vitest tests and 76 Playwright tests pass unchanged.

## Planned UAT cases (NOT executed: need specification and credentials)

| ID | Case | Expected | Evidence |
|---|---|---|---|
| UAT-01 | Authenticate with issued UAT credentials | Success; bad credentials refused | evidence-template §1 |
| UAT-02 | Read all packages for the UAT license, all pages | Count matches the UAT UI | §2 |
| UAT-03 | Read all plants | Count matches the UAT UI | §2 |
| UAT-04 | Credentials for license A cannot read license B | Refused | §3 |
| UAT-05 | Adjust a UAT test package | Applied once; state quantity matches | §4 |
| UAT-06 | Resend UAT-05 with the same key | Not applied twice (or documented behavior) | §4 |
| UAT-07 | Split a UAT test package | Child exists; id returned and linked | §4 |
| UAT-08 | Malformed request | Documented error, mapped to MALFORMED | §5 |
| UAT-09 | Rate limit | Documented throttle response; nothing applied twice | §5 |
| UAT-10 | Force a client timeout on a write, then look it up | Outcome determinable; ledger settles correctly | §6 |
| UAT-11 | Reconcile the UAT license | Every difference explained | §7 |
| UAT-12 | Credential rotation | Old credentials refused, new ones work | §1 |
