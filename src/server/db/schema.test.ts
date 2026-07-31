import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  applications,
  companyAliases,
  EMBEDDING_DIMENSIONS,
  employmentTypeEnum,
  jobScores,
  jobs,
  masterSkills,
  matchMethodEnum,
  newHireStatusEnum,
  resumeBullets,
  resumeKindEnum,
  resumes,
  roleFamilyEnum,
  seniorityEnum,
  skillKindEnum,
  sponsorFilings,
  sponsors,
  sponsorTierEnum,
} from './schema';

describe('db schema', () => {
  describe('enums', () => {
    it('sponsor tier is High/Medium/Low/Excluded (never a blended number)', () => {
      expect(sponsorTierEnum.enumValues).toEqual(['High', 'Medium', 'Low', 'Excluded']);
    });

    it('employment type only distinguishes full_time vs contract', () => {
      expect(employmentTypeEnum.enumValues).toEqual(['full_time', 'contract']);
    });

    it('role family covers the broad SWE net', () => {
      expect(roleFamilyEnum.enumValues).toEqual([
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
    });

    it('seniority targets entry and mid only', () => {
      expect(seniorityEnum.enumValues).toEqual(['entry', 'mid', 'other']);
    });

    it('new-hire status keeps all four states (unknown/no-record never dropped)', () => {
      expect(newHireStatusEnum.enumValues).toEqual([
        'sponsors_new_hires',
        'transfers_only',
        'no_record',
        'unknown',
      ]);
    });

    it('match method records how a company was resolved', () => {
      expect(matchMethodEnum.enumValues).toEqual(['exact', 'fuzzy', 'manual']);
    });
  });

  describe('embeddings', () => {
    it('uses text-embedding-3-small dimensionality', () => {
      expect(EMBEDDING_DIMENSIONS).toBe(1536);
    });

    it('declares the jobs embedding at the expected dimension', () => {
      // `dimensions` lives on the concrete PgVector column, not the base type.
      const embedding = getTableColumns(jobs).embedding as unknown as {
        columnType: string;
        dimensions: number;
      };
      expect(embedding.columnType).toBe('PgVector');
      expect(embedding.dimensions).toBe(EMBEDDING_DIMENSIONS);
    });
  });

  describe('two-score invariant', () => {
    // The H1B tier and the resume-relevance score must never share a table,
    // so they can never be collapsed into one stored value.
    it('jobs carries the sponsor tier but not a relevance score', () => {
      const cols = getTableColumns(jobs);
      expect(cols).toHaveProperty('sponsorTier');
      expect(cols).not.toHaveProperty('relevanceScore');
    });

    it('job_scores carries the relevance score but not a sponsor tier', () => {
      const cols = getTableColumns(jobScores);
      expect(cols).toHaveProperty('relevanceScore');
      expect(cols).not.toHaveProperty('sponsorTier');
    });
  });

  describe('applications nullability', () => {
    // A job is required, but resume_id is intentionally nullable so an
    // application row survives (set null) if its resume is deleted.
    it('requires a job but allows a null resume', () => {
      const cols = getTableColumns(applications);
      expect(cols.jobId.notNull).toBe(true);
      expect(cols.resumeId.notNull).toBe(false);
    });
  });

  describe('jobs table shape', () => {
    it('has the dedup fingerprint and classification columns', () => {
      const cols = getTableColumns(jobs);
      for (const name of [
        'fingerprint',
        'source',
        'url',
        'company',
        'title',
        'jdText',
        'employmentType',
        'roleFamily',
        'seniority',
        'sponsorTier',
        'isRemote',
        'techKeywords',
        'softKeywords',
      ]) {
        expect(cols).toHaveProperty(name);
      }
    });
  });

  describe('resume inventory tables', () => {
    it('has base/tailored and technical/soft enums', () => {
      expect(resumeKindEnum.enumValues).toEqual(['base', 'tailored']);
      expect(skillKindEnum.enumValues).toEqual(['technical', 'soft']);
    });

    it('master_skills and resume_bullets have their key columns', () => {
      expect(getTableColumns(masterSkills)).toHaveProperty('skill');
      expect(getTableColumns(masterSkills)).toHaveProperty('kind');
      const bullet = getTableColumns(resumeBullets);
      expect(bullet).toHaveProperty('text');
      expect(bullet).toHaveProperty('skills');
    });

    it('resumes carries kind, role family, and content', () => {
      const cols = getTableColumns(resumes);
      expect(cols).toHaveProperty('kind');
      expect(cols).toHaveProperty('roleFamily');
      expect(cols).toHaveProperty('content');
    });
  });

  describe('sponsorship signal v2', () => {
    it('sponsors carries new-employment rollups separate from the blended count', () => {
      const cols = getTableColumns(sponsors);
      expect(cols).toHaveProperty('sponsorCount');
      expect(cols).toHaveProperty('newEmploymentApprovals');
      expect(cols).toHaveProperty('newEmploymentLastYear');
      expect(cols).toHaveProperty('newEmploymentRecentYears');
    });

    it('sponsor_filings keeps initial vs continuing counts per fiscal year', () => {
      const cols = getTableColumns(sponsorFilings);
      for (const name of [
        'companyNameNormalized',
        'fiscalYear',
        'initialApprovals',
        'initialDenials',
        'continuingApprovals',
        'continuingDenials',
      ]) {
        expect(cols).toHaveProperty(name);
      }
    });

    it('company_aliases stores a visible, correctable match (confidence + method + confirmed)', () => {
      const cols = getTableColumns(companyAliases);
      for (const name of [
        'rawName',
        'rawNameNormalized',
        'sponsorId',
        'matchConfidence',
        'matchMethod',
        'confirmed',
      ]) {
        expect(cols).toHaveProperty(name);
      }
      // Nullable so a confident "no match" can still be recorded.
      expect(cols.sponsorId.notNull).toBe(false);
    });

    it('jobs carries the denormalized new-hire badge + match confidence', () => {
      const cols = getTableColumns(jobs);
      expect(cols).toHaveProperty('newHireStatus');
      expect(cols).toHaveProperty('sponsorMatchConfidence');
    });
  });
});
