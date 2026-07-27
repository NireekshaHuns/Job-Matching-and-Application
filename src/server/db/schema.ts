/**
 * Drizzle schema — the single source of truth for the database.
 *
 * Data model per CLAUDE.md, plus sourcing-driven additions (`role_family`,
 * `seniority`, `is_remote`) so we can cast a broad net over SWE titles
 * (SDE/SWE/FDE/FSE/frontend/backend/SRE + language-named roles) and filter
 * down by classification rather than by brittle title matching.
 *
 * Invariant: the two scores live in separate columns/tables — `jobs.sponsor_tier`
 * (H1B possibility) and `job_scores.relevance_score` (resume match). They are
 * never blended into one stored value. See CLAUDE.md → Domain rules.
 */
import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core';

/** OpenAI text-embedding-3-small produces 1536-dimensional vectors. */
export const EMBEDDING_DIMENSIONS = 1536;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Full-time direct-hire is kept; contract/staffing is filtered out downstream. */
export const employmentTypeEnum = pgEnum('employment_type', [
  'full_time',
  'contract',
]);

/**
 * H1B possibility tier. Never discard unknown sponsorship — tier it. Only
 * explicit disqualifiers map to `Excluded` (hidden by default, but retained).
 */
export const sponsorTierEnum = pgEnum('sponsor_tier', [
  'High',
  'Medium',
  'Low',
  'Excluded',
]);

/** Normalized role family assigned by the LLM classify step. */
export const roleFamilyEnum = pgEnum('role_family', [
  'frontend',
  'backend',
  'fullstack',
  'sre',
  'data',
  'ml',
  'mobile',
  'systems',
  'other',
]);

/** Target seniority: entry/new-grad and mid only; everything else is `other`. */
export const seniorityEnum = pgEnum('seniority', ['entry', 'mid', 'other']);

/** Application lifecycle status. */
export const applicationStatusEnum = pgEnum('application_status', [
  'saved',
  'applied',
  'interviewing',
  'offer',
  'rejected',
  'withdrawn',
]);

/** How an application row was created. */
export const applicationSourceEnum = pgEnum('application_source', [
  'manual',
  'outlook',
]);

/** Channel used for hiring-manager outreach. */
export const outreachChannelEnum = pgEnum('outreach_channel', [
  'linkedin',
  'email',
  'other',
]);

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * Per-company H1B sponsorship history, aggregated from US government data
 * (DOL OFLC LCA + USCIS H-1B Employer Data Hub). `company_name_normalized`
 * is the join key against `jobs.company` (also normalized).
 */
