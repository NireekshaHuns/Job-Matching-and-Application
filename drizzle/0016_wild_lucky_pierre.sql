ALTER TABLE "jobs" ADD COLUMN "salary_min_usd" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "salary_max_usd" integer;--> statement-breakpoint
CREATE INDEX "jobs_salary_max_usd_idx" ON "jobs" USING btree ("salary_max_usd");