import { describe, expect, it } from 'vitest';
import type { ChatClient } from '@/server/enrich/types';
import { extractJdKeywords, parseJdKeywords } from './jd-keywords';

describe('parseJdKeywords', () => {
  it('normalizes: trims, lowercases, dedupes', () => {
    const r = parseJdKeywords('{"tech":["React"," react ","Kafka"],"soft":["Ownership"]}');
    expect(r.tech).toEqual(['react', 'kafka']);
    expect(r.soft).toEqual(['ownership']);
  });

  it('tech wins when a keyword appears in both lists', () => {
    const r = parseJdKeywords('{"tech":["graphql"],"soft":["graphql","mentorship"]}');
    expect(r.tech).toContain('graphql');
    expect(r.soft).toEqual(['mentorship']);
  });

  it('tolerates prose/fences around the JSON', () => {
    const r = parseJdKeywords('```json\n{"tech":["go"],"soft":[]}\n``` done');
    expect(r.tech).toEqual(['go']);
  });

  it('throws when there is no JSON object', () => {
    expect(() => parseJdKeywords('nope')).toThrow();
  });
});

describe('extractJdKeywords', () => {
  it('calls the chat client and parses its output', async () => {
    const chat: ChatClient = { complete: async () => '{"tech":["kafka"],"soft":["ownership"]}' };
    const r = await extractJdKeywords('some JD', chat);
    expect(r).toEqual({ tech: ['kafka'], soft: ['ownership'] });
  });
});
