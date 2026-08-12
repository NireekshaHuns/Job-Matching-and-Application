import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildConnectors, loadDiscoveredBoards, mergeBoards } from './registry';

describe('buildConnectors', () => {
  it('registers the ATS + simplify connectors', () => {
    const sources = buildConnectors(async () => new Response('{}')).map((c) => c.source);
    expect(sources).toEqual(
      expect.arrayContaining([
        'greenhouse',
        'lever',
        'ashby',
        'smartrecruiters',
        'github:simplify-newgrad',
      ]),
    );
  });
});

describe('mergeBoards', () => {
  const key = (b: { token: string }) => b.token;

  it('adds discovered boards that are not already seeded', () => {
    const merged = mergeBoards(
      [{ token: 'stripe', company: 'Stripe' }],
      [{ token: 'figure', company: 'Figure' }],
      key,
    );
    expect(merged).toEqual([
      { token: 'figure', company: 'Figure' },
      { token: 'stripe', company: 'Stripe' },
    ]);
  });

  it('lets the seed win on a case-insensitive key collision', () => {
    const merged = mergeBoards(
      [{ token: 'stripe', company: 'Stripe' }],
      [{ token: 'Stripe', company: 'Stripe Inc (drifted)' }],
      key,
    );
    expect(merged).toEqual([{ token: 'stripe', company: 'Stripe' }]);
  });

  it('handles a missing discovered list', () => {
    expect(mergeBoards([{ token: 'stripe', company: 'Stripe' }], undefined, key)).toEqual([
      { token: 'stripe', company: 'Stripe' },
    ]);
  });
});

describe('loadDiscoveredBoards', () => {
  const absent = () => loadDiscoveredBoards(join(tmpdir(), 'does-not-exist-ats.json'));

  it('returns the committed board list when there is no local override', () => {
    // The committed file is the whole point: a git-ignored root file never
    // reached production, so the deployed board ran on the hand seeds alone.
    const boards = absent();
    expect(boards.greenhouse?.length).toBeGreaterThan(50);
    expect(boards.ashby?.length).toBeGreaterThan(50);
    expect(boards.lever?.length).toBeGreaterThan(10);
  });

  it('still returns the committed list when a local override is malformed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ats-'));
    const file = join(dir, 'ats-boards.json');
    try {
      writeFileSync(file, '{ not json');
      expect(loadDiscoveredBoards(file).greenhouse?.length).toBe(absent().greenhouse?.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adds boards from a local override on top of the committed list', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ats-'));
    const file = join(dir, 'ats-boards.json');
    try {
      writeFileSync(
        file,
        JSON.stringify({
          greenhouse: [{ token: 'a-local-only-board', company: 'Local Only' }],
          lever: [],
          ashby: [],
        }),
      );
      const boards = loadDiscoveredBoards(file);
      expect(boards.greenhouse).toContainEqual({
        token: 'a-local-only-board',
        company: 'Local Only',
      });
      expect(boards.greenhouse?.length).toBe((absent().greenhouse?.length ?? 0) + 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
