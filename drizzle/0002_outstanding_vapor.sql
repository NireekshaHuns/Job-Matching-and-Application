CREATE TYPE "public"."resume_kind" AS ENUM('base', 'tailored');--> statement-breakpoint
CREATE TYPE "public"."skill_kind" AS ENUM('technical', 'soft');--> statement-breakpoint
CREATE TABLE "master_skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"skill" text NOT NULL,
	"kind" "skill_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "master_skills_skill_unique" UNIQUE("skill")
);
--> statement-breakpoint
CREATE TABLE "resume_bullets" (
	"id" serial PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"role_family" "role_family",
	"company" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resumes" ALTER COLUMN "s3_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "resumes" ADD COLUMN "kind" "resume_kind" DEFAULT 'base' NOT NULL;--> statement-breakpoint
ALTER TABLE "resumes" ADD COLUMN "role_family" "role_family";--> statement-breakpoint
ALTER TABLE "resumes" ADD COLUMN "content" text;--> statement-breakpoint
CREATE INDEX "resume_bullets_role_family_idx" ON "resume_bullets" USING btree ("role_family");