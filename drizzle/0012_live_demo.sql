ALTER TABLE "organizations" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "demo_day" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "demo_ready" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "demo_assistant_calls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_demo_day_unique" UNIQUE("demo_day");