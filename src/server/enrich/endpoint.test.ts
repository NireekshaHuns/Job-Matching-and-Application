import { describe, expect, it } from 'vitest';
import { resolveLlmEndpoint } from './endpoint';

describe('resolveLlmEndpoint', () => {
  it('uses the alternate endpoint when both base URL and its key are set', () => {
    expect(
      resolveLlmEndpoint({
        baseUrl: 'https://openrouter.ai/api/v1',
        altKey: 'sk-or-abc',
        openaiKey: 'sk-openai',
      }),
    ).toEqual({ apiKey: 'sk-or-abc', baseURL: 'https://openrouter.ai/api/v1' });
  });

  it('NEVER sends the OpenAI key to a third-party base URL', () => {
    // Half a configuration must fall back to OpenAI's own endpoint rather than
    // pairing the OpenAI key with someone else's host.
    const partial = resolveLlmEndpoint({
      baseUrl: 'https://openrouter.ai/api/v1',
      openaiKey: 'sk-openai',
    });
    expect(partial).toEqual({ apiKey: 'sk-openai' });
    expect(partial?.baseURL).toBeUndefined();
  });

  it('falls back to OpenAI when only the alternate key is set', () => {
    expect(resolveLlmEndpoint({ altKey: 'sk-or-abc', openaiKey: 'sk-openai' })).toEqual({
      apiKey: 'sk-openai',
    });
  });

  it('treats blank and whitespace values as unset', () => {
    expect(resolveLlmEndpoint({ baseUrl: '  ', altKey: '  ', openaiKey: 'sk-openai' })).toEqual({
      apiKey: 'sk-openai',
    });
    expect(resolveLlmEndpoint({ openaiKey: '   ' })).toBeNull();
  });

  it('returns null when nothing usable is configured', () => {
    expect(resolveLlmEndpoint({})).toBeNull();
    expect(resolveLlmEndpoint({ baseUrl: 'https://openrouter.ai/api/v1' })).toBeNull();
  });

  it('trims surrounding whitespace off the values it does use', () => {
    expect(resolveLlmEndpoint({ baseUrl: ' https://x.ai/v1 ', altKey: ' sk-x ' })).toEqual({
      apiKey: 'sk-x',
      baseURL: 'https://x.ai/v1',
    });
  });
});
