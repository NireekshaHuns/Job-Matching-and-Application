import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildConnectors,
  isMeteredSource,
  loadDiscoveredBoards,
  mergeBoards,
  skipSourceOnRun,
} from './registry';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('buildConnectors', () => {
  const sources = () => buildConnectors(async () => new Response('{}')).map((c) => c.source);

  it('registers the ATS + simplify connectors', () => {
    expect(sources()).toEqual(
      expect.arrayContaining([
        'greenhouse',
        'lever',
        'ashby',
        'smartrecruiters',
        'github:simplify-newgrad',
      ]),
    );
  });

  it('leaves LinkedIn out unless it is explicitly switched on', () => {
    vi.stubEnv('LINKEDIN_GUEST_ENABLED', '');
    expect(sources()).not.toContain('linkedin');
    // Anything other than the exact opt-in string keeps it off.
    vi.stubEnv('LINKEDIN_GUEST_ENABLED', '1');
    expect(sources()).not.toContain('linkedin');
  });

  it('registers LinkedIn after the ATS feeds when enabled', () => {
    vi.stubEnv('AGGREGATOR_API_KEY', '');
    vi.stubEnv('LINKEDIN_GUEST_ENABLED', 'true');
    const registered = sources();
    expect(registered).toContain('linkedin');
    expect(registered.at(-1)).toBe('linkedin');
  });

  it('leaves the metered aggregator out unless a key is present', () => {
    vi.stubEnv('AGGREGATOR_API_KEY', '');
    expect(sources()).not.toContain('aggregator:jsearch');
    // Whitespace is not a key — this one costs money per request.
    vi.stubEnv('AGGREGATOR_API_KEY', '   ');
    expect(sources()).not.toContain('aggregator:jsearch');
  });

  it('registers the aggregator last, after LinkedIn as well as the ATS feeds', () => {
    vi.stubEnv('LINKEDIN_GUEST_ENABLED', 'true');
    vi.stubEnv('AGGREGATOR_API_KEY', 'test-key');
    const registered = sources();
    expect(registered).toContain('aggregator:jsearch');
    expect(registered.at(-1)).toBe('aggregator:jsearch');
  });
});

describe('metered-source policy', () => {
  it('marks only the paid aggregator as metered', () => {
    expect(isMeteredSource('aggregator:jsearch')).toBe(true);
    for (const free of ['greenhouse', 'lever', 'ashby', 'linkedin', 'github:simplify-newgrad']) {
      expect(isMeteredSource(free)).toBe(false);
    }
  });

  it('fetches the metered source on the initial run only', () => {
    expect(skipSourceOnRun('aggregator:jsearch', 0)).toBe(false);
    // Every continuation resets the connector's per-run request counter, so
    // fetching here would re-buy the same listings once per continuation.
    expect(skipSourceOnRun('aggregator:jsearch', 1)).toBe(true);
    expect(skipSourceOnRun('aggregator:jsearch', 12)).toBe(true);
  });

  it('never skips a free source, which must keep draining the backlog', () => {
    for (const depth of [0, 1, 12]) {
      expect(skipSourceOnRun('greenhouse', depth)).toBe(false);
      expect(skipSourceOnRun('linkedin', depth)).toBe(false);
    }
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
