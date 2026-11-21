ALTER TABLE "organizations" ADD COLUMN "access_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "access_suspended_at" timestamp with time zone;