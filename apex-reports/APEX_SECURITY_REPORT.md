# Project Apex security report

Scope: authorization and tenant isolation of the CannaTrace application code, tested against a real database. This is not a penetration test of the deployed site, and no dependency, header or infrastructure review was done.

## Executed tests (all pass on this branch)
- Another store or another business could not complete, add to, void, or return against a cart or sale it does not own; could not move, adjust or destroy another business's package; could not add another business's item to a cart. (adversarial suite)
- Same-business cross-store attempts on the same objects were refused.
- Failed-lab product could not be sold; it could be again after a passing retest.
- Odd quantities, prices and cash amounts (negative, NaN, Infinity, 1e3, control characters) always produced a validation message, never a crash.
- Malformed CSV never raised a non-validation error.
- Replays: the same Tally confirmation used four times at once changed things once; the same offline sale sent five times was recorded once; the same package tag received four times made one package.
- Revoked devices, same-second password change, and invalid ID-barcode dates (earlier findings).

## Independent code review (read-only, three reviewers; I re-read the code behind the fixes)
- No cross-business IDOR was found in API-key routes, labels, attachments, scan, exports, assistant, session, device, invite or public-menu code.
- Confirmed and fixed: webhook SSRF filter bypass (APEX-08); offline limit-class trust (APEX-09).
- Confirmed and open: delegated-manager privilege escalation (APEX-11); facility-restricted staff editing other facilities in the same business (APEX-12).
- Lower: API rate limiting, login timing and lockout, label image beacon, license-number existence leak (APEX-19 to 21).

## Not tested
Browser-level attacks (XSS, CSRF beyond SameSite reasoning), TLS and headers, Vercel configuration, secrets management, dependency vulnerabilities, brute-force limits under load, the label-import AI prompt-injection surface, and the Dutchie importer's file parsing.

## Acceptance criterion "zero cross-org / cross-facility access"
Cross-org: no access found in tested or reviewed paths. Cross-facility within one business: **not met** until APEX-12 is fixed.
