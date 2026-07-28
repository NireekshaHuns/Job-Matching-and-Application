/**
 * Parse rows from the USCIS H-1B Employer Data Hub (CSV) into typed records.
 *
 * The Data Hub publishes approval / denial counts per employer per fiscal year
 * (sometimes split further by state/NAICS, i.e. several rows per employer-year —
 * those are summed in `aggregateSponsors`). Column headers vary slightly across
 * yearly files (e.g.
 * "Employer" vs "Employer (Petitioner) Name", "Initial Approval" vs
 * "Initial Approvals"), so lookups are done against a normalized header key.
 *
 * Pure — no DB or network. `parseUscisCsv` is a thin wrapper that turns raw CSV
 * text into rows first.
 */
import { parse as parseCsv } from 'csv-parse/sync';

export interface UscisRecord {
  employer: string;
  fiscalYear: number;
  initialApprovals: number;
  initialDenials: number;
  continuingApprovals: number;
  continuingDenials: number;
  /** Petitioner state; captured for future state-level analysis (not yet persisted). */
  state: string | null;
}

/** Plausible fiscal-year range; anything outside is treated as bad input. */
const MIN_FISCAL_YEAR = 1990;
const MAX_FISCAL_YEAR = new Date().getUTCFullYear() + 1;

/** Candidate header spellings, matched after normalization (see `normHeader`). */
const HEADER_ALIASES = {
  fiscalYear: ['fiscalyear', 'fy'],
  employer: ['employer', 'employerpetitionername', 'employername', 'petitioner', 'petitionername'],
  initialApprovals: ['initialapproval', 'initialapprovals'],
  initialDenials: ['initialdenial', 'initialdenials'],
  continuingApprovals: ['continuingapproval', 'continuingapprovals'],
  continuingDenials: ['continuingdenial', 'continuingdenials'],
  state: ['state', 'petitionerstate', 'worksitestate'],
} as const;

function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Parse a non-negative integer that may contain thousands separators. Returns
 * null unless the whole cleaned value is digits, so "12 (est)" or "1,200*" is
 * rejected rather than silently truncated by `parseInt`.
 */
function toInt(v: string | undefined): number | null {
  if (v == null) return null;
  const cleaned = v.replace(/[,\s]/g, '');
  return /^\d+$/.test(cleaned) ? parseInt(cleaned, 10) : null;
}

/**
 * Map already-parsed CSV rows (keyed by their original headers) to
 * `UscisRecord`s. Rows without an employer or a valid fiscal year are skipped.
 */
export function parseUscisRows(rows: Array<Record<string, string>>): UscisRecord[] {
  if (rows.length === 0) return [];

  // Headers are constant within a file, so build the lookup once.
  const keyByNorm = new Map<string, string>();
  for (const original of Object.keys(rows[0])) {
    keyByNorm.set(normHeader(original), original);
  }
  const getFrom = (row: Record<string, string>, aliases: readonly string[]): string | undefined => {
    for (const alias of aliases) {
      const original = keyByNorm.get(alias);
      if (original !== undefined) return row[original];
    }
    return undefined;
  };

  const out: UscisRecord[] = [];
  for (const row of rows) {
    const get = (aliases: readonly string[]) => getFrom(row, aliases);

    const employer = (get(HEADER_ALIASES.employer) ?? '').trim();
    const fiscalYear = toInt(get(HEADER_ALIASES.fiscalYear));
    if (
      !employer ||
      fiscalYear === null ||
      fiscalYear < MIN_FISCAL_YEAR ||
      fiscalYear > MAX_FISCAL_YEAR
    ) {
      continue;
    }

    out.push({
      employer,
      fiscalYear,
      initialApprovals: toInt(get(HEADER_ALIASES.initialApprovals)) ?? 0,
      initialDenials: toInt(get(HEADER_ALIASES.initialDenials)) ?? 0,
      continuingApprovals: toInt(get(HEADER_ALIASES.continuingApprovals)) ?? 0,
      continuingDenials: toInt(get(HEADER_ALIASES.continuingDenials)) ?? 0,
      state: (get(HEADER_ALIASES.state) ?? '').trim() || null,
    });
  }

  return out;
}

/** Parse raw USCIS CSV text into records. */
export function parseUscisCsv(csv: string): UscisRecord[] {
  const rows = parseCsv(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
  }) as Array<Record<string, string>>;
  return parseUscisRows(rows);
}
