import { describe, expect, it } from 'vitest';
import type OpenAI from 'openai';
import { openaiChat, openaiEmbedder } from './openai';

describe('openaiChat', () => {
  it('sends a strict JSON, temperature-0 request and returns the content', async () => {
    let params: Record<string, unknown> | undefined;
    const client = {
      chat: {
        completions: {
          create: async (p: Record<string, unknown>) => {
            params = p;
            return { choices: [{ message: { content: '{"ok":true}' } }] };
          },
        },
      },
    } as unknown as OpenAI;

    const out = await openaiChat(client, 'gpt-4o-mini').complete({
      system: 'sys',
      user: 'usr',
    });
    expect(out).toBe('{"ok":true}');
    expect(params).toMatchObject({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
    });
  });

  it('falls back to {} when the response has no content', async () => {
    const client = {
      chat: { completions: { create: async () => ({ choices: [] }) } },
    } as unknown as OpenAI;
    expect(await openaiChat(client, 'm').complete({ system: 's', user: 'u' })).toBe('{}');
  });

  it('omits response_format and falls back to "" in text mode (jsonMode: false)', async () => {
    let params: Record<string, unknown> | undefined;
    const client = {
      chat: {
        completions: {
          create: async (p: Record<string, unknown>) => {
            params = p;
            return { choices: [] };
          },
        },
      },
    } as unknown as OpenAI;

    const out = await openaiChat(client, 'm', { jsonMode: false }).complete({
      system: 's',
      user: 'u',
    });
    expect(out).toBe('');
    expect(params).not.toHaveProperty('response_format');
  });
});

describe('openaiEmbedder', () => {
  it('returns the embedding vector', async () => {
    const client = {
      embeddings: { create: async () => ({ data: [{ embedding: [0.1, 0.2] }] }) },
    } as unknown as OpenAI;
    expect(await openaiEmbedder(client, 'm').embed('hi')).toEqual([0.1, 0.2]);
  });

  it('falls back to [] when no data', async () => {
    const client = {
      embeddings: { create: async () => ({ data: [] }) },
    } as unknown as OpenAI;
    expect(await openaiEmbedder(client, 'm').embed('hi')).toEqual([]);
  });
});
