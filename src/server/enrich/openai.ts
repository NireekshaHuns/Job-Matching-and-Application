/**
 * Real OpenAI adapters for the injected `ChatClient` / `Embedder` interfaces.
 * Kept isolated so the rest of enrichment never imports the SDK directly and
 * stays testable with fakes. Only used at runtime (script / Inngest function).
 */
import type OpenAI from 'openai';
import type { ChatClient, Embedder } from './types';

/**
 * Chat client at temperature 0. `jsonMode` (default true) asks for a strict
 * JSON object — right for classify/extract/email, but WRONG for résumé
 * tailoring, which returns a raw LaTeX document (OpenAI 400s on json_object
 * unless "json" appears in the prompt). Pass `{ jsonMode: false }` for free-text
 * output; it also falls back to '' (not '{}') when the response is empty.
 */
export function openaiChat(
  client: OpenAI,
  model: string,
  opts: { jsonMode?: boolean } = {},
): ChatClient {
  const jsonMode = opts.jsonMode ?? true;
  return {
    async complete({ system, user }) {
      const res = await client.chat.completions.create({
        model,
        temperature: 0,
        ...(jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      return res.choices[0]?.message?.content ?? (jsonMode ? '{}' : '');
    },
  };
}

/**
 * Max inputs per embeddings request. The API allows far more; this is a
 * conservative chunk so a résumé with an unusual number of bullets still sends
 * a bounded payload.
 */
const EMBED_BATCH = 96;

export function openaiEmbedder(client: OpenAI, model: string): Embedder {
  return {
    async embed(text) {
      const res = await client.embeddings.create({ model, input: text });
      return res.data[0]?.embedding ?? [];
    },
    /**
     * One request per batch instead of one per text. Matters on the résumé
     * upload path, where a serverless invocation used to spend a round trip per
     * bullet and could run past its time limit.
     */
    async embedMany(texts) {
      const out: (number[] | null)[] = [];
      for (let i = 0; i < texts.length; i += EMBED_BATCH) {
        const batch = texts.slice(i, i + EMBED_BATCH);
        const res = await client.embeddings.create({ model, input: batch });
        // Trust `index` rather than array order — the API documents results as
        // indexed, and a mis-ordered vector would silently corrupt retrieval.
        const byIndex = new Map(res.data.map((d) => [d.index, d.embedding]));
        for (let j = 0; j < batch.length; j++) out.push(byIndex.get(j) ?? null);
      }
      return out;
    },
  };
}
