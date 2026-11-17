CREATE TABLE "tally_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"size" integer NOT NULL,
	"status" text DEFAULT 'UPLOADING' NOT NULL,
	"received" integer DEFAULT 0 NOT NULL,
	"staging" "bytea",
	"payload" "bytea",
	"meta" jsonb,
	"sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tally_attachments_owner_idx" ON "tally_attachments" USING btree ("org_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "tally_attachments_expiry_idx" ON "tally_attachments" USING btree ("expires_at");