CREATE TYPE "public"."customer_type" AS ENUM('ADULT_USE', 'MEDICAL');--> statement-breakpoint
CREATE TYPE "public"."drawer_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."limit_category" AS ENUM('NONE', 'FLOWER', 'CONCENTRATE', 'EDIBLE');--> statement-breakpoint
CREATE TYPE "public"."sale_status" AS ENUM('OPEN', 'COMPLETED', 'CANCELLED', 'VOIDED');--> statement-breakpoint
CREATE TABLE "discount_presets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"percent" numeric(6, 3) NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drawer_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"status" "drawer_status" DEFAULT 'OPEN' NOT NULL,
	"opening_cash" numeric(18, 2) NOT NULL,
	"opened_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"counted_cash" numeric(18, 2),
	"expected_cash" numeric(18, 2),
	"closed_by_name" text,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "retail_prices" (
	"facility_id" text NOT NULL,
	"item_id" text NOT NULL,
	"price" numeric(18, 4) NOT NULL,
	CONSTRAINT "retail_prices_facility_id_item_id_pk" PRIMARY KEY("facility_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "retail_settings" (
	"facility_id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"flower_limit_grams" numeric(18, 4) NOT NULL,
	"concentrate_limit_grams" numeric(18, 4) NOT NULL,
	"edible_limit_mg" numeric(18, 4) NOT NULL,
	"excise_tax_percent" numeric(6, 3) NOT NULL,
	"sales_tax_percent" numeric(6, 3) NOT NULL,
	"medical_tax_exempt" boolean DEFAULT true NOT NULL,
	"adult_min_age" integer DEFAULT 21 NOT NULL,
	"medical_min_age" integer DEFAULT 18 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_line_packages" (
	"sale_line_id" text NOT NULL,
	"package_id" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	CONSTRAINT "sale_line_packages_sale_line_id_package_id_pk" PRIMARY KEY("sale_line_id","package_id")
);
--> statement-breakpoint
CREATE TABLE "sale_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"sale_id" text NOT NULL,
	"item_id" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"drawer_session_id" text NOT NULL,
	"number" text NOT NULL,
	"status" "sale_status" DEFAULT 'OPEN' NOT NULL,
	"customer_type" "customer_type" NOT NULL,
	"discount_name" text,
	"discount_percent" numeric(6, 3) DEFAULT '0' NOT NULL,
	"subtotal" numeric(18, 2),
	"discount_total" numeric(18, 2),
	"excise_tax" numeric(18, 2),
	"sales_tax" numeric(18, 2),
	"total" numeric(18, 2),
	"payment_method" text,
	"cash_tendered" numeric(18, 2),
	"change_due" numeric(18, 2),
	"void_reason" text,
	"user_id" text NOT NULL,
	"user_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "limit_category" "limit_category" DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "limit_per_unit" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "discount_presets" ADD CONSTRAINT "discount_presets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawer_sessions" ADD CONSTRAINT "drawer_sessions_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_prices" ADD CONSTRAINT "retail_prices_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_prices" ADD CONSTRAINT "retail_prices_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_settings" ADD CONSTRAINT "retail_settings_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line_packages" ADD CONSTRAINT "sale_line_packages_sale_line_id_sale_lines_id_fk" FOREIGN KEY ("sale_line_id") REFERENCES "public"."sale_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line_packages" ADD CONSTRAINT "sale_line_packages_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_drawer_session_id_drawer_sessions_id_fk" FOREIGN KEY ("drawer_session_id") REFERENCES "public"."drawer_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discount_presets_org_name_key" ON "discount_presets" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "drawer_sessions_scope_idx" ON "drawer_sessions" USING btree ("org_id","facility_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_lines_sale_item_key" ON "sale_lines" USING btree ("sale_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_facility_number_key" ON "sales" USING btree ("facility_id","number");--> statement-breakpoint
CREATE INDEX "sales_session_idx" ON "sales" USING btree ("drawer_session_id","status");