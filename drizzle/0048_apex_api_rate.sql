CREATE TABLE "api_rate_windows" (
	"key_id" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "api_rate_windows_key_id_window_start_pk" PRIMARY KEY("key_id","window_start")
);
