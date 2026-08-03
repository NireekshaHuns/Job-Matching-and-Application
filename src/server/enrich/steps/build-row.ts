/**
 * Assemble a clean `jobs` insert row from a posting plus its enrichment results.
 * Pure — no DB. The two scores stay in separate places: `sponsorTier` here,
 * resume `relevanceScore` in a later job_scores step.
 */
import type { NewJob } from '@/server/db/schema';
import type { RawPosting } from '@/server/ingest/types';
import type { Classification } from '../types';
import { deriveIsUs } from './location';
import { looksLikeStaffing } from './staffing';
import type { SponsorMatch } from './sponsor-match';

function looksRemote(posting: RawPosting): boolean {
  const location = posting.location ?? '';
  // Look at the location field only, and don't treat "no/not remote" as remote.
  if (/\b(no|not|non)[-\s]?remote\b/i.test(location)) return false;
  return /\bremote\b/i.test(location);
}

export function buildJobRow(
  posting: RawPosting,
  sponsor: SponsorMatch,
  classification: Classification,
  embedding: number[] | null,
): NewJob {
  return {
    fingerprint: posting.fingerprint,
    source: posting.source,
    sourceJobId: posting.sourceJobId ?? null,
    url: posting.url,
    postedDate: posting.postedDate,
    company: posting.company,
    title: posting.title,
    location: posting.location,
    isRemote: looksRemote(posting),
    isUs: deriveIsUs(posting.location),
    jdText: posting.jdText,
    embedding,
    // A JD the LLM read as full-time but that carries staffing signals (C2C,
    // "our client", W-2 contract) is a body-shop placement — force it to
    // contract so the default full_time filter hides it (still auditable).
    employmentType:
      classification.employmentType === 'full_time' && looksLikeStaffing(posting.jdText)
        ? 'contract'
        : classification.employmentType,
    roleFamily: classification.roleFamily,
    seniority: classification.seniority,
    techKeywords: classification.skills,
    softKeywords: classification.softKeywords,
    sponsorTier: sponsor.tier,
    sponsorReason: sponsor.reason,
    sponsorCount: sponsor.sponsorCount,
    newHireStatus: sponsor.newHireStatus,
    sponsorMatchConfidence: sponsor.matchConfidence,
  };
}
