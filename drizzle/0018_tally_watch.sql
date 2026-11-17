CREATE TABLE "state_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"file_name" text NOT NULL,
	"uploaded_by_name" text NOT NULL,
	"rows" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watch_findings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"key" text NOT NULL,
	"check" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"permission" text,
	"href" text,
	"fix" jsonb,
	"ask" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"dismissed_by_name" text
);
--> statement-breakpoint
CREATE TABLE "watch_sweeps" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"open" integer NOT NULL,
	"opened" integer NOT NULL,
	"resolved" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "state_reports_facility_idx" ON "state_reports" USING btree ("facility_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watch_findings_facility_key" ON "watch_findings" USING btree ("facility_id","key");--> statement-breakpoint
CREATE INDEX "watch_findings_open_idx" ON "watch_findings" USING btree ("org_id","facility_id","status");--> statement-breakpoint
CREATE INDEX "watch_sweeps_facility_idx" ON "watch_sweeps" USING btree ("facility_id","created_at");