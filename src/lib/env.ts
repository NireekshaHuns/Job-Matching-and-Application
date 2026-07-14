import { z } from 'zod';

/**
 * Runtime environment validation. Imported only by modules that actually need a
 * given secret (db client, OpenAI client, Inngest), so plumbing and unit tests
 * that don't touch those stay free of env requirements.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_CLASSIFY_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_EMBED_MODEL: z.string().default('text-embedding-3-small'),
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
