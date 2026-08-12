/**
 * Build the LLM clients the enrichment pipeline needs, from environment.
 *
 * One place for this so the Inngest function and the `pnpm enrich` CLI cannot
 * drift apart on which model, endpoint or embedding policy they use — they had
 * duplicated the construction inline.
 *
 * Classification can be routed to any OpenAI-compatible endpoint (OpenRouter,
 * etc.) with `OPENAI_CLASSIFY_BASE_URL` + `OPENAI_CLASSIFY_API_KEY`; without
 * both it falls back to OpenAI. See `endpoint.ts` for why both are required.
 */
import { resolveLlmEndpoint } from './endpoint';
import type { ChatClient, Embedder } from './types';

export const DEFAULT_CLASSIFY_MODEL = 'gpt-4o-mini';
export const DEFAULT_EMBED_MODEL = 'text-embedding-3-small';

/**
 * Just the variables this module reads, documented so a caller can see them at
 * a glance. The index signature is what lets `process.env` be passed directly:
 * an all-optional interface is a "weak type", and TypeScript rejects
 * `NodeJS.ProcessEnv` against one because they share no declared property.
 */
export interface ClientEnv {
  OPENAI_API_KEY?: string;
  OPENAI_CLASSIFY_BASE_URL?: string;
  OPENAI_CLASSIFY_API_KEY?: string;
  OPENAI_CLASSIFY_MODEL?: string;
  OPENAI_EMBED_MODEL?: string;
  ENRICH_EMBEDDINGS?: string;
  [key: string]: string | undefined;
}

export interface EnrichmentClients {
  chat: ChatClient;
  /**
   * Undefined unless embeddings are explicitly switched on — `jobs.embedding`
   * is written but never read, so paying to fill it is off by default. See
   * `steps/embed.ts`.
   */
  embedder?: Embedder;
}

/**
 * `??` is not enough here: the deployed `.env` has historically shipped these
 * as EMPTY strings, which `??` happily passes through to the API as a blank
 * model and 400s. Treat blank as unset.
 */
function envOr(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

export function embeddingsEnabled(env: ClientEnv = process.env): boolean {
  return env.ENRICH_EMBEDDINGS === '1' || env.ENRICH_EMBEDDINGS === 'true';
}

/** Chat (+ optional embedder) for enrichment, or null when no key is configured. */
export async function buildEnrichmentClients(
  env: ClientEnv = process.env,
): Promise<EnrichmentClients | null> {
  const endpoint = resolveLlmEndpoint({
    baseUrl: env.OPENAI_CLASSIFY_BASE_URL,
    altKey: env.OPENAI_CLASSIFY_API_KEY,
    openaiKey: env.OPENAI_API_KEY,
  });
  if (!endpoint) return null;

  const { default: OpenAI } = await import('openai');
  const { openaiChat, openaiEmbedder } = await import('./openai');

  const client = new OpenAI(
    endpoint.baseURL
      ? { apiKey: endpoint.apiKey, baseURL: endpoint.baseURL }
      : { apiKey: endpoint.apiKey },
  );
  const chat = openaiChat(client, envOr(env.OPENAI_CLASSIFY_MODEL, DEFAULT_CLASSIFY_MODEL));

  if (!embeddingsEnabled(env)) return { chat };

  // Embeddings stay on OpenAI: OpenRouter and most compatible gateways expose
  // chat completions only, so a classify endpoint override must not drag the
  // embedding call along with it.
  const openaiKey = env.OPENAI_API_KEY?.trim();
  if (!openaiKey) return { chat };
  const embedClient = endpoint.baseURL ? new OpenAI({ apiKey: openaiKey }) : client;
  return {
    chat,
    embedder: openaiEmbedder(embedClient, envOr(env.OPENAI_EMBED_MODEL, DEFAULT_EMBED_MODEL)),
  };
}
