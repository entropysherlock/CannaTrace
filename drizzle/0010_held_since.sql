ALTER TABLE "packages" ADD COLUMN "held_since" timestamp with time zone;--> statement-breakpoint
-- Packages already on hold: start their clock from when their status last changed.
UPDATE "packages" p SET "held_since" = coalesce(
  (SELECT max(t.created_at) FROM "inventory_transactions" t WHERE t.package_id = p.id AND t.type = 'STATUS_CHANGE'),
  p.created_at
) WHERE p.status IN ('ON_HOLD', 'QUARANTINE');
