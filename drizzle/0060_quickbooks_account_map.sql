CREATE TABLE "quickbooks_account_map" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"category_key" text NOT NULL,
	"account_id" text NOT NULL,
	"account_name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quickbooks_account_map" ADD CONSTRAINT "quickbooks_account_map_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quickbooks_account_map_key" ON "quickbooks_account_map" USING btree ("org_id","category_key");