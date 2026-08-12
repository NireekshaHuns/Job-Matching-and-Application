/**
 * Which OpenAI-compatible endpoint a given LLM call should use.
 *
 * The app talks to more than one provider: tailoring runs on OpenRouter (a
 * cheap GLM model) while classification and embeddings historically ran on
 * OpenAI. This is the shared, pure routing rule so every caller enforces the
 * same safety invariant — and so it can be unit-tested once rather than per
 * call site.
 *
 * THE INVARIANT: the alternate endpoint is only used when BOTH a base URL and
 * its own key are set. Half a configuration falls back to plain OpenAI rather
 * than sending the OpenAI key to a third party's base URL.
 */

export interface LlmEndpoint {
  apiKey: string;
  /** Absent means the provider default (api.openai.com). */
  baseURL?: string;
}

export function resolveLlmEndpoint(env: {
  /** Alternate OpenAI-compatible base URL, e.g. OpenRouter. */
  baseUrl?: string;
  /** Key belonging to that alternate endpoint. */
  altKey?: string;
  /** Fallback OpenAI key. */
  openaiKey?: string;
}): LlmEndpoint | null {
  const baseURL = env.baseUrl?.trim();
  const altKey = env.altKey?.trim();
  if (baseURL && altKey) return { apiKey: altKey, baseURL };
  const openaiKey = env.openaiKey?.trim();
  return openaiKey ? { apiKey: openaiKey } : null;
}
