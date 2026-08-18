import { describe, expect, it } from 'vitest';
import { meetsMinSalary, parseSalaryRange } from './salary';

describe('parseSalaryRange', () => {
  it('reads a plain comma-separated range', () => {
    expect(parseSalaryRange('$110,000–$164,000')).toEqual({ minUsd: 110_000, maxUsd: 164_000 });
  });

  it('reads k-notation', () => {
    expect(parseSalaryRange('$143k–$191k')).toEqual({ minUsd: 143_000, maxUsd: 191_000 });
    expect(parseSalaryRange('$250K - $300K')).toEqual({ minUsd: 250_000, maxUsd: 300_000 });
  });

  it('handles every dash the sources use, plus "to"', () => {
    const expected = { minUsd: 120_000, maxUsd: 160_000 };
    expect(parseSalaryRange('$120,000-$160,000')).toEqual(expected);
    expect(parseSalaryRange('$120,000 – $160,000')).toEqual(expected);
    expect(parseSalaryRange('$120,000 — $160,000')).toEqual(expected);
    expect(parseSalaryRange('$120,000 to $160,000')).toEqual(expected);
  });

  it('ignores trailing period and currency words', () => {
    expect(parseSalaryRange('$60,000 - $80,000 per year')).toEqual({
      minUsd: 60_000,
      maxUsd: 80_000,
    });
    expect(parseSalaryRange('$120,000 - $165,000 annually')).toEqual({
      minUsd: 120_000,
      maxUsd: 165_000,
    });
    expect(parseSalaryRange('$320,000–$485,000 USD')).toEqual({
      minUsd: 320_000,
      maxUsd: 485_000,
    });
  });

  it('drops cents', () => {
    expect(parseSalaryRange('$118,600.00 - $204,000.00')).toEqual({
      minUsd: 118_600,
      maxUsd: 204_000,
    });
  });

  it('treats a single figure as both bounds', () => {
    expect(parseSalaryRange('$150,000')).toEqual({ minUsd: 150_000, maxUsd: 150_000 });
    expect(parseSalaryRange('Up to $180,000')).toEqual({ minUsd: 180_000, maxUsd: 180_000 });
  });

  it('annualizes hourly rates at 2080 hours', () => {
    expect(parseSalaryRange('$70–$90/hr')).toEqual({ minUsd: 145_600, maxUsd: 187_200 });
    expect(parseSalaryRange('$50.00 per hour')).toEqual({ minUsd: 104_000, maxUsd: 104_000 });
  });

  it('annualizes an unlabelled rate too — nobody earns $90 a year', () => {
    expect(parseSalaryRange('$70 - $90')).toEqual({ minUsd: 145_600, maxUsd: 187_200 });
  });

  it('annualizes monthly and weekly pay', () => {
    expect(parseSalaryRange('$9,000/month')).toEqual({ minUsd: 108_000, maxUsd: 108_000 });
    expect(parseSalaryRange('$2,500 per week')).toEqual({ minUsd: 130_000, maxUsd: 130_000 });
  });

  it('refuses non-USD rather than reading it as dollars', () => {
    expect(parseSalaryRange('€125,000–€165,000 EUR')).toBeNull();
    expect(parseSalaryRange('£90,000 - £120,000')).toBeNull();
    expect(parseSalaryRange('C$130,000 - C$160,000')).toBeNull();
    expect(parseSalaryRange('CAD 130,000 - 160,000')).toBeNull();
    expect(parseSalaryRange('₹2,500,000')).toBeNull();
  });

  it('returns null for anything without a usable figure', () => {
    expect(parseSalaryRange(null)).toBeNull();
    expect(parseSalaryRange(undefined)).toBeNull();
    expect(parseSalaryRange('   ')).toBeNull();
    expect(parseSalaryRange('Competitive')).toBeNull();
    expect(parseSalaryRange('DOE')).toBeNull();
  });

  it('ignores equity percentages next to a real figure', () => {
    expect(parseSalaryRange('$150,000 + 0.5% equity')).toEqual({
      minUsd: 150_000,
      maxUsd: 150_000,
    });
  });

  it('does not read the "m" of a following word as a magnitude suffix', () => {
    // Regression: "$2,000 monthly" once parsed as $2,000,000,000 and the whole
    // posting fell out of the sanity band.
    expect(parseSalaryRange('$2,000 monthly')).toEqual({ minUsd: 24_000, maxUsd: 24_000 });
    expect(parseSalaryRange('$180,000 max')).toEqual({ minUsd: 180_000, maxUsd: 180_000 });
  });

  it('keeps both ends when only the first figure carries the "$"', () => {
    // The posting writes the dollar sign once. Reading only marked figures
    // capped this at $120,000 and hid the job at the $150k threshold — the
    // exact permanent-hiding failure the parser exists to avoid.
    expect(parseSalaryRange('$120,000 - 165,000')).toEqual({ minUsd: 120_000, maxUsd: 165_000 });
    expect(parseSalaryRange('$120k - 150k')).toEqual({ minUsd: 120_000, maxUsd: 150_000 });
    expect(parseSalaryRange('$130,000 – 160,000 per year')).toEqual({
      minUsd: 130_000,
      maxUsd: 160_000,
    });
  });

  it('stops at the range and ignores amounts that follow it', () => {
    // A bonus is not the bottom of the salary range, and a stipend is not the top.
    expect(parseSalaryRange('$150,000 base + $20,000 bonus')).toEqual({
      minUsd: 150_000,
      maxUsd: 150_000,
    });
    expect(parseSalaryRange('$25.00/hr + $2,000 monthly housing stipend')).toEqual({
      minUsd: 52_000,
      maxUsd: 52_000,
    });
    expect(parseSalaryRange('$140,000–$180,000 plus equity and a $15,000 signing bonus')).toEqual({
      minUsd: 140_000,
      maxUsd: 180_000,
    });
  });

  it('scales a range as a whole, never one end hourly and the other annual', () => {
    // Read per-figure, "$1,500 - $2,500" came out as $2,500–$3,120,000 and
    // cleared every threshold. Mixed scaling is worse than no parse.
    expect(parseSalaryRange('$1,500 - $2,500')).toBeNull();
    expect(parseSalaryRange('$1,800 - $2,200')).toBeNull();
  });

  it('does not invent a salary from a bare number with no money signal', () => {
    // "401" annualized as an hourly rate is $834,080 — a fabricated figure in a
    // column whose whole contract is "null means we did not know".
    expect(parseSalaryRange('401(k)')).toBeNull();
    expect(parseSalaryRange('Competitive salary with 401(k) match')).toBeNull();
  });

  it('still reads unmarked figures when something else signals money', () => {
    expect(parseSalaryRange('70k - 90k')).toEqual({ minUsd: 70_000, maxUsd: 90_000 });
    expect(parseSalaryRange('Salary: 100,000 - 130,000 USD')).toEqual({
      minUsd: 100_000,
      maxUsd: 130_000,
    });
    expect(parseSalaryRange('120,000 - 150,000 annually')).toEqual({
      minUsd: 120_000,
      maxUsd: 150_000,
    });
  });

  it('ignores unmarked context numbers when a dollar figure is present', () => {
    expect(parseSalaryRange('$140,000 - $180,000, 5 years experience')).toEqual({
      minUsd: 140_000,
      maxUsd: 180_000,
    });
  });

  it('rejects figures outside a believable annual band', () => {
    // A stray "$5" is not pay, and annualizing it hourly still lands too low.
    expect(parseSalaryRange('$5')).toBeNull();
    expect(parseSalaryRange('$500,000,000')).toBeNull();
  });
});

describe('meetsMinSalary', () => {
  it('keeps postings that state no pay — unknown is never discarded', () => {
    expect(meetsMinSalary(null, 100_000)).toBe(true);
  });

  it('compares against the TOP of the range', () => {
    // Ceiling clears the bar even though the floor does not.
    expect(meetsMinSalary(155_000, 100_000)).toBe(true);
    expect(meetsMinSalary(90_000, 100_000)).toBe(false);
  });

  it('is inclusive at the threshold', () => {
    expect(meetsMinSalary(100_000, 100_000)).toBe(true);
  });

  it('keeps everything when no minimum is set', () => {
    expect(meetsMinSalary(40_000, 0)).toBe(true);
    expect(meetsMinSalary(null, 0)).toBe(true);
  });
});
