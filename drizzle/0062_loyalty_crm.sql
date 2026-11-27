CREATE TABLE "brand_sponsorships" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"promo_id" text NOT NULL,
	"brand_name" text NOT NULL,
	"funded_percent" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"member_id" text NOT NULL,
	"campaign_id" text,
	"automation_kind" text,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_automations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"channel" text DEFAULT 'EMAIL' NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"channel" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"segment" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"sent_by" text,
	"recipient_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_settings" (
	"org_id" text PRIMARY KEY NOT NULL,
	"disclaimer" text DEFAULT 'Please Consume Responsibly.' NOT NULL,
	"quiet_start" text DEFAULT '21:00' NOT NULL,
	"quiet_end" text DEFAULT '08:00' NOT NULL,
	"max_per_week" integer DEFAULT 3 NOT NULL,
	"referral_bonus" integer DEFAULT 50 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_consents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"member_id" text NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"method" text NOT NULL,
	"wording" text,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_boosts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"earn_percent" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_tiers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"min_spend" numeric(18, 2) DEFAULT '0' NOT NULL,
	"earn_percent" integer DEFAULT 100 NOT NULL,
	"perk" text
);
--> statement-breakpoint
ALTER TABLE "reward_members" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "reward_members" ADD COLUMN "card_token" text;--> statement-breakpoint
ALTER TABLE "reward_members" ADD COLUMN "referral_code" text;--> statement-breakpoint
ALTER TABLE "reward_members" ADD COLUMN "referred_by_id" text;--> statement-breakpoint
ALTER TABLE "reward_members" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "reward_members" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "brand_sponsorships" ADD CONSTRAINT "brand_sponsorships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_sponsorships" ADD CONSTRAINT "brand_sponsorships_promo_id_promotions_id_fk" FOREIGN KEY ("promo_id") REFERENCES "public"."promotions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_messages" ADD CONSTRAINT "campaign_messages_member_id_reward_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."reward_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_messages" ADD CONSTRAINT "campaign_messages_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_automations" ADD CONSTRAINT "marketing_automations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_settings" ADD CONSTRAINT "marketing_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_consents" ADD CONSTRAINT "member_consents_member_id_reward_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."reward_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_boosts" ADD CONSTRAINT "reward_boosts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_tiers" ADD CONSTRAINT "reward_tiers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_sponsorships_promo_key" ON "brand_sponsorships" USING btree ("promo_id");--> statement-breakpoint
CREATE INDEX "campaign_messages_member_idx" ON "campaign_messages" USING btree ("member_id","sent_at");--> statement-breakpoint
CREATE INDEX "campaign_messages_campaign_idx" ON "campaign_messages" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_automations_org_kind_key" ON "marketing_automations" USING btree ("org_id","kind");--> statement-breakpoint
CREATE INDEX "marketing_campaigns_org_idx" ON "marketing_campaigns" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "member_consents_member_idx" ON "member_consents" USING btree ("member_id","channel","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reward_tiers_org_name_key" ON "reward_tiers" USING btree ("org_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "reward_members_card_token_key" ON "reward_members" USING btree ("card_token") WHERE "reward_members"."card_token" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "reward_members_org_referral_key" ON "reward_members" USING btree ("org_id","referral_code") WHERE "reward_members"."referral_code" is not null;--> statement-breakpoint
CREATE INDEX "sales_reward_member_idx" ON "sales" USING btree ("reward_member_id","completed_at");