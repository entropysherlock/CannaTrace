CREATE TABLE "scan_reads" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"user_id" text NOT NULL,
	"attachment_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'READ' NOT NULL,
	"proposal" jsonb NOT NULL,
	"result_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "scan_reads_attachment_key" ON "scan_reads" USING btree ("attachment_id");--> statement-breakpoint
CREATE INDEX "scan_reads_owner_idx" ON "scan_reads" USING btree ("org_id","user_id","created_at");