import { describe, expect, it } from 'vitest';
import type { RoleFamily } from '@/server/enrich/types';
import {
  buildEvidenceIndex,
  countByGrade,
  gradeKeyword,
  gradeKeywords,
  type EvidenceBullet,
  type EvidenceCorpus,
} from './keyword-evidence';

let nextId = 1;
function bullet(
  text: string,
  skills: string[] = [],
  roleFamily: RoleFamily | null = null,
): EvidenceBullet {
  return { id: nextId++, text, skills, roleFamily };
}

/** Grade one keyword against a one-off corpus. */
function grade(
  keyword: { term: string; aliases?: string[] },
  corpus: Partial<EvidenceCorpus> = {},
) {
  const index = buildEvidenceIndex({
    masterSkills: corpus.masterSkills ?? [],
    bullets: corpus.bullets ?? [],
    roleFamily: corpus.roleFamily ?? null,
  });
  return gradeKeyword({ term: keyword.term, aliases: keyword.aliases ?? [] }, index);
}

describe('the grading table', () => {
  it('scores a skill you list AND prove in a bullet as strong', () => {
    const e = grade(
      { term: 'kafka' },
      { masterSkills: ['kafka'], bullets: [bullet('Shipped a Kafka pipeline')] },
    );
    expect(e).toMatchObject({ score: 4, grade: 'strong', viaAlias: false, matchedTerm: 'kafka' });
  });

  it('scores a keyword proven in two bullets as strong even without a master skill', () => {
    const e = grade(
      { term: 'kafka' },
      { bullets: [bullet('Shipped a Kafka pipeline'), bullet('Tuned Kafka partitions')] },
    );
    expect(e).toMatchObject({ score: 3, grade: 'strong', bulletCount: 2 });
  });

  it('scores a listed-but-unevidenced skill as moderate', () => {
    const e = grade({ term: 'kafka' }, { masterSkills: ['kafka'] });
    expect(e).toMatchObject({ score: 2, grade: 'moderate', bulletCount: 0, sample: null });
  });

  it('scores a keyword in exactly one bullet as moderate', () => {
    const e = grade({ term: 'kafka' }, { bullets: [bullet('Shipped a Kafka pipeline')] });
    expect(e).toMatchObject({ score: 2, grade: 'moderate', bulletCount: 1 });
  });

  it('scores one alias in one bullet as weak', () => {
    const e = grade(
      { term: 'event streaming', aliases: ['kafka'] },
      { bullets: [bullet('Shipped a Kafka pipeline')] },
    );
    expect(e).toMatchObject({ score: 1, grade: 'weak', viaAlias: true, matchedTerm: 'kafka' });
  });

  it('scores nothing at all as missing', () => {
    const e = grade(
      { term: 'bgp' },
      { masterSkills: ['kafka'], bullets: [bullet('Shipped a pipeline')] },
    );
    expect(e).toMatchObject({ score: 0, grade: 'missing', matchedTerm: null, sample: null });
  });
});

describe('the multi-echo alias upgrade', () => {
  // The owner's own worked example: the posting asks for something the résumé
  // says in different words, in several places. That is real evidence, and it
  // must not grade the same as one incidental word.
  const corpus = {
    masterSkills: ['aws vpc'],
    bullets: [
      bullet(
        'Deployed services across AWS VPCs on Linux, configuring networking and security controls for cloud infrastructure',
      ),
    ],
  };

  it('grades "cloud network infrastructure" as strong via its aliases', () => {
    const e = grade(
      {
        term: 'cloud network infrastructure',
        aliases: ['aws vpc', 'networking', 'security controls'],
      },
      corpus,
    );
    expect(e.grade).toBe('strong');
    expect(e.viaAlias).toBe(true);
  });

  it('still grades a lone incidental alias as weak', () => {
    const e = grade({ term: 'service mesh', aliases: ['linux'] }, { bullets: corpus.bullets });
    expect(e.grade).toBe('weak');
  });

  it('upgrades when one alias appears across two bullets', () => {
    const e = grade(
      { term: 'container orchestration', aliases: ['kubernetes'] },
      { bullets: [bullet('Ran Kubernetes clusters'), bullet('Scaled Kubernetes workloads')] },
    );
    expect(e).toMatchObject({ score: 2, grade: 'moderate' });
  });
});