export const sponsors = pgTable('sponsors', {
  id: serial('id').primaryKey(),
  companyNameNormalized: text('company_name_normalized').notNull().unique(),
  /** Recency-weighted count of H1B filings / approvals (written by the pipeline). */
  sponsorCount: integer('sponsor_count').notNull().default(0),
  /** USCIS approval rate, 0–1. Null when unknown. */
  approvalRate: real('approval_rate'),
  lastFiledYear: integer('last_filed_year'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Resume "lenses"; each is embedded for per-resume relevance scoring. */
export const resumes = pgTable('resumes', {
  id: serial('id').primaryKey(),
  label: text('label').notNull(),
  s3Key: text('s3_key').notNull(),
  embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Cleaned, enriched job postings — the board's core entity. Written once per
 * new job after enrichment (dedup → sponsor match → classify → embed).
 */
export const jobs = pgTable(
  'jobs',
  {
    id: serial('id').primaryKey(),
    /** company + normalized title + location; used to dedup across sources. */
    fingerprint: text('fingerprint').notNull().unique(),
    source: text('source').notNull(),
    url: text('url').notNull(),
    postedDate: date('posted_date'),
    company: text('company').notNull(),
    title: text('title').notNull(),
    location: text('location'),
    isRemote: boolean('is_remote').notNull().default(false),
    jdText: text('jd_text').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    employmentType: employmentTypeEnum('employment_type').notNull(),
    roleFamily: roleFamilyEnum('role_family'),
    seniority: seniorityEnum('seniority'),
    // H1B possibility score — kept separate from relevance (see job_scores).
    sponsorTier: sponsorTierEnum('sponsor_tier').notNull(),
    sponsorReason: text('sponsor_reason'),
    /** Denormalized from `sponsors` at enrichment time for fast board reads. */
    sponsorCount: integer('sponsor_count'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('jobs_sponsor_tier_idx').on(t.sponsorTier),
    index('jobs_role_family_idx').on(t.roleFamily),
  ],
);

/**
 * Resume-relevance score, one row per (job × resume). Deliberately a separate
 * table from `jobs` so relevance can never be blended with the sponsor tier.
 */
export const jobScores = pgTable(
  'job_scores',
  {
    id: serial('id').primaryKey(),
    jobId: integer('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    resumeId: integer('resume_id')
      .notNull()
      .references(() => resumes.id, { onDelete: 'cascade' }),
    /** 0–100 relevance of this job to this resume. */
    relevanceScore: integer('relevance_score').notNull(),
    /** Skills the JD requires that the resume is missing (e.g. ["Kafka", "Go"]). */
    skillGaps: jsonb('skill_gaps').$type<string[]>().notNull().default([]),
    scoredAt: timestamp('scored_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('job_scores_job_resume_idx').on(t.jobId, t.resumeId)],
);

/** Applications the user has submitted (manually or imported from Outlook). */
export const applications = pgTable('applications', {
  id: serial('id').primaryKey(),
  jobId: integer('job_id')
    .notNull()
    .references(() => jobs.id, { onDelete: 'cascade' }),
  resumeId: integer('resume_id').references(() => resumes.id, {
    onDelete: 'set null',
  }),
  status: applicationStatusEnum('status').notNull().default('applied'),
  appliedAt: timestamp('applied_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  source: applicationSourceEnum('source').notNull().default('manual'),
});

/** Hiring-manager / recruiter contacts associated with a job. */
export const contacts = pgTable('contacts', {
  id: serial('id').primaryKey(),
  jobId: integer('job_id')
    .notNull()
    .references(() => jobs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  title: text('title'),
  linkedinUrl: text('linkedin_url'),
});

/** Log of outreach touches per contact (drives the daily outreach count). */
export const outreachLog = pgTable('outreach_log', {
  id: serial('id').primaryKey(),
  contactId: integer('contact_id')
    .notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  contactedAt: timestamp('contacted_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  channel: outreachChannelEnum('channel').notNull(),
});

// ---------------------------------------------------------------------------
// Relations (for Drizzle's relational query API)
// ---------------------------------------------------------------------------

export const jobsRelations = relations(jobs, ({ many }) => ({
  scores: many(jobScores),
  applications: many(applications),
  contacts: many(contacts),
}));

export const resumesRelations = relations(resumes, ({ many }) => ({
  scores: many(jobScores),
  applications: many(applications),
}));

export const jobScoresRelations = relations(jobScores, ({ one }) => ({
  job: one(jobs, { fields: [jobScores.jobId], references: [jobs.id] }),
  resume: one(resumes, {
    fields: [jobScores.resumeId],
    references: [resumes.id],
  }),
}));

export const applicationsRelations = relations(applications, ({ one }) => ({
  job: one(jobs, { fields: [applications.jobId], references: [jobs.id] }),
  resume: one(resumes, {
    fields: [applications.resumeId],
    references: [resumes.id],
  }),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  job: one(jobs, { fields: [contacts.jobId], references: [jobs.id] }),
  outreach: many(outreachLog),
}));

export const outreachLogRelations = relations(outreachLog, ({ one }) => ({
  contact: one(contacts, {
    fields: [outreachLog.contactId],
    references: [contacts.id],
  }),
}));

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type Sponsor = typeof sponsors.$inferSelect;
export type NewSponsor = typeof sponsors.$inferInsert;
export type Resume = typeof resumes.$inferSelect;
export type NewResume = typeof resumes.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type JobScore = typeof jobScores.$inferSelect;
export type NewJobScore = typeof jobScores.$inferInsert;
export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type OutreachLogEntry = typeof outreachLog.$inferSelect;
export type NewOutreachLogEntry = typeof outreachLog.$inferInsert;
