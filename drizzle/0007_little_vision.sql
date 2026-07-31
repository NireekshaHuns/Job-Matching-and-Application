CREATE TYPE "public"."match_method" AS ENUM('exact', 'fuzzy', 'manual');--> statement-breakpoint
CREATE TYPE "public"."new_hire_status" AS ENUM('sponsors_new_hires', 'transfers_only', 'no_record', 'unknown');--> statement-breakpoint
CREATE TABLE "company_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"raw_name" text NOT NULL,
	"raw_name_normalized" text NOT NULL,
	"sponsor_id" integer,
	"match_confidence" real DEFAULT 0 NOT NULL,
	"match_method" "match_method" NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_aliases_raw_name_normalized_unique" UNIQUE("raw_name_normalized")
);
--> statement-breakpoint
CREATE TABLE "sponsor_filings" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_name_normalized" text NOT NULL,
	"fiscal_year" integer NOT NULL,
	"initial_approvals" integer DEFAULT 0 NOT NULL,
	"initial_denials" integer DEFAULT 0 NOT NULL,
	"continuing_approvals" integer DEFAULT 0 NOT NULL,
	"continuing_denials" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "new_hire_status" "new_hire_status" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "sponsor_match_confidence" real;--> statement-breakpoint
ALTER TABLE "sponsors" ADD COLUMN "new_employment_approvals" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sponsors" ADD COLUMN "new_employment_last_year" integer;--> statement-breakpoint
ALTER TABLE "sponsors" ADD COLUMN "new_employment_recent_years" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "company_aliases" ADD CONSTRAINT "company_aliases_sponsor_id_sponsors_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sponsor_filings_company_year_idx" ON "sponsor_filings" USING btree ("company_name_normalized","fiscal_year");--> statement-breakpoint
CREATE INDEX "jobs_new_hire_status_idx" ON "jobs" USING btree ("new_hire_status");