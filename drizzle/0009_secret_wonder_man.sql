CREATE TYPE "public"."filing_type" AS ENUM('change_of_status', 'consular', 'unknown');--> statement-breakpoint
CREATE TABLE "profile" (
	"id" serial PRIMARY KEY NOT NULL,
	"opt_end_date" date,
	"stem_opt_end_date" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "filing_type" "filing_type" DEFAULT 'unknown' NOT NULL;