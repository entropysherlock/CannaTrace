CREATE TABLE "reward_exclusions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketing_settings" ADD COLUMN "stack_mode" text DEFAULT 'MULTIPLY' NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_settings" ADD COLUMN "double_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reward_exclusions" ADD CONSTRAINT "reward_exclusions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reward_exclusions_key" ON "reward_exclusions" USING btree ("org_id","kind","ref_id");