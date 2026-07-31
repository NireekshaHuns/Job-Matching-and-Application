/**
 * Parse rows from the USCIS H-1B Employer Data Hub into typed records.
 *
 * The Data Hub publishes approval / denial counts per employer per fiscal year
 * (sometimes split further by state/NAICS, i.e. several rows per employer-year —
 * those are summed in `aggregateSponsors`).
 *
 * Two on-disk formats are supported:
 *  - **Legacy**: comma-separated UTF-8 with `Initial Approval` / `Continuing
 *    Approval` columns.
 *  - **Current**: tab-separated UTF-16 (with BOM) whose approvals/denials are
 *    split into granular categories (`New Employment`, `Continuation`, `Change
 *    with Same Employer`, `New Concurrent`, `Change of Employer`, `Amended`).
 *    "New Employment" is the initial (new-hire) column; the rest are summed into
 *    the continuing bucket. This mapping matches `aggregate.ts`, which documents
 *    `initialApprovals` as the USCIS "New Employment" column — the genuine
 *    new-hire-sponsor signal the `High` tier keys off.
 *
 * Column headers vary slightly across yearly files (e.g. "Initial Approval" vs
 * "Initial Approvals"), so lookups are done against a normalized header key.
 *
 * Pure — no DB or network. `parseUscisCsv` decodes/normalizes the raw text and
 * turns it into rows first; `decodeUscisBuffer` handles the file-level encoding.
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
  state: ['state', 'petitionerstate', 'worksitestate'],
} as const;

/** Legacy two-column schema. */
const LEGACY_ALIASES = {
  initialApprovals: ['initialapproval', 'initialapprovals'],
  initialDenials: ['initialdenial', 'initialdenials'],
  continuingApprovals: ['continuingapproval', 'continuingapprovals'],
  continuingDenials: ['continuingdenial', 'continuingdenials'],
} as const;

/**
 * Current Data Hub schema. "New Employment" is the initial (new-hire) column;
 * the remaining categories are summed into the continuing bucket.
 */
const NEW_EMPLOYMENT_APPROVAL = ['newemploymentapproval', 'newemploymentapprovals'];
const NEW_EMPLOYMENT_DENIAL = ['newemploymentdenial', 'newemploymentdenials'];
const CONTINUING_APPROVAL_GROUPS: readonly (readonly string[])[] = [
  ['continuationapproval', 'continuationapprovals'],
  ['changewithsameemployerapproval', 'changewithsameemployerapprovals'],
  ['newconcurrentapproval', 'newconcurrentapprovals'],
  ['changeofemployerapproval', 'changeofemployerapprovals'],
  ['amendedapproval', 'amendedapprovals'],
];
const CONTINUING_DENIAL_GROUPS: readonly (readonly string[])[] = [
  ['continuationdenial', 'continuationdenials'],
  ['changewithsameemployerdenial', 'changewithsameemployerdenials'],
  ['newconcurrentdenial', 'newconcurrentdenials'],
  ['changeofemployerdenial', 'changeofemployerdenials'],
  ['amendeddenial', 'amendeddenials'],
];

/**
 * Normalized approval-column names that mark a file as a recognizable USCIS
 * schema (current or legacy). Used to fail loudly on an unknown header rather
 * than silently importing every count as 0 — the New Employment / initial
 * signal the `High` tier depends on must never be zeroed silently.
 */
const RECOGNIZED_APPROVAL_COLUMNS: readonly string[] = [
  ...NEW_EMPLOYMENT_APPROVAL,
  ...LEGACY_ALIASES.initialApprovals,
  ...LEGACY_ALIASES.continuingApprovals,
];

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
 * Decode a raw USCIS file buffer to text based on its byte-order mark. The
 * current Data Hub export ships UTF-16LE; the legacy one is UTF-8. A UTF-8 file
 * (BOM or not) falls through to the utf8 branch — any leading BOM char it
 * carries is stripped later, in `parseUscisCsv`.
 */
