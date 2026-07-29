import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  applications,
  EMBEDDING_DIMENSIONS,
  employmentTypeEnum,
  jobScores,
  jobs,
  roleFamilyEnum,
  seniorityEnum,
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
});
