CREATE TYPE "public"."job_status" AS ENUM('active', 'closed');--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "source_job_id" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "status" "job_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jobs_last_seen_at_idx" ON "jobs" USING btree ("last_seen_at");