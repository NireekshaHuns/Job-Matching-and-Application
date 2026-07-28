/**
 * Parse rows from the USCIS H-1B Employer Data Hub (CSV) into typed records.
 *
 * The Data Hub publishes one row per employer per fiscal year with approval /
 * denial counts. Column headers vary slightly across yearly files (e.g.
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
  state: string | null;
}

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

/** Parse an integer that may contain thousands separators; null if not a number. */
function toInt(v: string | undefined): number | null {
  if (v == null) return null;
  const n = parseInt(v.replace(/[,\s]/g, ''), 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Map already-parsed CSV rows (keyed by their original headers) to
 * `UscisRecord`s. Rows without an employer or a valid fiscal year are skipped.
 */
export function parseUscisRows(rows: Array<Record<string, string>>): UscisRecord[] {
  const out: UscisRecord[] = [];

  for (const row of rows) {
    const keyByNorm = new Map<string, string>();
    for (const original of Object.keys(row)) {
      keyByNorm.set(normHeader(original), original);
    }
    const get = (aliases: readonly string[]): string | undefined => {
      for (const alias of aliases) {
        const original = keyByNorm.get(alias);
        if (original !== undefined) return row[original];
      }
      return undefined;
    };

    const employer = (get(HEADER_ALIASES.employer) ?? '').trim();
    const fiscalYear = toInt(get(HEADER_ALIASES.fiscalYear));
    if (!employer || fiscalYear === null) continue;

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
