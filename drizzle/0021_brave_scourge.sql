ALTER TABLE "resume_profile" ADD COLUMN "coursework" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "resume_profile" ADD COLUMN "project_name" text;--> statement-breakpoint
ALTER TABLE "resume_profile" ADD COLUMN "project_url" text;