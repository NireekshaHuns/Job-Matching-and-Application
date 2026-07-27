CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."application_source" AS ENUM('manual', 'outlook');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('saved', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('full_time', 'contract');--> statement-breakpoint
CREATE TYPE "public"."outreach_channel" AS ENUM('linkedin', 'email', 'other');--> statement-breakpoint
CREATE TYPE "public"."role_family" AS ENUM('frontend', 'backend', 'fullstack', 'sre', 'data', 'ml', 'mobile', 'systems', 'other');--> statement-breakpoint
CREATE TYPE "public"."seniority" AS ENUM('entry', 'mid', 'other');--> statement-breakpoint
CREATE TYPE "public"."sponsor_tier" AS ENUM('High', 'Medium', 'Low', 'Excluded');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"resume_id" integer,
	"status" "application_status" DEFAULT 'applied' NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "application_source" DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"linkedin_url" text
);
--> statement-breakpoint
CREATE TABLE "job_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"resume_id" integer NOT NULL,
	"relevance_score" integer NOT NULL,
	"skill_gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"source" text NOT NULL,
	"url" text NOT NULL,
	"posted_date" date,
	"company" text NOT NULL,
	"title" text NOT NULL,
	"location" text,
	"is_remote" boolean DEFAULT false NOT NULL,
	"jd_text" text NOT NULL,
	"embedding" vector(1536),
	"employment_type" "employment_type" NOT NULL,
	"role_family" "role_family",
	"seniority" "seniority",
	"sponsor_tier" "sponsor_tier" NOT NULL,
	"sponsor_reason" text,
	"sponsor_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_fingerprint_unique" UNIQUE("fingerprint")
);
--> statement-breakpoint
CREATE TABLE "outreach_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer NOT NULL,
	"contacted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" "outreach_channel" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resumes" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"s3_key" text NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sponsors" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_name_normalized" text NOT NULL,
	"sponsor_count" integer DEFAULT 0 NOT NULL,
	"approval_rate" real,
	"last_filed_year" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sponsors_company_name_normalized_unique" UNIQUE("company_name_normalized")
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_scores" ADD CONSTRAINT "job_scores_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_scores" ADD CONSTRAINT "job_scores_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_log" ADD CONSTRAINT "outreach_log_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_scores_job_resume_idx" ON "job_scores" USING btree ("job_id","resume_id");--> statement-breakpoint
CREATE INDEX "jobs_sponsor_tier_idx" ON "jobs" USING btree ("sponsor_tier");--> statement-breakpoint
CREATE INDEX "jobs_role_family_idx" ON "jobs" USING btree ("role_family");