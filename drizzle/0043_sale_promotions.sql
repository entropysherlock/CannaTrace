CREATE TABLE "sale_promotions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"sale_id" text NOT NULL,
	"promo_id" text NOT NULL,
	"promo_name" text NOT NULL,
	"line_count" integer NOT NULL,
	"amount" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sale_promotions" ADD CONSTRAINT "sale_promotions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_promotions" ADD CONSTRAINT "sale_promotions_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_promotions_org_promo_idx" ON "sale_promotions" USING btree ("org_id","promo_id");--> statement-breakpoint
CREATE INDEX "sale_promotions_sale_idx" ON "sale_promotions" USING btree ("sale_id");