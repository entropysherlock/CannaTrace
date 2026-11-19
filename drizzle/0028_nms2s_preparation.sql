CREATE TYPE "public"."nms2s_environment" AS ENUM('UAT', 'PRODUCTION');--> statement-breakpoint
CREATE TABLE "nms2s_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"environment" "nms2s_environment" NOT NULL,
	"sealed" text NOT NULL,
	"field_hints" jsonb NOT NULL,
	"saved_by_name" text NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nms2s_id_map" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"environment" "nms2s_environment" NOT NULL,
	"entity_type" text NOT NULL,
	"local_id" text NOT NULL,
	"state_id" text NOT NULL,
	"source" text NOT NULL,
	"confirmed_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nms2s_reconciliations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"environment" "nms2s_environment" NOT NULL,
	"transport" text NOT NULL,
	"started_by_name" text NOT NULL,
	"counts" jsonb NOT NULL,
	"findings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nms2s_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"environment" "nms2s_environment" NOT NULL,
	"transport" text NOT NULL,
	"operation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"local_entity_type" text NOT NULL,
	"local_entity_id" text NOT NULL,
	"sync_event_id" text,
	"status" text DEFAULT 'PREPARED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"last_error_kind" text,
	"last_error_detail" text,
	"state_reference" text,
	"resolved_by_name" text,
	"resolved_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nms2s_credentials" ADD CONSTRAINT "nms2s_credentials_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nms2s_id_map" ADD CONSTRAINT "nms2s_id_map_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nms2s_reconciliations" ADD CONSTRAINT "nms2s_reconciliations_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nms2s_requests" ADD CONSTRAINT "nms2s_requests_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nms2s_credentials_scope_key" ON "nms2s_credentials" USING btree ("facility_id","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "nms2s_id_map_local_key" ON "nms2s_id_map" USING btree ("facility_id","environment","entity_type","local_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nms2s_id_map_state_key" ON "nms2s_id_map" USING btree ("facility_id","environment","entity_type","state_id");--> statement-breakpoint
CREATE INDEX "nms2s_reconciliations_scope_idx" ON "nms2s_reconciliations" USING btree ("facility_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "nms2s_requests_key" ON "nms2s_requests" USING btree ("facility_id","environment","idempotency_key");--> statement-breakpoint
CREATE INDEX "nms2s_requests_status_idx" ON "nms2s_requests" USING btree ("facility_id","environment","status");--> statement-breakpoint
CREATE TRIGGER nms2s_reconciliations_immutable
  BEFORE UPDATE OR DELETE ON "nms2s_reconciliations"
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
