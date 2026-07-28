import { describe, expect, it } from 'vitest';
import { parseUscisCsv, parseUscisRows } from './parse';

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
});
