CREATE TYPE "public"."batch_source" AS ENUM('CLONE', 'SEED');--> statement-breakpoint
CREATE TYPE "public"."batch_status" AS ENUM('ACTIVE', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."harvest_status" AS ENUM('DRYING', 'FINISHED');--> statement-breakpoint
CREATE TYPE "public"."plant_phase" AS ENUM('VEGETATIVE', 'FLOWERING');--> statement-breakpoint
CREATE TYPE "public"."plant_status" AS ENUM('ACTIVE', 'HARVESTED', 'DESTROYED');--> statement-breakpoint
CREATE TYPE "public"."strain_type" AS ENUM('INDICA', 'SATIVA', 'HYBRID', 'CBD');--> statement-breakpoint
CREATE TABLE "cultivation_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"title" text NOT NULL,
	"due_date" text,
	"location_id" text,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"done_by_name" text,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "harvest_packages" (
	"harvest_id" text NOT NULL,
	"package_id" text NOT NULL,
	"weight_grams" numeric(18, 4) NOT NULL,
	CONSTRAINT "harvest_packages_harvest_id_package_id_pk" PRIMARY KEY("harvest_id","package_id")
);
--> statement-breakpoint
CREATE TABLE "harvests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"name" text NOT NULL,
	"strain_id" text NOT NULL,
	"location_id" text NOT NULL,
	"plant_count" integer NOT NULL,
	"wet_weight" numeric(18, 4) NOT NULL,
	"dry_weight" numeric(18, 4),
	"waste_weight" numeric(18, 4) DEFAULT '0' NOT NULL,
	"packaged_weight" numeric(18, 4) DEFAULT '0' NOT NULL,
	"moisture_loss" numeric(18, 4),
	"status" "harvest_status" DEFAULT 'DRYING' NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plant_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"name" text NOT NULL,
	"strain_id" text NOT NULL,
	"source" "batch_source" NOT NULL,
	"location_id" text NOT NULL,
	"initial_count" integer NOT NULL,
	"untagged_count" integer NOT NULL,
	"destroyed_count" integer DEFAULT 0 NOT NULL,
	"status" "batch_status" DEFAULT 'ACTIVE' NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plants" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"tag" text NOT NULL,
	"strain_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"location_id" text NOT NULL,
	"phase" "plant_phase" DEFAULT 'VEGETATIVE' NOT NULL,
	"status" "plant_status" DEFAULT 'ACTIVE' NOT NULL,
	"harvest_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"phase_changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strains" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "strain_type" NOT NULL,
	"flowering_days" integer,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waste_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"weight_grams" numeric(18, 4) NOT NULL,
	"reason" text NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cultivation_tasks" ADD CONSTRAINT "cultivation_tasks_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harvest_packages" ADD CONSTRAINT "harvest_packages_harvest_id_harvests_id_fk" FOREIGN KEY ("harvest_id") REFERENCES "public"."harvests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harvest_packages" ADD CONSTRAINT "harvest_packages_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harvests" ADD CONSTRAINT "harvests_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harvests" ADD CONSTRAINT "harvests_strain_id_strains_id_fk" FOREIGN KEY ("strain_id") REFERENCES "public"."strains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harvests" ADD CONSTRAINT "harvests_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant_batches" ADD CONSTRAINT "plant_batches_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant_batches" ADD CONSTRAINT "plant_batches_strain_id_strains_id_fk" FOREIGN KEY ("strain_id") REFERENCES "public"."strains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant_batches" ADD CONSTRAINT "plant_batches_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plants" ADD CONSTRAINT "plants_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plants" ADD CONSTRAINT "plants_strain_id_strains_id_fk" FOREIGN KEY ("strain_id") REFERENCES "public"."strains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plants" ADD CONSTRAINT "plants_batch_id_plant_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."plant_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plants" ADD CONSTRAINT "plants_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plants" ADD CONSTRAINT "plants_harvest_id_harvests_id_fk" FOREIGN KEY ("harvest_id") REFERENCES "public"."harvests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strains" ADD CONSTRAINT "strains_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cultivation_tasks_scope_idx" ON "cultivation_tasks" USING btree ("org_id","facility_id","done");--> statement-breakpoint
CREATE UNIQUE INDEX "harvests_facility_name_key" ON "harvests" USING btree ("facility_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "plant_batches_facility_name_key" ON "plant_batches" USING btree ("facility_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "plants_org_tag_key" ON "plants" USING btree ("org_id","tag");--> statement-breakpoint
CREATE INDEX "plants_scope_status_idx" ON "plants" USING btree ("org_id","facility_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "strains_org_name_key" ON "strains" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "waste_logs_scope_idx" ON "waste_logs" USING btree ("org_id","facility_id","created_at");