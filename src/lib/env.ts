import { z } from 'zod';

/**
 * Runtime environment validation. Imported only by modules that actually need a
 * given secret (db client, OpenAI client, Inngest), so plumbing and unit tests
 * that don't touch those stay free of env requirements.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  // Optional: only the opt-in enrich/tailor scripts + Inngest use OpenAI, and
  // they read process.env directly. Keeping it optional (and treating an empty
  // string as absent, since .env.example ships it blank) lets the web app + DB
  // boot with just DATABASE_URL.
  OPENAI_API_KEY: z.preprocess((v) => (v ? v : undefined), z.string().min(1).optional()),
  OPENAI_CLASSIFY_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_EMBED_MODEL: z.string().default('text-embedding-3-small'),
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
