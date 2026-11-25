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

## Independent code review (Apex II: three read-only reviewers on the fixed code; I re-read the code behind each fix)
- Authorization: core object access is scoped by business and facility. Confirmed and fixed: manifest takeover across facilities (APEX-34), API key and webhook revoke scoping (APEX-39). APEX-11 and APEX-12 held under review.
- Still open (Low): facility-limited staff with `users.manage` can edit roles held at other facilities and list or unlink other members' phones (APEX-42); org-level audit rows are visible to facility-limited `audit.view` holders (APEX-43); business-wide objects have no facility scope (APEX-44); some Tally read tools have no permission requirement (APEX-45); hosting-dependent items (APEX-46).
- Compliance and Tally: confirmation tokens are signed, expire, are bound to user, business and facility, and replay safe; BYOK keys are encrypted; label images are restricted to PNG and JPEG data URLs; no SVG or PDF injection found. Fixed: offline sales not queued for state reporting (APEX-32).
- The reviewers read code; the compliance reviewer ran nothing. Items marked suspected in the register were not reproduced.

## Not tested
Browser-level attacks (XSS, CSRF beyond SameSite reasoning), TLS and headers, Vercel configuration, secrets management, dependency vulnerabilities, brute-force limits under load, the label-import AI prompt-injection surface, and the Dutchie importer's file parsing.

## Acceptance criterion "zero cross-org / cross-facility access"
Cross-org: no access found in tested or reviewed paths. Cross-facility within one business: **not met**: APEX-12 and APEX-34 are fixed, but APEX-42 to 44 remain open (Low).
