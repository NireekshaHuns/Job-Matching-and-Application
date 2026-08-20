CREATE TABLE "metered_source_usage" (
	"source" text PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"requests_used" integer DEFAULT 0 NOT NULL,
	"last_run_date" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
