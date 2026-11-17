CREATE TABLE "destinations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"vendor_id" text NOT NULL,
	"name" text NOT NULL,
	"license_number" text NOT NULL,
	"license_type" text NOT NULL,
	"license_expires" text NOT NULL,
	"license_verified_at" timestamp with time zone,
	"license_verified_by" text,
	"address" text,
	"contact_name" text,
	"phone" text,
	"email" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "we_sell_to" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "we_buy_from" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "destination_id" text;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "vendor_id" text;--> statement-breakpoint
ALTER TABLE "destinations" ADD CONSTRAINT "destinations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "destinations" ADD CONSTRAINT "destinations_vendor_id_customers_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "destinations_vendor_license_key" ON "destinations" USING btree ("vendor_id","license_number");--> statement-breakpoint
CREATE INDEX "destinations_org_idx" ON "destinations" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Every existing customer becomes a vendor with one destination: its own licensed location.
INSERT INTO "destinations" ("id", "org_id", "vendor_id", "name", "license_number", "license_type", "license_expires", "license_verified_at", "license_verified_by", "address", "contact_name", "phone", "email", "active")
SELECT gen_random_uuid()::text, c."org_id", c."id", c."name", c."license_number", c."license_type", c."license_expires", c."license_verified_at", c."license_verified_by", c."address", c."contact_name", c."phone", c."email", c."active"
FROM "customers" c;
--> statement-breakpoint
UPDATE "orders" o SET "destination_id" = d."id" FROM "destinations" d WHERE d."vendor_id" = o."customer_id" AND o."destination_id" IS NULL;
