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
  it('returns {} when the file is absent', () => {
    expect(loadDiscoveredBoards(join(tmpdir(), 'does-not-exist-ats.json'))).toEqual({});
  });

  it('returns {} when the file is malformed JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ats-'));
    const file = join(dir, 'ats-boards.json');
    try {
      writeFileSync(file, '{ not json');
      expect(loadDiscoveredBoards(file)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parses a well-formed discovered file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ats-'));
    const file = join(dir, 'ats-boards.json');
    try {
      writeFileSync(
        file,
        JSON.stringify({
          greenhouse: [{ token: 'figure', company: 'Figure' }],
          lever: [],
          ashby: [{ board: 'oklo', company: 'Oklo' }],
        }),
      );
      expect(loadDiscoveredBoards(file)).toEqual({
        greenhouse: [{ token: 'figure', company: 'Figure' }],
        lever: [],
        ashby: [{ board: 'oklo', company: 'Oklo' }],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
