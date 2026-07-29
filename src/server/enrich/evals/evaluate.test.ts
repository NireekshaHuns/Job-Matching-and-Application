import { describe, expect, it } from 'vitest';
import type { RawPosting } from '@/server/ingest/types';
import type { Classification } from '../types';
import { CLASSIFY_DATASET } from './dataset';
import { evaluateClassifier } from './evaluate';

/** A perfect classifier: echoes each example's expected label back. */
function oracleClassify(posting: RawPosting): Promise<Classification> {
  const match = CLASSIFY_DATASET.find((e) => e.posting.fingerprint === posting.fingerprint);
  return Promise.resolve({
    employmentType: match?.expected.employmentType ?? 'full_time',
    roleFamily: match?.expected.roleFamily ?? 'other',
    seniority: match?.expected.seniority ?? 'other',
    skills: [],
  });
}

describe('evaluateClassifier', () => {
  it('scores a perfect classifier at 100%', async () => {
    const result = await evaluateClassifier(oracleClassify);
    expect(result.accuracy).toBe(1);
    expect(result.misses).toEqual([]);
    expect(result.total).toBe(CLASSIFY_DATASET.length);
  });

  it('records misses and partial field accuracy', async () => {
    const alwaysBackendMid = async (): Promise<Classification> => ({
      employmentType: 'full_time',
      roleFamily: 'backend',
      seniority: 'mid',
      skills: [],
    });
    const result = await evaluateClassifier(alwaysBackendMid);
    expect(result.accuracy).toBeLessThan(1);
    expect(result.misses.length).toBeGreaterThan(0);
    // "mid-frontend" is backend? no -> role wrong; but employmentType often right.
    expect(result.employmentTypeCorrect).toBeGreaterThan(0);
  });
});
