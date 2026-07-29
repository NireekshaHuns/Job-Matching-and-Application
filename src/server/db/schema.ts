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
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
export const employmentTypeEnum = pgEnum('employment_type', ['full_time', 'contract']);

/**
 * H1B possibility tier. Never discard unknown sponsorship — tier it. Only
 * explicit disqualifiers map to `Excluded` (hidden by default, but retained).
 */
export const sponsorTierEnum = pgEnum('sponsor_tier', ['High', 'Medium', 'Low', 'Excluded']);

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
export const applicationSourceEnum = pgEnum('application_source', ['manual', 'outlook']);

/** Channel used for hiring-manager outreach. */
export const outreachChannelEnum = pgEnum('outreach_channel', ['linkedin', 'email', 'other']);

/** A base resume (hand-authored) vs. a tailored one generated for a job. */
export const resumeKindEnum = pgEnum('resume_kind', ['base', 'tailored']);

/** Whether a master-inventory skill is technical or a soft competency. */
export const skillKindEnum = pgEnum('skill_kind', ['technical', 'soft']);

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
  /** Raw lifetime total of H1B approvals (written by the pipeline). Recency is
   * applied at scoring time via `last_filed_year`, not baked into this count. */
  sponsorCount: integer('sponsor_count').notNull().default(0),
  /** USCIS approval rate, 0–1. Null when unknown. */
  approvalRate: real('approval_rate'),
  lastFiledYear: integer('last_filed_year'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Resumes — base resumes (hand-authored LaTeX per role family) and, later,
 * tailored ones generated per job. `content` holds the LaTeX/markdown text;
 * `s3_key` is optional (a rendered PDF may or may not exist).
 */
export const resumes = pgTable(
  'resumes',
  {
    id: serial('id').primaryKey(),
    label: text('label').notNull(),
    kind: resumeKindEnum('kind').notNull().default('base'),
    roleFamily: roleFamilyEnum('role_family'),
    /** LaTeX/markdown source of the resume. */
    content: text('content'),
    s3Key: text('s3_key'),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('resumes_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops'))],
);

/**
 * Master skills inventory — the truthful superset of everything the user knows.
 * Tailoring is bounded by this; it never surfaces a skill not present here.
 */
export const masterSkills = pgTable('master_skills', {
  id: serial('id').primaryKey(),
  /** Normalized (lowercased) skill/keyword; unique join key. */
  skill: text('skill').notNull().unique(),
  kind: skillKindEnum('kind').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Bullet bank — real accomplishment bullets, each tagged with the skills it
 * demonstrates. Tailoring selects/reworders from these (never invents).
 */
export const resumeBullets = pgTable(
  'resume_bullets',
  {
    id: serial('id').primaryKey(),
    text: text('text').notNull(),
    /** Skill/keyword tags this bullet demonstrates (lowercased). */
    skills: jsonb('skills').$type<string[]>().notNull().default([]),
    roleFamily: roleFamilyEnum('role_family'),
    company: text('company'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('resume_bullets_role_family_idx').on(t.roleFamily)],
);

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
    /** Technical keywords from the JD — basis for resume keyword matching. */
    techKeywords: jsonb('tech_keywords').$type<string[]>().notNull().default([]),
    /** Soft-skill keywords the JD emphasizes. */
    softKeywords: jsonb('soft_keywords').$type<string[]>().notNull().default([]),
    // H1B possibility score — kept separate from relevance (see job_scores).
    sponsorTier: sponsorTierEnum('sponsor_tier').notNull(),
    sponsorReason: text('sponsor_reason'),
    /** Denormalized from `sponsors` at enrichment time for fast board reads. */
    sponsorCount: integer('sponsor_count'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('jobs_sponsor_tier_idx').on(t.sponsorTier),
    index('jobs_role_family_idx').on(t.roleFamily),
    // Approximate nearest-neighbour index for resume↔job similarity search.
    index('jobs_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
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
    scoredAt: timestamp('scored_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('job_scores_job_resume_idx').on(t.jobId, t.resumeId),
    check('job_scores_relevance_range', sql`${t.relevanceScore} between 0 and 100`),
  ],
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
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
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
  contactedAt: timestamp('contacted_at', { withTimezone: true }).notNull().defaultNow(),
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
export type MasterSkill = typeof masterSkills.$inferSelect;
export type NewMasterSkill = typeof masterSkills.$inferInsert;
export type ResumeBullet = typeof resumeBullets.$inferSelect;
export type NewResumeBullet = typeof resumeBullets.$inferInsert;
