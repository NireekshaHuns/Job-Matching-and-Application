export { companyKeysMatch, normalizeCompanyName } from './normalize';
export {
  scoreSponsorship,
  type ScoreInput,
  type SponsorHistory,
  type SponsorScore,
  type SponsorTier,
} from './score';
export { newHireStatus, type NewHireStatus } from './new-hire';
export {
  buildSponsorIndex,
  FUZZY_THRESHOLD,
  resolveEmployer,
  similarity,
  type MatchMethod,
  type ResolveResult,
  type SponsorIndex,
} from './resolve';
