ALTER TABLE "jobs" ADD COLUMN "required_years_experience" integer;--> statement-breakpoint
CREATE INDEX "jobs_required_years_idx" ON "jobs" USING btree ("required_years_experience");