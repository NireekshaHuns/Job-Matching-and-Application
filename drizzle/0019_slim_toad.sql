-- IF NOT EXISTS is deliberate and hand-added. This table was created on the
-- production branch by an earlier, differently-numbered version of this same
-- migration, before the numbering collided with the job_scores drop and had to
-- be regenerated. The table is therefore already present there while absent
-- everywhere else, and this migration has to be correct in both cases.
CREATE TABLE IF NOT EXISTS "metered_source_usage" (
	"source" text PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"requests_used" integer DEFAULT 0 NOT NULL,
	"last_run_date" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
