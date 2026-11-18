CREATE TABLE "id_counters" (
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "id_counters_org_id_kind_pk" PRIMARY KEY("org_id","kind")
);
--> statement-breakpoint
ALTER TABLE "id_counters" ADD CONSTRAINT "id_counters_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;