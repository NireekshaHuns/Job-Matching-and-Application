/**
 * Real OpenAI adapters for the injected `ChatClient` / `Embedder` interfaces.
 * Kept isolated so the rest of enrichment never imports the SDK directly and
 * stays testable with fakes. Only used at runtime (script / Inngest function).
 */
import type OpenAI from 'openai';
import type { ChatClient, Embedder } from './types';

/** Chat client that asks for a strict JSON object at temperature 0. */
export function openaiChat(client: OpenAI, model: string): ChatClient {
  return {
    async complete({ system, user }) {
      const res = await client.chat.completions.create({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      return res.choices[0]?.message?.content ?? '{}';
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
