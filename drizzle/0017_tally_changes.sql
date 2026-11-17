CREATE TABLE "tally_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text NOT NULL,
	"key" text NOT NULL,
	"tool" text NOT NULL,
	"title" text NOT NULL,
	"result" text NOT NULL,
	"audit_ids" jsonb NOT NULL,
	"status" text DEFAULT 'DONE' NOT NULL,
	"not_undoable_reason" text,
	"undone_at" timestamp with time zone,
	"undone_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tally_changes_org_key" ON "tally_changes" USING btree ("org_id","key");--> statement-breakpoint
CREATE INDEX "tally_changes_scope_idx" ON "tally_changes" USING btree ("org_id","facility_id","created_at");