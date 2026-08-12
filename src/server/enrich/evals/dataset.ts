/**
 * Labeled classification examples. This is the seed of the evals harness — grow
 * it whenever the classifier gets a case wrong, so quality is measured, not
 * vibes. Only the enum fields are graded (skills are free-form).
 */
import type { RawPosting } from '@/server/ingest/types';
import type { EmploymentType, RoleFamily, Seniority } from '../types';

export interface ClassifyExample {
  name: string;
  posting: RawPosting;
  expected: {
    employmentType: EmploymentType;
    roleFamily: RoleFamily;
    seniority: Seniority;
  };
}

function example(
  name: string,
  title: string,
  jdText: string,
  expected: ClassifyExample['expected'],
): ClassifyExample {
  return {
    name,
    expected,
    posting: {
      source: 'eval',
      company: 'Example Co',
      title,
      location: 'Remote - US',
      url: 'https://example.com',
      jdText,
      postedAt: null,
      fingerprint: `eval|${name}`,
      raw: {},
    },
  };
}

export const CLASSIFY_DATASET: ClassifyExample[] = [
  example(
    'newgrad-backend',
    'New Grad Software Engineer, Backend',
    'Entry-level role building services in Go and Postgres. 0-1 years experience.',
    { employmentType: 'full_time', roleFamily: 'backend', seniority: 'entry' },
  ),
  example(
    'mid-frontend',
    'Frontend Engineer',
    'Build our React/TypeScript web app. 3+ years of frontend experience.',
    { employmentType: 'full_time', roleFamily: 'frontend', seniority: 'mid' },
  ),
  example(
    'contract-staffing',
    'Java Developer (W-2 Contract)',
    'Six-month W-2 contract via staffing agency. Spring Boot.',
    { employmentType: 'contract', roleFamily: 'backend', seniority: 'other' },
  ),
  example(
    'sre',
    'Site Reliability Engineer',
    'Own our Kubernetes platform, on-call, terraform. 4 years experience.',
    { employmentType: 'full_time', roleFamily: 'sre', seniority: 'mid' },
  ),
  example(
    'ml',
    'Machine Learning Engineer, New Grad',
    'Train and deploy models. PyTorch. Recent MS/PhD grads welcome.',
    { employmentType: 'full_time', roleFamily: 'ml', seniority: 'entry' },
  ),
  example(
    'generic-software',
    'Software Engineer, New Grad',
    'Join our engineering team building products end to end. New grads welcome.',
    // No declared specialty -> the general "software" bucket, not "other".
    { employmentType: 'full_time', roleFamily: 'software', seniority: 'entry' },
  ),
];
