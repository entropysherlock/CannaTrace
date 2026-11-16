CREATE TYPE "public"."sync_status" AS ENUM('PENDING', 'SENT', 'FAILED', 'MANUAL', 'RESOLVED');--> statement-breakpoint
ALTER TYPE "public"."track_trace_system" ADD VALUE 'NMS2S';--> statement-breakpoint
CREATE TABLE "sync_events" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"system" "track_trace_system" NOT NULL,
	"type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "sync_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error_code" text,
	"last_error_detail" text,
	"external_id" text,
	"resolved_by" text,
	"resolved_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_events_queue_idx" ON "sync_events" USING btree ("facility_id","status","seq");--> statement-breakpoint
CREATE INDEX "sync_events_scope_idx" ON "sync_events" USING btree ("org_id","facility_id","created_at");