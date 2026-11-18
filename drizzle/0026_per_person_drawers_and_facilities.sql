ALTER TABLE "drawer_sessions" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "facility_ids" text[];--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_facility_id" text;--> statement-breakpoint
ALTER TABLE "drawer_sessions" ADD CONSTRAINT "drawer_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drawer_sessions_user_idx" ON "drawer_sessions" USING btree ("facility_id","user_id","status");