describe('matching rules', () => {
  it('lets a broader master skill cover a narrower keyword, but not the reverse', () => {
    expect(grade({ term: 'kafka' }, { masterSkills: ['apache kafka'] }).grade).toBe('moderate');
    expect(grade({ term: 'apache kafka' }, { masterSkills: ['kafka'] }).grade).toBe('missing');
  });

  it('does not find "go" inside "mongodb"', () => {
    expect(
      grade({ term: 'go' }, { masterSkills: ['mongodb'], bullets: [bullet('Used MongoDB')] }).grade,
    ).toBe('missing');
  });

  it('finds symbol-bearing keywords', () => {
    expect(grade({ term: 'c#' }, { masterSkills: ['c#'] }).grade).toBe('moderate');
    expect(grade({ term: 'ci/cd' }, { bullets: [bullet('Automated CI/CD pipelines')] }).grade).toBe(
      'moderate',
    );
    expect(grade({ term: '.net' }, { masterSkills: ['.net'] }).grade).toBe('moderate');
  });

  it('reads a bullet’s skill tags as well as its text', () => {
    const e = grade({ term: 'redis' }, { bullets: [bullet('Cut lookup latency', ['redis'])] });
    expect(e.grade).toBe('moderate');
  });
});

describe('the role-family lens', () => {
  it('ignores bullets a résumé of that family would not draw on', () => {
    const bullets = [bullet('Built a React dashboard', [], 'frontend')];
    expect(grade({ term: 'react' }, { bullets, roleFamily: 'backend' }).grade).toBe('missing');
    expect(grade({ term: 'react' }, { bullets, roleFamily: 'frontend' }).grade).toBe('moderate');
    // A generalist résumé sees everything — same rule as retrieval.
    expect(grade({ term: 'react' }, { bullets, roleFamily: null }).grade).toBe('moderate');
  });

  it('always counts role-agnostic bullets', () => {
    const bullets = [bullet('Built a Kafka pipeline', [], null)];
    expect(grade({ term: 'kafka' }, { bullets, roleFamily: 'frontend' }).grade).toBe('moderate');
  });
});

describe('samples', () => {
  it('truncates a long bullet and omits it when nothing matched', () => {
    const long = `Shipped Kafka ${'x'.repeat(200)}`;
    const e = grade({ term: 'kafka' }, { bullets: [bullet(long)] });
    expect(e.sample).not.toBeNull();
    expect(e.sample!.length).toBeLessThanOrEqual(120);
    expect(grade({ term: 'bgp' }).sample).toBeNull();
  });
});

describe('gradeKeywords', () => {
  it('grades every keyword and preserves the input order', () => {
    const graded = gradeKeywords(
      [
        {
          term: 'kafka',
          bucket: 'technical',
          section: 'required',
          aliases: [],
          orGroupId: null,
          repetitions: 1,
          importance: 8,
        },
        {
          term: 'bgp',
          bucket: 'technical',
          section: 'bonus',
          aliases: [],
          orGroupId: null,
          repetitions: 1,
          importance: 2,
        },
      ],
      { masterSkills: ['kafka'], bullets: [bullet('Shipped a Kafka pipeline')] },
    );
    expect(graded.map((k) => [k.term, k.evidence.grade])).toEqual([
      ['kafka', 'strong'],
      ['bgp', 'missing'],
    ]);
    expect(countByGrade(graded)).toEqual({ strong: 1, moderate: 0, weak: 0, missing: 1 });
  });

  it('grades everything missing against an empty corpus rather than throwing', () => {
    // The live state before the first résumé is uploaded.
    const graded = gradeKeywords(
      [
        {
          term: 'kafka',
          bucket: 'technical',
          section: 'required',
          aliases: ['event streaming'],
          orGroupId: null,
          repetitions: 1,
          importance: 8,
        },
      ],
      { masterSkills: [], bullets: [] },
    );
    expect(graded[0].evidence.grade).toBe('missing');
  });
});
