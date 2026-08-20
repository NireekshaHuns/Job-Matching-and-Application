CREATE TABLE "enrichment_failures" (
	"fingerprint" text PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"last_error" text,
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL
);
