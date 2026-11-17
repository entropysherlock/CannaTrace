CREATE TYPE "public"."label_kind" AS ENUM('PLANT', 'BATCH', 'PACKAGE', 'PRODUCT', 'TRANSFER');--> statement-breakpoint
CREATE TYPE "public"."print_job_status" AS ENUM('QUEUED', 'RENDERED', 'PRINTED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "label_template_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"version" integer NOT NULL,
	"width_mm" numeric(7, 2) NOT NULL,
	"height_mm" numeric(7, 2) NOT NULL,
	"elements" jsonb NOT NULL,
	"note" text,
	"user_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "label_kind" NOT NULL,
	"jurisdiction" text,
	"current_version" integer DEFAULT 1 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "print_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"template_id" text NOT NULL,
	"template_version" integer NOT NULL,
	"printer_profile_id" text,
	"source_type" "label_kind" NOT NULL,
	"source_ids" jsonb NOT NULL,
	"copies" integer DEFAULT 1 NOT NULL,
	"label_count" integer NOT NULL,
	"status" "print_job_status" DEFAULT 'QUEUED' NOT NULL,
	"idempotency_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"reprint_of" text,
	"warnings" jsonb,
	"user_id" text NOT NULL,
	"user_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "printer_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"name" text NOT NULL,
	"adapter" text DEFAULT 'BROWSER_PDF' NOT NULL,
	"offset_x_mm" numeric(6, 2) DEFAULT '0' NOT NULL,
	"offset_y_mm" numeric(6, 2) DEFAULT '0' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "label_template_versions" ADD CONSTRAINT "label_template_versions_template_id_label_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."label_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_templates" ADD CONSTRAINT "label_templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_templates" ADD CONSTRAINT "label_templates_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_template_id_label_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."label_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_printer_profile_id_printer_profiles_id_fk" FOREIGN KEY ("printer_profile_id") REFERENCES "public"."printer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printer_profiles" ADD CONSTRAINT "printer_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printer_profiles" ADD CONSTRAINT "printer_profiles_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "label_template_versions_key" ON "label_template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "label_templates_facility_name_key" ON "label_templates" USING btree ("facility_id","name");--> statement-breakpoint
CREATE INDEX "label_templates_scope_idx" ON "label_templates" USING btree ("org_id","facility_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "print_jobs_idempotency_key" ON "print_jobs" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "print_jobs_scope_idx" ON "print_jobs" USING btree ("org_id","facility_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "printer_profiles_facility_name_key" ON "printer_profiles" USING btree ("facility_id","name");