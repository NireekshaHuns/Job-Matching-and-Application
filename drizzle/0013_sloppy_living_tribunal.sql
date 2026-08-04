ALTER TYPE "public"."resume_kind" ADD VALUE 'uploaded';--> statement-breakpoint
CREATE TABLE "resume_profile" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"phone" text,
	"linkedin_url" text,
	"github_url" text,
	"grad_date" text,
	"cert_text" text,
	"cert_url" text,
	"known_metrics" text,
	"stack_notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resume_bullets" ADD COLUMN "source_resume_id" integer;--> statement-breakpoint
ALTER TABLE "resume_bullets" ADD COLUMN "embedding" vector(1536);--> statement-breakpoint
ALTER TABLE "resume_bullets" ADD CONSTRAINT "resume_bullets_source_resume_id_resumes_id_fk" FOREIGN KEY ("source_resume_id") REFERENCES "public"."resumes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resume_bullets_source_resume_idx" ON "resume_bullets" USING btree ("source_resume_id");--> statement-breakpoint
CREATE INDEX "resume_bullets_embedding_idx" ON "resume_bullets" USING hnsw ("embedding" vector_cosine_ops);