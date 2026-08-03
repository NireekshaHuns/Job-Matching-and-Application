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

export function openaiEmbedder(client: OpenAI, model: string): Embedder {
  return {
    async embed(text) {
      const res = await client.embeddings.create({ model, input: text });
      return res.data[0]?.embedding ?? [];
    },
  };
}
