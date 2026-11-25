ALTER TABLE "packages" ALTER COLUMN "cost_per_unit" SET DATA TYPE numeric(18, 8);--> statement-breakpoint
ALTER TABLE "production_inputs" ALTER COLUMN "cost_per_unit" SET DATA TYPE numeric(18, 8);--> statement-breakpoint
ALTER TABLE "production_runs" ALTER COLUMN "cost_per_unit" SET DATA TYPE numeric(18, 8);--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "promo_discount" numeric(18, 2) DEFAULT '0' NOT NULL;