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

/**
 * New-hire sponsorship signal, derived from the USCIS "New Employment" (initial)
 * approvals column — a stronger filter than "has any H1B record". Complementary
 * to `sponsor_tier`, which also reads the JD. All four states are visible; none
 * is ever dropped. Display labels live in `src/components/tier.ts`.
 */
export const newHireStatusEnum = pgEnum('new_hire_status', [
  'sponsors_new_hires', // recent New Employment (initial) approvals
  'transfers_only', // continuing approvals but no recent new-employment
  'no_record', // matched a USCIS employer with no approvals on record
  'unknown', // no confident match to a USCIS employer
]);

/** How a raw posting company name was matched to a USCIS employer record. */
export const matchMethodEnum = pgEnum('match_method', ['exact', 'fuzzy', 'manual']);

/**
 * Posting lifecycle. `active` while still seen in a source feed; `closed` once
 * it drops out (stale). Closed jobs are retained but hidden by default.
 */
export const jobStatusEnum = pgEnum('job_status', ['active', 'closed']);

/**
 * H-1B petition filing type, captured per application (spec §5.5). Change-of-
 * status vs. consular processing matters for the US-master's-grad fee exemption;
 * we only label it, never compute anything from it. `unknown` until the user sets it.
 */
export const filingTypeEnum = pgEnum('filing_type', ['change_of_status', 'consular', 'unknown']);

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
  /**
   * Lifetime "New Employment" (initial) approvals — genuine new-hire sponsorship,
   * separate from transfers/continuations. Basis for the new-hire badge.
   */
  newEmploymentApprovals: integer('new_employment_approvals').notNull().default(0),
  /** Most recent fiscal year with any New Employment approvals; null if none. */
  newEmploymentLastYear: integer('new_employment_last_year'),
  /** New-employment approvals for the most recent ~3 fiscal years, newest first (for trend). */
  newEmploymentRecentYears: jsonb('new_employment_recent_years')
    .$type<Array<{ year: number; initialApprovals: number }>>()
    .notNull()
    .default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-employer, per-fiscal-year USCIS filing counts — the durable series behind
 * the new-employment rollups on `sponsors` (recency + trend). Keyed by the same
 * normalized company name so it lines up with `sponsors`. Multiple source rows
 * for one employer-year (state/NAICS splits) are summed before insert.
 */
export const sponsorFilings = pgTable(
  'sponsor_filings',
  {
    id: serial('id').primaryKey(),
    companyNameNormalized: text('company_name_normalized').notNull(),
    fiscalYear: integer('fiscal_year').notNull(),
    initialApprovals: integer('initial_approvals').notNull().default(0),
    initialDenials: integer('initial_denials').notNull().default(0),
    continuingApprovals: integer('continuing_approvals').notNull().default(0),
    continuingDenials: integer('continuing_denials').notNull().default(0),
  },
  (t) => [
    uniqueIndex('sponsor_filings_company_year_idx').on(t.companyNameNormalized, t.fiscalYear),
  ],
);

/**
 * Entity resolution: maps a raw posting company name to a canonical USCIS
 * employer (`sponsors`), with a visible confidence and how it was matched.
 * `sponsor_id` null means "no confident match"; a user-`confirmed` row is
 * authoritative and wins over any recomputed match (spec §5.3 — never silently
 * assert a match; corrections stick).
 */
