ALTER TABLE "users" ADD COLUMN "morning_brief" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "morning_brief_sent_on" text;