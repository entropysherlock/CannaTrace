CREATE TYPE "public"."lab_status" AS ENUM('PENDING', 'PASS', 'FAIL');--> statement-breakpoint
CREATE TABLE "cycle_count_lines" (
	"count_id" text NOT NULL,
	"package_id" text NOT NULL,
	"expected" numeric(18, 4) NOT NULL,
	"counted" numeric(18, 4) NOT NULL,
	CONSTRAINT "cycle_count_lines_count_id_package_id_pk" PRIMARY KEY("count_id","package_id")
);
--> statement-breakpoint
CREATE TABLE "cycle_counts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"location_id" text NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text NOT NULL,
	"packages_counted" integer NOT NULL,
	"variances" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_results" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"package_id" text NOT NULL,
	"lab_name" text NOT NULL,
	"sample_date" text,
	"status" "lab_status" NOT NULL,
	"thc_percent" numeric(6, 3),
	"cbd_percent" numeric(6, 3),
	"notes" text,
	"coa_file_name" text,
	"coa_mime_type" text,
	"coa_size" integer,
	"coa_data" "bytea",
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cycle_count_lines" ADD CONSTRAINT "cycle_count_lines_count_id_cycle_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."cycle_counts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_count_lines" ADD CONSTRAINT "cycle_count_lines_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_counts" ADD CONSTRAINT "cycle_counts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cycle_counts_scope_idx" ON "cycle_counts" USING btree ("org_id","facility_id","created_at");--> statement-breakpoint
CREATE INDEX "lab_results_package_idx" ON "lab_results" USING btree ("package_id");