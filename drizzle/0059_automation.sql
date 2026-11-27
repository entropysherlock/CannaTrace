CREATE TABLE "automation_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text,
	"kind" text NOT NULL,
	"outcome" text NOT NULL,
	"summary" text NOT NULL,
	"trigger" text,
	"requested_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_control" (
	"org_id" text PRIMARY KEY NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"paused_by_name" text,
	"paused_at" timestamp with time zone,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "automation_settings" (
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"mode" text DEFAULT 'OFF' NOT NULL,
	"hourly_cap" integer DEFAULT 50 NOT NULL,
	"updated_by_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_settings_org_id_kind_pk" PRIMARY KEY("org_id","kind")
);
--> statement-breakpoint
ALTER TABLE "automation_activity" ADD CONSTRAINT "automation_activity_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_activity" ADD CONSTRAINT "automation_activity_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_control" ADD CONSTRAINT "automation_control_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_settings" ADD CONSTRAINT "automation_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_activity_org_idx" ON "automation_activity" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_activity_kind_idx" ON "automation_activity" USING btree ("org_id","kind","outcome","created_at");