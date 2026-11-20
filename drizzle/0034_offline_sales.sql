ALTER TABLE "sales" ADD COLUMN "offline_id" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_facility_offline_key" ON "sales" USING btree ("facility_id","offline_id");