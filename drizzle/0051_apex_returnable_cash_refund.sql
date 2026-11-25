ALTER TABLE "items" ADD COLUMN "returnable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD COLUMN "cash_amount" numeric(18, 2);