export const companyAliases = pgTable('company_aliases', {
  id: serial('id').primaryKey(),
  /** The company name exactly as it appeared on a posting (for display/audit). */
  rawName: text('raw_name').notNull(),
  /** Normalized join key; one alias row per distinct normalized name. */
  rawNameNormalized: text('raw_name_normalized').notNull().unique(),
  /** Resolved USCIS employer; null when no confident match (or confirmed no-match). */
  sponsorId: integer('sponsor_id').references(() => sponsors.id, { onDelete: 'set null' }),
  /** Match confidence 0–1 (1 = exact normalized hit; manual confirmations = 1). */
  matchConfidence: real('match_confidence').notNull().default(0),
  matchMethod: matchMethodEnum('match_method').notNull(),
  /** True once the user has confirmed/corrected this mapping. */
  confirmed: boolean('confirmed').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
    /** Per-source external posting id (e.g. Greenhouse/Lever/Ashby/SmartRecruiters id). */
    sourceJobId: text('source_job_id'),
    url: text('url').notNull(),
    postedDate: date('posted_date'),
    /** Lifecycle: `active` while still in a feed, `closed` once it goes stale. */
    status: jobStatusEnum('status').notNull().default('active'),
    /** First time we saw this posting in a feed. */
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Most recent time we saw this posting in a feed — drives staleness. */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when the posting was marked closed (dropped out of its feed). */
    closedAt: timestamp('closed_at', { withTimezone: true }),
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
    /** New-hire sponsorship badge, denormalized from the USCIS new-employment signal. */
    newHireStatus: newHireStatusEnum('new_hire_status').notNull().default('unknown'),
    /** Confidence 0–1 of the company→USCIS employer match behind the sponsor data (null when unmatched). */
    sponsorMatchConfidence: real('sponsor_match_confidence'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('jobs_sponsor_tier_idx').on(t.sponsorTier),
    index('jobs_new_hire_status_idx').on(t.newHireStatus),
    index('jobs_status_idx').on(t.status),
    index('jobs_last_seen_at_idx').on(t.lastSeenAt),
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
export const applications = pgTable(
  'applications',
  {
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
    /** Label of the resume version used (e.g. "Backend — Stripe"). */
    resumeLabel: text('resume_label'),
    /** The actual resume text used for this application (for interview prep). */
    resumeSnapshot: text('resume_snapshot'),
    /** Set when an Outlook "application received" email is matched to this row. */
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    /** Graph message id of the confirming email — dedupes reconcile + audits the match. */
    confirmationEmailId: text('confirmation_email_id'),
    /** H-1B petition filing type (labeled only, never computed). */
    filingType: filingTypeEnum('filing_type').notNull().default('unknown'),
  },
  (t) => [
    // One confirming email can back at most one application (idempotency backstop).
    uniqueIndex('applications_confirmation_email_idx')
      .on(t.confirmationEmailId)
      .where(sql`${t.confirmationEmailId} is not null`),
  ],
);

/** Hiring-manager / recruiter contacts associated with a job. */
export const contacts = pgTable('contacts', {
  id: serial('id').primaryKey(),
  jobId: integer('job_id')
    .notNull()
    .references(() => jobs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  title: text('title'),
  /** Optional recipient address; required to send an outreach email via Graph. */
  email: text('email'),
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

/**
 * People-finder cache (spec §5.6/§7). Caches email-inference results per query
 * so we respect Apollo/Hunter free-tier limits. Contains third-party PII — kept
 * minimal, TTL'd by `fetched_at` (freshness enforced in the router), and
 * purgeable. Never exposed publicly.
 */
export const peopleCache = pgTable('people_cache', {
  id: serial('id').primaryKey(),
  /** Normalized query key (company + optional domain). */
  cacheKey: text('cache_key').notNull().unique(),
  /** Merged, deduped provider results (name/title/email/confidence/source). */
  results: jsonb('results')
    .$type<
      Array<{
        name: string;
        title: string | null;
        email: string | null;
        emailConfidence: number | null;
        source: string;
      }>
    >()
    .notNull()
    .default([]),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Single-user visa profile — the user's OPT / STEM-OPT end dates, used to derive
 * time-sensitive tracker nudges (spec §5.5). One row (enforced in the router);
 * dates are nullable until the user fills them in.
 */
export const profile = pgTable('profile', {
  id: serial('id').primaryKey(),
  /** OPT end date (F-1 post-completion OPT). */
  optEndDate: date('opt_end_date'),
  /** STEM-OPT extension end date, when applicable. */
  stemOptEndDate: date('stem_opt_end_date'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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

export const sponsorsRelations = relations(sponsors, ({ many }) => ({
  aliases: many(companyAliases),
}));

export const companyAliasesRelations = relations(companyAliases, ({ one }) => ({
  sponsor: one(sponsors, {
    fields: [companyAliases.sponsorId],
    references: [sponsors.id],
  }),
}));

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type Sponsor = typeof sponsors.$inferSelect;
export type NewSponsor = typeof sponsors.$inferInsert;
export type SponsorFiling = typeof sponsorFilings.$inferSelect;
export type NewSponsorFiling = typeof sponsorFilings.$inferInsert;
export type CompanyAlias = typeof companyAliases.$inferSelect;
export type NewCompanyAlias = typeof companyAliases.$inferInsert;
export type Profile = typeof profile.$inferSelect;
export type NewProfile = typeof profile.$inferInsert;
export type PeopleCacheRow = typeof peopleCache.$inferSelect;
export type NewPeopleCacheRow = typeof peopleCache.$inferInsert;
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
