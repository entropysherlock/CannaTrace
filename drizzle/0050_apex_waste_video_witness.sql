ALTER TABLE "facilities" ADD COLUMN "waste_witness_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "adjust_approval_percent" integer DEFAULT 25;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD COLUMN "video_camera" text;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD COLUMN "video_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD COLUMN "witness_name" text;