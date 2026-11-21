CREATE TABLE "reward_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"member_id" text NOT NULL,
	"kind" text NOT NULL,
	"points" integer NOT NULL,
	"sale_id" text,
	"note" text,
	"user_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_members" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"phone" text NOT NULL,
	"first_name" text NOT NULL,
	"birthday" text,
	"points" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"joined_by" text NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_settings" (
	"org_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"points_per_dollar" integer DEFAULT 1 NOT NULL,
	"redeem_points" integer DEFAULT 100 NOT NULL,
	"redeem_dollars" numeric(18, 2) DEFAULT '5.00' NOT NULL,
	"signup_bonus" integer DEFAULT 25 NOT NULL,
	"birthday_bonus" integer DEFAULT 50 NOT NULL,
	"expire_months" integer DEFAULT 12 NOT NULL,
	"max_share_percent" integer DEFAULT 50 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "reward_member_id" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "rewards_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "reward_discount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "points_earned" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reward_ledger" ADD CONSTRAINT "reward_ledger_member_id_reward_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."reward_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_members" ADD CONSTRAINT "reward_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_settings" ADD CONSTRAINT "reward_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reward_ledger_member_idx" ON "reward_ledger" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "reward_ledger_sale_idx" ON "reward_ledger" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reward_members_org_phone_key" ON "reward_members" USING btree ("org_id","phone");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_reward_member_id_reward_members_id_fk" FOREIGN KEY ("reward_member_id") REFERENCES "public"."reward_members"("id") ON DELETE set null ON UPDATE no action;