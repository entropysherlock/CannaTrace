ALTER TABLE "items" ADD COLUMN "unit_weight_grams" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "servings_per_unit" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "thc_mg_per_serving" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "cbd_mg_per_serving" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "directions" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "ingredients" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "allergens" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "pesticides" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "solvents" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "must_refrigerate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "shelf_life_days" integer;--> statement-breakpoint
ALTER TABLE "lab_results" ADD COLUMN "thca_percent" numeric(6, 3);--> statement-breakpoint
ALTER TABLE "lab_results" ADD COLUMN "d9_thc_percent" numeric(6, 3);--> statement-breakpoint
ALTER TABLE "lab_results" ADD COLUMN "cbda_percent" numeric(6, 3);--> statement-breakpoint
ALTER TABLE "lab_results" ADD COLUMN "total_cbd_percent" numeric(6, 3);--> statement-breakpoint
ALTER TABLE "lab_results" ADD COLUMN "cbg_percent" numeric(6, 3);--> statement-breakpoint
ALTER TABLE "lab_results" ADD COLUMN "cbn_percent" numeric(6, 3);--> statement-breakpoint
ALTER TABLE "lab_results" ADD COLUMN "total_cannabinoids_percent" numeric(6, 3);--> statement-breakpoint
ALTER TABLE "lab_results" ADD COLUMN "terpenes" text;