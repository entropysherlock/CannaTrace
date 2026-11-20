CREATE TABLE "device_pairings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linked_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tally_attachments" ADD COLUMN "source" text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "tally_attachments" ADD COLUMN "device_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "device_pairings_code_key" ON "device_pairings" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "linked_devices_token_key" ON "linked_devices" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "linked_devices_user_idx" ON "linked_devices" USING btree ("org_id","user_id");