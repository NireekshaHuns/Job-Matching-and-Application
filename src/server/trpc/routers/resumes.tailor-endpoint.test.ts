import { describe, expect, it } from 'vitest';
import { resolveTailorEndpoint } from './resumes';

describe('resolveTailorEndpoint', () => {
  it('routes to the alternate endpoint when both base URL and its key are set', () => {
    expect(
      resolveTailorEndpoint({
        baseUrl: 'https://openrouter.ai/api/v1',
        tailorKey: 'sk-or-abc',
        openaiKey: 'sk-openai',
      }),
    ).toEqual({ apiKey: 'sk-or-abc', baseURL: 'https://openrouter.ai/api/v1' });
  });

  it('never leaks the OpenAI key to a base URL when the tailor key is missing', () => {
    // baseUrl set but no tailorKey → fall back to plain OpenAI (no baseURL).
    expect(
      resolveTailorEndpoint({ baseUrl: 'https://openrouter.ai/api/v1', openaiKey: 'sk-openai' }),
    ).toEqual({ apiKey: 'sk-openai' });
  });

  it('falls back to plain OpenAI when no alternate endpoint is configured', () => {
    expect(resolveTailorEndpoint({ openaiKey: 'sk-openai' })).toEqual({ apiKey: 'sk-openai' });
  });

  it('returns null when no usable key exists', () => {
    expect(resolveTailorEndpoint({})).toBeNull();
    expect(resolveTailorEndpoint({ baseUrl: 'https://x', tailorKey: '  ' })).toBeNull();
  });
});
