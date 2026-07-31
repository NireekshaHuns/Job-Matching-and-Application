import { describe, expect, it } from 'vitest';
import { decodeUscisBuffer, parseUscisCsv, parseUscisRows } from './parse';

// Current Data Hub schema: tab-separated, granular approval/denial categories.
// "New Employment" is initial; the rest sum into continuing.
const CURRENT_TSV = [
  'Line by line\tFiscal Year\tEmployer (Petitioner) Name\tPetitioner State\tNew Employment Approval\tNew Employment Denial\tContinuation Approval\tContinuation Denial\tChange with Same Employer Approval\tChange with Same Employer Denial\tNew Concurrent Approval\tNew Concurrent Denial\tChange of Employer Approval\tChange of Employer Denial\tAmended Approval\tAmended Denial',
  '1\t2024\tACME CORP\tCA\t10\t1\t3\t0\t2\t0\t1\t0\t4\t0\t5\t0',
].join('\n');

const CSV = `Fiscal Year,Employer (Petitioner) Name,Initial Approval,Initial Denial,Continuing Approval,Continuing Denial,Petitioner State
2024,"GOOGLE LLC","1,200",3,50,1,CA
2023,"Google, Inc.",80,2,40,0,CA
2024,"ACME CORP",5,10,0,0,NY
2024,,1,1,1,1,XX
`;

describe('parseUscisCsv', () => {
  it('parses rows and skips ones with no employer', () => {
    const records = parseUscisCsv(CSV);
    expect(records).toHaveLength(3);
  });

  it('handles thousands separators and quoted employer names', () => {
    const [google] = parseUscisCsv(CSV);
    expect(google.employer).toBe('GOOGLE LLC');
    expect(google.initialApprovals).toBe(1200);
    expect(google.fiscalYear).toBe(2024);
    expect(google.state).toBe('CA');
  });
});

describe('parseUscisRows', () => {
  it('is tolerant of alternate header spellings', () => {
    const records = parseUscisRows([
      {
        FY: '2022',
        Employer: 'Stripe Inc',
        'Initial Approvals': '10',
        'Initial Denials': '0',
        'Continuing Approvals': '2',
        'Continuing Denials': '0',
        State: 'CA',
      },
    ]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      employer: 'Stripe Inc',
      fiscalYear: 2022,
      initialApprovals: 10,
      continuingApprovals: 2,
    });
  });

  it('defaults missing counts to 0 and missing state to null', () => {
    const [rec] = parseUscisRows([{ 'Fiscal Year': '2021', Employer: 'Foo' }]);
    expect(rec.initialApprovals).toBe(0);
    expect(rec.continuingDenials).toBe(0);
    expect(rec.state).toBeNull();
  });

  it('skips rows with a non-numeric fiscal year', () => {
    const records = parseUscisRows([{ 'Fiscal Year': 'n/a', Employer: 'Bar' }]);
    expect(records).toHaveLength(0);
  });

  it('skips rows whose fiscal year is out of a sane range', () => {
    expect(parseUscisRows([{ 'Fiscal Year': '20241', Employer: 'Typo Co' }])).toHaveLength(0);
    expect(parseUscisRows([{ 'Fiscal Year': '19', Employer: 'Truncated Co' }])).toHaveLength(0);
  });

  it('treats a partially-numeric count as 0 rather than truncating it', () => {
    const [rec] = parseUscisRows([
      { 'Fiscal Year': '2024', Employer: 'Dirty Co', 'Initial Approval': '12 (est)' },
    ]);
    expect(rec.initialApprovals).toBe(0);
  });

  it('handles a BOM-prefixed CSV file', () => {
    const withBom = `﻿Fiscal Year,Employer,Initial Approval\n2024,Foo,7\n`;
    const [rec] = parseUscisCsv(withBom);
    expect(rec.employer).toBe('Foo');
    expect(rec.initialApprovals).toBe(7);
  });
});

describe('parseUscisCsv — current Data Hub format', () => {
  it('parses the tab-delimited, granular-column schema', () => {
    const [rec] = parseUscisCsv(CURRENT_TSV);
    expect(rec.employer).toBe('ACME CORP');
    expect(rec.fiscalYear).toBe(2024);
    expect(rec.state).toBe('CA');
    // "New Employment" is the initial (new-hire) signal.
    expect(rec.initialApprovals).toBe(10);
    expect(rec.initialDenials).toBe(1);
    // Continuing = Continuation + Change w/ Same Employer + New Concurrent +
    // Change of Employer + Amended = 3 + 2 + 1 + 4 + 5.
    expect(rec.continuingApprovals).toBe(15);
    expect(rec.continuingDenials).toBe(0);
  });

  it('decodes a UTF-16LE (BOM) buffer and parses it end to end', () => {
    const buf = Buffer.from(`﻿${CURRENT_TSV}\n`, 'utf16le');
    const [rec] = parseUscisCsv(decodeUscisBuffer(buf));
    expect(rec.employer).toBe('ACME CORP');
    expect(rec.initialApprovals).toBe(10);
    expect(rec.continuingApprovals).toBe(15);
  });

  it('sums only the continuing categories that are present', () => {
    // No "Amended" columns at all — the remaining four still sum (3+2+1+4).
    const tsv = [
      'Fiscal Year\tEmployer (Petitioner) Name\tNew Employment Approval\tContinuation Approval\tChange with Same Employer Approval\tNew Concurrent Approval\tChange of Employer Approval',
      '2024\tACME CORP\t10\t3\t2\t1\t4',
    ].join('\n');
    const [rec] = parseUscisCsv(tsv);
    expect(rec.initialApprovals).toBe(10);
    expect(rec.continuingApprovals).toBe(10);
  });

  it('keeps a comma inside a tab-delimited field (delimiter heuristic)', () => {
    const tsv = [
      'Fiscal Year\tEmployer (Petitioner) Name\tNew Employment Approval',
      '2024\tACME, INC\t5',
    ].join('\n');
    const [rec] = parseUscisCsv(tsv);
    expect(rec.employer).toBe('ACME, INC');
    expect(rec.initialApprovals).toBe(5);
  });
});

describe('parseUscisCsv — unrecognized schema', () => {
  it('throws rather than silently importing zeros when no approval column is found', () => {
    const csv = 'Fiscal Year,Employer,Widgets Made\n2024,Foo,7\n';
    expect(() => parseUscisCsv(csv)).toThrow(/no recognized approval columns/);
  });
});

describe('decodeUscisBuffer', () => {
  it('decodes UTF-16LE via its BOM', () => {
    const buf = Buffer.from('﻿hello', 'utf16le');
    expect(decodeUscisBuffer(buf)).toBe('﻿hello');
  });

  it('decodes UTF-16BE via its BOM', () => {
    const buf = Buffer.from('﻿hello', 'utf16le').swap16(); // build a BE buffer
    expect(decodeUscisBuffer(buf)).toBe('﻿hello');
  });

  it('falls back to UTF-8 when there is no UTF-16 BOM', () => {
    const buf = Buffer.from('Fiscal Year,Employer\n2024,Foo\n', 'utf8');
    expect(decodeUscisBuffer(buf)).toContain('Employer');
  });
});
