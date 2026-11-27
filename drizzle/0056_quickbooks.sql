CREATE TABLE "quickbooks_connections" (
	"org_id" text PRIMARY KEY NOT NULL,
	"realm_id" text NOT NULL,
	"company_name" text,
	"encrypted_access" text NOT NULL,
	"encrypted_refresh" text NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'CONNECTED' NOT NULL,
	"status_message" text,
	"connected_by_name" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_summary" text
);
--> statement-breakpoint
CREATE TABLE "quickbooks_links" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"local_id" text NOT NULL,
	"qb_id" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quickbooks_connections" ADD CONSTRAINT "quickbooks_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quickbooks_links" ADD CONSTRAINT "quickbooks_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quickbooks_links_key" ON "quickbooks_links" USING btree ("org_id","kind","local_id");