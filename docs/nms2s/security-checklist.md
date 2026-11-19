# Security controls checklist

Status values:
- **Done**: built and covered by a test.
- **Partial**: built but incomplete.
- **Open**: not yet done.

| # | Control | Status | Where | Test |
|---|---|---|---|---|
| 1 | No real NMS2S traffic until the spec is implemented (`OFFICIAL_SPEC = null`; the official transport refuses) | Done | config.ts, official-transport.ts | U-02, U-04 |
| 2 | Traffic requires explicit `NMS2S_TRAFFIC_ENABLED=1` | Done | config.ts | U-01 |
| 3 | Production requires an approval phrase, for both traffic and saving credentials | Done | config.ts, credentials.ts | U-01, E-01 |
| 4 | The simulator can never be used for production | Done | config.ts | U-03, E-10 |
| 5 | No URLs, endpoints or headers are hard-coded or guessed | Done | config.ts | U-01 |
| 6 | Credentials are encrypted at rest with AES-256-GCM | Done | secret-box.ts | U-09, E-01 |
| 7 | Credentials are bound to business, facility and environment, so a copied ciphertext fails | Done | credentials.ts | U-09, E-01 |
| 8 | The master key can be rotated (`AI_KEY_ENCRYPTION_KEY_PREVIOUS`) | Done (inherited) | secret-box.ts | tally-byok tests |
| 9 | Credentials never appear in the audit log, the ledger or error text | Done | redact.ts, ledger.ts | U-08, E-02, E-11 |
| 10 | Only hints (last 4 characters) are shown to people | Done | credentials.ts | E-01 |
| 11 | Credential changes are audited (save, rotate, remove) | Done | credentials.ts | E-02 |
| 12 | Every query is scoped to the session's org and facility | Done | all modules | E-07, E-14 |
| 13 | Saving credentials, settling outcomes and confirming links require `compliance.manage` | Partial | Engine functions take an `Actor`; server actions and UI are not built yet and must call `requirePermission("compliance.manage")` | — |
| 14 | No silent overwrite, deletion or fabrication of regulatory records | Done | reconcile.ts is pure; reconciliation is read-only | U-16, E-14 |
| 15 | Saved reconciliation records are immutable (DB trigger) | Done | 0028 migration | E-14 |
| 16 | Writes are applied at most once from CannaTrace's side (key, atomic claim, unknown-outcome hold) | Done | ledger.ts | E-03 to E-06, E-09 |
| 17 | A key reused with a different payload is refused | Done | ledger.ts | E-03 |
| 18 | Manual resolution requires a note and is audited with the person's name | Done | ledger.ts | E-07 |
| 19 | Lab-safety, permission and audit controls are unchanged | Done | No changes to inventory, rbac or audit | Full regression |
| 20 | Live customer data is not used in tests | Done | Tests create their own orgs | — |
| 21 | TLS, certificate pinning and allowed hosts for the official API | Open | Decide once the spec is received | — |
| 22 | Request signing, if NMS2S requires it | Open | Specification needed | — |
| 23 | Retention and deletion policy for ledger rows and reconciliation records | Open | Ask CCD about the retention period | — |
