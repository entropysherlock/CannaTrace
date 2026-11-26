ALTER TABLE "reward_members" ADD COLUMN "id_key" text;--> statement-breakpoint
ALTER TABLE "reward_settings" ADD COLUMN "id_lookup" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reward_members_org_id_key" ON "reward_members" USING btree ("org_id","id_key") WHERE "reward_members"."id_key" is not null;