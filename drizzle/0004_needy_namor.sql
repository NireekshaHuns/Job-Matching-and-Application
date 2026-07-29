ALTER TABLE "applications" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "confirmation_email_id" text;