CREATE TYPE "public"."run_status" AS ENUM('IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "bom_lines" (
	"bom_id" text NOT NULL,
	"item_id" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	CONSTRAINT "bom_lines_bom_id_item_id_pk" PRIMARY KEY("bom_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "boms" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"output_item_id" text NOT NULL,
	"output_quantity" numeric(18, 4) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_inputs" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"package_id" text NOT NULL,
	"item_id" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"unit" "unit" NOT NULL,
	"cost_per_unit" numeric(18, 4),
	"user_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"name" text NOT NULL,
	"bom_id" text NOT NULL,
	"output_item_id" text NOT NULL,
	"batches" numeric(18, 4) NOT NULL,
	"planned_output" numeric(18, 4) NOT NULL,
	"actual_output" numeric(18, 4),
	"output_package_id" text,
	"input_cost" numeric(18, 4),
	"extra_cost" numeric(18, 4),
	"cost_per_unit" numeric(18, 4),
	"loss_note" text,
	"status" "run_status" DEFAULT 'IN_PROGRESS' NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_bom_id_boms_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."boms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boms" ADD CONSTRAINT "boms_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boms" ADD CONSTRAINT "boms_output_item_id_items_id_fk" FOREIGN KEY ("output_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_inputs" ADD CONSTRAINT "production_inputs_run_id_production_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."production_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_inputs" ADD CONSTRAINT "production_inputs_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_inputs" ADD CONSTRAINT "production_inputs_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_bom_id_boms_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."boms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_output_item_id_items_id_fk" FOREIGN KEY ("output_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_output_package_id_packages_id_fk" FOREIGN KEY ("output_package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "boms_org_name_key" ON "boms" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "production_inputs_run_idx" ON "production_inputs" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_runs_facility_name_key" ON "production_runs" USING btree ("facility_id","name");--> statement-breakpoint
CREATE INDEX "production_runs_scope_idx" ON "production_runs" USING btree ("org_id","facility_id","status");