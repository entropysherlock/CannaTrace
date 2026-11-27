CREATE TABLE "equipment" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"serial_number" text,
	"location_id" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"maintenance_every_days" integer,
	"calibration_every_days" integer,
	"last_maintained_on" text,
	"last_calibrated_on" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"equipment_id" text NOT NULL,
	"kind" text NOT NULL,
	"done_on" text NOT NULL,
	"note" text,
	"user_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_run_equipment" (
	"run_id" text NOT NULL,
	"equipment_id" text NOT NULL,
	"user_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_run_equipment_run_id_equipment_id_pk" PRIMARY KEY("run_id","equipment_id")
);
--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_logs" ADD CONSTRAINT "equipment_logs_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_equipment" ADD CONSTRAINT "production_run_equipment_run_id_production_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."production_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_equipment" ADD CONSTRAINT "production_run_equipment_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_facility_name_key" ON "equipment" USING btree ("facility_id","name");--> statement-breakpoint
CREATE INDEX "equipment_scope_idx" ON "equipment" USING btree ("org_id","facility_id","status");--> statement-breakpoint
CREATE INDEX "equipment_logs_equipment_idx" ON "equipment_logs" USING btree ("equipment_id","done_on");