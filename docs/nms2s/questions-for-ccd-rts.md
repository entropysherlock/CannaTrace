# Questions requiring answers from CCD/RTS

Send these to CCD (Compliance Manager) and the NMS2S vendor/RTS contact. Each answer unblocks the item in brackets.

## Access and environments
1. What is the integrator enrollment process and timeline, and what does CannaTrace need to submit? [B-1]
2. What are the UAT and production base URLs? Is there a separate sandbox per integrator? [capability 1]
3. Will UAT come with test licenses, plants and packages, and can it be reset? [B-3]
4. What does production approval require (test evidence, a demo, a security review)? [B-4]

## Authentication
5. What authentication scheme is used? Which credentials are issued to the integrator, and which to each licensee? [capability 2]
6. Does one credential cover several licenses, and how does a licensee authorize an integrator? [capability 3]
7. How are credentials rotated or revoked, and do they expire? [UAT-12]
8. Are there IP allowlists, mutual TLS or request-signing requirements? [security 21, 22]

## Data and reads
9. What are the endpoints and fields for packages and plants, including how results are filtered by license and by last-modified time? [capabilities 4, 5]
10. How does pagination work (cursor or offset), and what are the page size limits? [capability 6]
11. What is the complete list of package and plant status values, and what does each mean? [G-2]
12. What units of measure are accepted, and how are they spelled? [capability 20]
13. What is the format of state identifiers? Is a tag ever re-issued? [capability 21]

## Writes
14. Which operations are available: adjustments (and their reason codes), splits, merges, production, harvest, waste, destruction, plant lifecycle, transfers, sales, lab results? [workflow-mapping]
15. Does the API accept a client-supplied idempotency key or reference? If a request is resent with the same key, what happens? [capability 15]
16. Can the outcome of a write be looked up afterwards by our reference? [capability 16]
17. Is a write that receives a 5xx, a timeout or a rate-limit response ever applied? [errors.ts policy]
18. Are writes accepted in batches? If so, are batches all-or-nothing? [ledger design]
19. Do records have a backdating window or a cut-off time? [queue backlog behavior]

## Errors and limits
20. What is the error response format, and what is the list of error codes? [capability 17]
21. What are the rate limits (per integrator, license or endpoint), and which headers signal them? [capability 18, G-6]
22. Are there maintenance windows or a status page? [operations]

## Compliance and records
23. When NMS2S and an integrator disagree, what is the correction process? Who may correct records, and how? [reconciliation actions]
24. How long must integrators keep request logs? [G-9]
25. Is there an integrator certification or test script that CannaTrace must pass? [evidence-template]
