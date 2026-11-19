CREATE TABLE "sign_in_failures" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sign_in_failures_key_idx" ON "sign_in_failures" USING btree ("key","created_at");