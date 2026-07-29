ALTER TABLE "jobs" ADD COLUMN "tech_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "soft_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL;