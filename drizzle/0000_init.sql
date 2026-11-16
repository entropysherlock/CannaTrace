CREATE TYPE "public"."license_type" AS ENUM('CULTIVATION', 'MANUFACTURING', 'DISTRIBUTION', 'RETAIL', 'MICROBUSINESS');--> statement-breakpoint
CREATE TYPE "public"."location_type" AS ENUM('ROOM', 'RACK', 'BIN');--> statement-breakpoint
CREATE TYPE "public"."package_status" AS ENUM('ACTIVE', 'ON_HOLD', 'QUARANTINE', 'FINISHED', 'DESTROYED');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('OWNER', 'MANAGER', 'INVENTORY', 'CULTIVATION', 'SALES', 'BUDTENDER', 'READ_ONLY');--> statement-breakpoint
CREATE TYPE "public"."track_trace_system" AS ENUM('MOCK', 'METRC', 'BIOTRACK');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('RECEIVE', 'MOVE', 'ADJUST', 'SPLIT_OUT', 'SPLIT_IN', 'MERGE_OUT', 'MERGE_IN', 'CONVERT_OUT', 'CONVERT_IN', 'SELL', 'DESTROY', 'STATUS_CHANGE');--> statement-breakpoint
CREATE TYPE "public"."unit" AS ENUM('MG', 'G', 'KG', 'OZ', 'LB', 'ML', 'L', 'EACH');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text,
	"user_id" text NOT NULL,
	"user_name" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"license_number" text NOT NULL,
	"license_type" "license_type" NOT NULL,
	"state" text NOT NULL,
	"track_trace_system" "track_trace_system" DEFAULT 'MOCK' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"package_id" text NOT NULL,
	"type" "transaction_type" NOT NULL,
	"quantity_delta" numeric(18, 4) NOT NULL,
	"quantity_before" numeric(18, 4) NOT NULL,
	"quantity_after" numeric(18, 4) NOT NULL,
	"unit" "unit" NOT NULL,
	"from_location_id" text,
	"to_location_id" text,
	"reason_code" text,
	"note" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"sku" text NOT NULL,
	"category_id" text NOT NULL,
	"unit" "unit" NOT NULL,
	"strain" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "location_type" NOT NULL,
	"parent_id" text
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_lineage" (
	"parent_id" text NOT NULL,
	"child_id" text NOT NULL,
	CONSTRAINT "package_lineage_parent_id_child_id_pk" PRIMARY KEY("parent_id","child_id")
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"tag" text NOT NULL,
	"item_id" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"unit" "unit" NOT NULL,
	"location_id" text,
	"status" "package_status" DEFAULT 'ACTIVE' NOT NULL,
	"lot_number" text,
	"cost_per_unit" numeric(18, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" DEFAULT 'READ_ONLY' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_categories" ADD CONSTRAINT "item_categories_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_category_id_item_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."item_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_lineage" ADD CONSTRAINT "package_lineage_parent_id_packages_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_lineage" ADD CONSTRAINT "package_lineage_child_id_packages_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("org_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_time_idx" ON "audit_logs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "facilities_org_license_key" ON "facilities" USING btree ("org_id","license_number");--> statement-breakpoint
CREATE INDEX "inventory_transactions_scope_idx" ON "inventory_transactions" USING btree ("org_id","facility_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_transactions_package_idx" ON "inventory_transactions" USING btree ("package_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_categories_org_name_key" ON "item_categories" USING btree ("org_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "items_org_sku_key" ON "items" USING btree ("org_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_facility_name_key" ON "locations" USING btree ("facility_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "packages_org_tag_key" ON "packages" USING btree ("org_id","tag");--> statement-breakpoint
CREATE INDEX "packages_scope_status_idx" ON "packages" USING btree ("org_id","facility_id","status");--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("org_id");