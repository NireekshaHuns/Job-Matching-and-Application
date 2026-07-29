/**
 * Evaluate a classifier against the labeled dataset. Takes a classify function
 * (real or fake) so it runs offline in tests and against OpenAI in the eval
 * script. Grades the three enum fields per example.
 */
import type { RawPosting } from '@/server/ingest/types';
import type { Classification } from '../types';
import { CLASSIFY_DATASET, type ClassifyExample } from './dataset';

export interface EvalResult {
  total: number;
  employmentTypeCorrect: number;
  roleFamilyCorrect: number;
  seniorityCorrect: number;
  /** Fraction of fully-correct examples (all three fields right). */
  accuracy: number;
  misses: string[];
}

export async function evaluateClassifier(
  classify: (posting: RawPosting) => Promise<Classification>,
  dataset: ClassifyExample[] = CLASSIFY_DATASET,
): Promise<EvalResult> {
  let employmentTypeCorrect = 0;
  let roleFamilyCorrect = 0;
  let seniorityCorrect = 0;
  let fullyCorrect = 0;
  const misses: string[] = [];

  for (const ex of dataset) {
    const got = await classify(ex.posting);
    const okEmp = got.employmentType === ex.expected.employmentType;
    const okRole = got.roleFamily === ex.expected.roleFamily;
    const okSen = got.seniority === ex.expected.seniority;
    if (okEmp) employmentTypeCorrect++;
    if (okRole) roleFamilyCorrect++;
    if (okSen) seniorityCorrect++;
    if (okEmp && okRole && okSen) fullyCorrect++;
    else misses.push(ex.name);
  }

  return {
    total: dataset.length,
    employmentTypeCorrect,
    roleFamilyCorrect,
    seniorityCorrect,
    accuracy: dataset.length === 0 ? 1 : fullyCorrect / dataset.length,
    misses,
  };
}
