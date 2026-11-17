CREATE TABLE "ai_connections" (
	"org_id" text PRIMARY KEY NOT NULL,
	"encrypted_key" text NOT NULL,
	"key_hint" text NOT NULL,
	"model" text NOT NULL,
	"available_models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'CONNECTED' NOT NULL,
	"status_message" text,
	"checked_at" timestamp with time zone,
	"connected_by_name" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"daily_limit" integer DEFAULT 300 NOT NULL,
	"monthly_limit" integer DEFAULT 5000 NOT NULL,
	"per_person_daily_limit" integer DEFAULT 60 NOT NULL,
	"max_answer_tokens" integer DEFAULT 2048 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text NOT NULL,
	"facility_id" text,
	"billed_to" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"outcome" text NOT NULL,
	"support_visit" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_connections" ADD CONSTRAINT "ai_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_org_time_idx" ON "ai_usage" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_user_time_idx" ON "ai_usage" USING btree ("org_id","user_id","created_at");