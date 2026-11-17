CREATE TABLE "password_resets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by_name" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_resets_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "sale_return_lines" (
	"return_id" text NOT NULL,
	"sale_line_id" text NOT NULL,
	"package_id" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	CONSTRAINT "sale_return_lines_return_id_sale_line_id_package_id_pk" PRIMARY KEY("return_id","sale_line_id","package_id")
);
--> statement-breakpoint
CREATE TABLE "sale_returns" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"sale_id" text NOT NULL,
	"number" text NOT NULL,
	"refund_method" text NOT NULL,
	"drawer_session_id" text,
	"amount" numeric(18, 2) NOT NULL,
	"disposition" text NOT NULL,
	"reason" text NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "retail_settings" ADD COLUMN "daily_limits" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "retail_settings" ADD COLUMN "receipt_warning" text;--> statement-breakpoint
ALTER TABLE "retail_settings" ADD COLUMN "label_warning" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "customer_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_return_id_sale_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sale_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_sale_line_id_sale_lines_id_fk" FOREIGN KEY ("sale_line_id") REFERENCES "public"."sale_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_drawer_session_id_drawer_sessions_id_fk" FOREIGN KEY ("drawer_session_id") REFERENCES "public"."drawer_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "password_resets_user_idx" ON "password_resets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_returns_facility_number_key" ON "sale_returns" USING btree ("facility_id","number");--> statement-breakpoint
CREATE INDEX "sale_returns_sale_idx" ON "sale_returns" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_returns_drawer_idx" ON "sale_returns" USING btree ("drawer_session_id");--> statement-breakpoint
CREATE INDEX "sales_customer_day_idx" ON "sales" USING btree ("org_id","customer_key","completed_at");