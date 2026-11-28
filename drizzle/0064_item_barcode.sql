ALTER TABLE "items" ADD COLUMN "barcode" text;--> statement-breakpoint
CREATE UNIQUE INDEX "items_org_barcode_key" ON "items" USING btree ("org_id","barcode") WHERE "items"."barcode" is not null;