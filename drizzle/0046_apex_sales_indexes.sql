CREATE INDEX "sales_facility_completed_idx" ON "sales" USING btree ("facility_id","completed_at");--> statement-breakpoint
CREATE INDEX "sales_org_completed_idx" ON "sales" USING btree ("org_id","completed_at");--> statement-breakpoint
CREATE INDEX "sales_review_idx" ON "sales" USING btree ("facility_id","reviewed_at") WHERE "sales"."review_note" is not null;