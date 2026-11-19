-- Every package on hold or in quarantine has a hold start, so the waste rule's waiting period can be counted.
-- Packages that were imported or seeded already held had none and could never be destroyed.
UPDATE "packages" p
SET "held_since" = COALESCE(
  (SELECT max(a."created_at") FROM "audit_logs" a
     WHERE a."entity_type" = 'Package' AND a."entity_id" = p."id" AND a."action" IN ('STATUS_CHANGE', 'HOLD', 'QUARANTINE')),
  p."created_at")
WHERE p."status" IN ('ON_HOLD', 'QUARANTINE') AND p."held_since" IS NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION packages_stamp_hold() RETURNS trigger AS $$
BEGIN
  IF NEW."status" IN ('ON_HOLD', 'QUARANTINE') AND NEW."held_since" IS NULL THEN
    NEW."held_since" := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER packages_stamp_hold
  BEFORE INSERT OR UPDATE OF "status", "held_since" ON "packages"
  FOR EACH ROW EXECUTE FUNCTION packages_stamp_hold();
