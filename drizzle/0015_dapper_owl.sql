ALTER TABLE "jobs" RENAME COLUMN "posted_date" TO "posted_at";--> statement-breakpoint
-- drizzle-kit emits the rename but not the accompanying type change, so this is
-- written by hand to match the 0015 snapshot (timestamp with time zone).
-- Existing values are calendar dates with no clock component: pin them to
-- midnight UTC explicitly rather than letting the cast use the session timezone,
-- so the result does not depend on who runs the migration.
ALTER TABLE "jobs" ALTER COLUMN "posted_at" TYPE timestamp with time zone
  USING ("posted_at"::timestamp AT TIME ZONE 'UTC');
