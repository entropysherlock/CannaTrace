CREATE TABLE "online_menus" (
	"facility_id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"slug" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"take_reservations" boolean DEFAULT true NOT NULL,
	"welcome" text,
	"pickup_note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservation_lines" (
	"reservation_id" text NOT NULL,
	"item_id" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	CONSTRAINT "reservation_lines_reservation_id_item_id_pk" PRIMARY KEY("reservation_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'NEW' NOT NULL,
	"customer_name" text NOT NULL,
	"phone" text NOT NULL,
	"note" text,
	"sale_id" text,
	"handled_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "online_menus" ADD CONSTRAINT "online_menus_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_lines" ADD CONSTRAINT "reservation_lines_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_lines" ADD CONSTRAINT "reservation_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "online_menus_slug_key" ON "online_menus" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_facility_number_key" ON "reservations" USING btree ("facility_id","number");--> statement-breakpoint
CREATE INDEX "reservations_queue_idx" ON "reservations" USING btree ("facility_id","status","created_at");