export function decodeUscisBuffer(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    // UTF-16LE. Node truncates a trailing odd byte on decode (matches the BE
    // branch below, which truncates explicitly since swap16 needs even length).
    return buf.toString('utf16le');
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    // UTF-16BE: swap to LE (swap16 needs an even length) then decode.
    const even = buf.length % 2 === 0 ? buf : buf.subarray(0, buf.length - 1);
    return Buffer.from(even).swap16().toString('utf16le');
  }
  return buf.toString('utf8');
}

/** Pick the delimiter from the header line: tab if present, else comma. */
function detectDelimiter(text: string): ',' | '\t' {
  const newline = text.indexOf('\n');
  const firstLine = newline >= 0 ? text.slice(0, newline) : text;
  return firstLine.includes('\t') ? '\t' : ',';
}

/**
 * Map already-parsed CSV rows (keyed by their original headers) to
 * `UscisRecord`s. Rows without an employer or a valid fiscal year are skipped.
 * Detects the legacy vs current column schema from the headers.
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
  const num = (row: Record<string, string>, aliases: readonly string[]): number =>
    toInt(getFrom(row, aliases)) ?? 0;
  const sumGroups = (row: Record<string, string>, groups: readonly (readonly string[])[]): number =>
    groups.reduce((total, aliases) => total + num(row, aliases), 0);

  const isCurrentFormat = NEW_EMPLOYMENT_APPROVAL.some((a) => keyByNorm.has(a));

  const out: UscisRecord[] = [];
  for (const row of rows) {
    const employer = (getFrom(row, HEADER_ALIASES.employer) ?? '').trim();
    const fiscalYear = toInt(getFrom(row, HEADER_ALIASES.fiscalYear));
    if (
      !employer ||
      fiscalYear === null ||
      fiscalYear < MIN_FISCAL_YEAR ||
      fiscalYear > MAX_FISCAL_YEAR
    ) {
      continue;
    }

    const counts = isCurrentFormat
      ? {
          initialApprovals: num(row, NEW_EMPLOYMENT_APPROVAL),
          initialDenials: num(row, NEW_EMPLOYMENT_DENIAL),
          continuingApprovals: sumGroups(row, CONTINUING_APPROVAL_GROUPS),
          continuingDenials: sumGroups(row, CONTINUING_DENIAL_GROUPS),
        }
      : {
          initialApprovals: num(row, LEGACY_ALIASES.initialApprovals),
          initialDenials: num(row, LEGACY_ALIASES.initialDenials),
          continuingApprovals: num(row, LEGACY_ALIASES.continuingApprovals),
          continuingDenials: num(row, LEGACY_ALIASES.continuingDenials),
        };

    out.push({
      employer,
      fiscalYear,
      ...counts,
      state: (getFrom(row, HEADER_ALIASES.state) ?? '').trim() || null,
    });
  }

  return out;
}

/** Parse raw USCIS text (either format) into records. */
export function parseUscisCsv(csv: string): UscisRecord[] {
  // A UTF-16 decode leaves the BOM as a leading ﻿; strip it so header
  // detection and matching aren't thrown off (csv-parse's `bom` only covers
  // UTF-8). Harmless when no BOM is present.
  const text = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  const rows = parseCsv(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
    delimiter: detectDelimiter(text),
  }) as Array<Record<string, string>>;

  // Fail loudly if the header matches neither schema (e.g. a future USCIS
  // rename). Without this, unrecognized approval columns would silently import
  // as 0 for every row — corrupting the sponsorship signal with no error.
  if (rows.length > 0) {
    const headerKeys = new Set(Object.keys(rows[0]).map(normHeader));
    if (!RECOGNIZED_APPROVAL_COLUMNS.some((c) => headerKeys.has(c))) {
      throw new Error(
        'USCIS parse: no recognized approval columns in header (expected ' +
          '"New Employment Approval" or "Initial Approval"). Found: ' +
          Object.keys(rows[0]).join(', '),
      );
    }
  }

  return parseUscisRows(rows);
}
