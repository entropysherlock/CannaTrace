# UAT evidence record

> **Only record real UAT results here.** Simulator results belong in test-inventory.md and must never be copied into this file. Every entry needs a date, the person who ran it, and a reference to raw evidence (log excerpt with credentials redacted, screenshot of the state UI, ledger row id).

## Header

| Field | Value |
|---|---|
| Specification version and date received | |
| UAT base URL (as issued) | |
| UAT license(s) used | |
| CannaTrace commit | |
| Run by / witnessed by | |
| Dates | |

## Results

Use one row per execution. Result is Pass, Fail or Blocked. Evidence means a link, file or ledger id.

| Test ID | Date | Run by | Steps actually taken | Expected | Actual | Result | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|
| UAT-01 | | | | | | | | |
| UAT-02 | | | | | | | | |
| UAT-03 | | | | | | | | |
| UAT-04 | | | | | | | | |
| UAT-05 | | | | | | | | |
| UAT-06 | | | | | | | | |
| UAT-07 | | | | | | | | |
| UAT-08 | | | | | | | | |
| UAT-09 | | | | | | | | |
| UAT-10 | | | | | | | | |
| UAT-11 | | | | | | | | |
| UAT-12 | | | | | | | | |

## Sections

1. **Authentication and credential rotation:** UAT-01 and UAT-12.
2. **Reads and pagination:** UAT-02 and UAT-03. Record the total counts from the API and from the state UI.
3. **Isolation:** UAT-04.
4. **Writes and duplicates:** UAT-05 to UAT-07. For each, record the CannaTrace ledger row and the state's reference, and take a screenshot of the record in the state.
5. **Errors:** UAT-08 and UAT-09. Record the raw error body with credentials redacted, and the error kind CannaTrace assigned.
6. **Unknown outcomes:** UAT-10.
7. **Reconciliation:** UAT-11. Attach the saved reconciliation id and explain each difference.

## Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| CannaTrace engineering | | | |
| CannaTrace compliance | | | |
| CCD/RTS (if required) | | | |
