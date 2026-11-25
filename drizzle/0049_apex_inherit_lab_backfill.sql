-- APEX-27: packages made by a split or merge before this release carry no lab result of their own, so a state that
-- tests before retail sale could not sell them. Give each one a copy of its parent's latest passing result. Run
-- three times so a chain of splits (child of a child of a tested package) is filled in too.
INSERT INTO "lab_results" ("id", "org_id", "facility_id", "package_id", "lab_name", "sample_date", "status", "thc_percent", "cbd_percent", "notes", "coa_from_result_id", "user_id")
SELECT gen_random_uuid()::text, p."org_id", p."facility_id", p."id", a."lab_name", a."sample_date", 'PASS', a."thc_percent", a."cbd_percent",
  'Inherited from the parent package when this package was made by a split or merge.', a."id", a."user_id"
FROM "packages" p
JOIN LATERAL (
  SELECT lr.* FROM "package_lineage" l JOIN "lab_results" lr ON lr."package_id" = l."parent_id"
  WHERE l."child_id" = p."id" AND lr."status" = 'PASS'
    AND NOT EXISTS (SELECT 1 FROM "lab_results" f WHERE f."package_id" = l."parent_id" AND f."status" = 'FAIL' AND f."created_at" > lr."created_at")
  ORDER BY lr."created_at" DESC LIMIT 1
) a ON true
WHERE NOT EXISTS (SELECT 1 FROM "lab_results" x WHERE x."package_id" = p."id")
  AND (SELECT count(*) FROM "package_lineage" c WHERE c."child_id" = p."id") = 1;
--> statement-breakpoint
-- APEX-27: packages made by a split or merge before this release carry no lab result of their own, so a state that
-- tests before retail sale could not sell them. Give each one a copy of its parent's latest passing result. Run
-- three times so a chain of splits (child of a child of a tested package) is filled in too.
INSERT INTO "lab_results" ("id", "org_id", "facility_id", "package_id", "lab_name", "sample_date", "status", "thc_percent", "cbd_percent", "notes", "coa_from_result_id", "user_id")
SELECT gen_random_uuid()::text, p."org_id", p."facility_id", p."id", a."lab_name", a."sample_date", 'PASS', a."thc_percent", a."cbd_percent",
  'Inherited from the parent package when this package was made by a split or merge.', a."id", a."user_id"
FROM "packages" p
JOIN LATERAL (
  SELECT lr.* FROM "package_lineage" l JOIN "lab_results" lr ON lr."package_id" = l."parent_id"
  WHERE l."child_id" = p."id" AND lr."status" = 'PASS'
    AND NOT EXISTS (SELECT 1 FROM "lab_results" f WHERE f."package_id" = l."parent_id" AND f."status" = 'FAIL' AND f."created_at" > lr."created_at")
  ORDER BY lr."created_at" DESC LIMIT 1
) a ON true
WHERE NOT EXISTS (SELECT 1 FROM "lab_results" x WHERE x."package_id" = p."id")
  AND (SELECT count(*) FROM "package_lineage" c WHERE c."child_id" = p."id") = 1;
--> statement-breakpoint
-- APEX-27: packages made by a split or merge before this release carry no lab result of their own, so a state that
-- tests before retail sale could not sell them. Give each one a copy of its parent's latest passing result. Run
-- three times so a chain of splits (child of a child of a tested package) is filled in too.
INSERT INTO "lab_results" ("id", "org_id", "facility_id", "package_id", "lab_name", "sample_date", "status", "thc_percent", "cbd_percent", "notes", "coa_from_result_id", "user_id")
SELECT gen_random_uuid()::text, p."org_id", p."facility_id", p."id", a."lab_name", a."sample_date", 'PASS', a."thc_percent", a."cbd_percent",
  'Inherited from the parent package when this package was made by a split or merge.', a."id", a."user_id"
FROM "packages" p
JOIN LATERAL (
  SELECT lr.* FROM "package_lineage" l JOIN "lab_results" lr ON lr."package_id" = l."parent_id"
  WHERE l."child_id" = p."id" AND lr."status" = 'PASS'
    AND NOT EXISTS (SELECT 1 FROM "lab_results" f WHERE f."package_id" = l."parent_id" AND f."status" = 'FAIL' AND f."created_at" > lr."created_at")
  ORDER BY lr."created_at" DESC LIMIT 1
) a ON true
WHERE NOT EXISTS (SELECT 1 FROM "lab_results" x WHERE x."package_id" = p."id")
  AND (SELECT count(*) FROM "package_lineage" c WHERE c."child_id" = p."id") = 1;
