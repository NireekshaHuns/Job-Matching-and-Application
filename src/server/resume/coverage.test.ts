import { describe, expect, it } from 'vitest';
import { buildDefencePoints, buildKeywordCoverage } from './coverage';

const LATEX = String.raw`
\section{EXPERIENCE}
\resumeItem{Built a Python service on AWS, cutting p95 latency 40\%.}
\resumeItem{Led migration of the ingestion pipeline to Kafka for 2M daily events.}
\section{PROJECTS}
\resumeItem{Shipped a React dashboard used by 300 analysts.}
\section{TECHNICAL SKILLS}
Languages: Python, Java, Go \\
Cloud: AWS, Terraform
`;

describe('buildKeywordCoverage', () => {
  it('marks a keyword evidenced in a bullet as in', () => {
    const [python] = buildKeywordCoverage(LATEX, ['python']);
    expect(python.status).toBe('in');
    expect(python.where).toContain('EXPERIENCE');
  });

  it('marks a keyword that only appears in the skills list as weak', () => {
    // Present for the scanner, unevidenced for a human reader — which is the
    // whole point of a coverage check.
    const [go] = buildKeywordCoverage(LATEX, ['java']);
    expect(go.status).toBe('weak');
    expect(go.where).toEqual(['TECHNICAL SKILLS']);
  });

  it('marks an absent keyword as missing, with nowhere to point at', () => {
    const [rust] = buildKeywordCoverage(LATEX, ['rust']);
    expect(rust.status).toBe('missing');
    expect(rust.where).toEqual([]);
  });

  it('reports every section a keyword landed in', () => {
    const [aws] = buildKeywordCoverage(LATEX, ['aws']);
    expect(aws.status).toBe('in');
    expect(aws.where).toEqual(['EXPERIENCE', 'TECHNICAL SKILLS']);
  });

  it('dedupes and preserves the order it was asked about', () => {
    const out = buildKeywordCoverage(LATEX, ['kafka', 'python', 'Kafka']);
    expect(out.map((k) => k.keyword)).toEqual(['kafka', 'python']);
  });
});

describe('buildKeywordCoverage — the awkward documents', () => {
  const TRICKY = String.raw`
\section{\textbf{EXPERIENCE}}
\resumeItem{Built a MongoDB-backed service in C\# handling 2M events; mentored 3 engineers.}
\section{TECHNICAL SKILLS}
Languages: Go, C\#, Java 17, CI/CD
`;

  it('does not let a substring hit pass as evidence', () => {
    // "go" inside "MongoDB" reported the keyword as evidenced in a bullet, which
    // flips weak → in — the exact distinction this panel exists to make.
    const [go] = buildKeywordCoverage(TRICKY, ['go']);
    expect(go.status).toBe('weak');
    expect(go.where).toEqual(['TECHNICAL SKILLS']);
  });

  it('finds keywords carrying symbols', () => {
    // "c#" was reported missing while present twice, because the strip helper
    // turned LaTeX-escaped "C\#" into "C #".
    const [csharp, cicd] = buildKeywordCoverage(TRICKY, ['c#', 'ci/cd']);
    expect(csharp.status).toBe('in');
    expect(csharp.where).toEqual(['EXPERIENCE', 'TECHNICAL SKILLS']);
    expect(cicd.status).toBe('weak');
  });

  it('reports the section name without its LaTeX markup', () => {
    const [c] = buildKeywordCoverage(TRICKY, ['mongodb']);
    expect(c.where).toEqual(['EXPERIENCE']);
  });

  it('reads a document with no sections rather than calling everything missing', () => {
    // Otherwise coverage and the defence notes disagree about the same résumé.
    const [go] = buildKeywordCoverage('Built things with Go.', ['go']);
    expect(go.status).toBe('in');
  });
});

describe('buildDefencePoints', () => {
  it('says nothing when the master skill list is empty', () => {
    // Empty means "we do not know your skills", not "you have none" — and it is
    // the live state until a résumé has been ingested. Flagging everything turns
    // the panel into noise.
    const keywordFlags = buildDefencePoints(LATEX, [], ['python', 'kafka']).filter(
      (p) => !p.why.includes('number'),
    );
    expect(keywordFlags).toEqual([]);
  });

  it('matches master skills loosely, since they are not normalized', () => {
    // "Apache Kafka" in the inventory should cover a JD asking for "kafka".
    const points = buildDefencePoints(LATEX, ['Apache Kafka', 'Python'], ['kafka']);
    expect(points.some((p) => p.claim === 'kafka')).toBe(false);
  });

  it('flags a technology the résumé claims but the master skills do not support', () => {
    // The fastest way a tailored résumé becomes indefensible.
    const points = buildDefencePoints(LATEX, ['python', 'aws'], ['python', 'kafka']);
    expect(points.some((p) => p.claim === 'kafka')).toBe(true);
    expect(points.some((p) => p.claim === 'python')).toBe(false);
  });

  it('does not flag a keyword the résumé never claims', () => {
    const points = buildDefencePoints(LATEX, [], ['cobol']);
    expect(points.some((p) => p.claim === 'cobol')).toBe(false);
  });

  it('flags bullets carrying a number', () => {
    // The generator may invent plausible metrics; only the owner knows which
    // are real.
    const points = buildDefencePoints(LATEX, ['python', 'aws', 'kafka', 'react'], []);
    const claims = points.map((p) => p.claim);
    expect(claims.some((c) => c.includes('40'))).toBe(true);
    expect(claims.some((c) => c.includes('2M daily events'))).toBe(true);
    expect(claims.some((c) => c.includes('300 analysts'))).toBe(true);
  });

  it('leaves a metric-free résumé with nothing to defend', () => {
    const plain = String.raw`\section{EXPERIENCE}
\resumeItem{Built internal tools with Python.}`;
    expect(buildDefencePoints(plain, ['python'], ['python'])).toEqual([]);
  });
});
