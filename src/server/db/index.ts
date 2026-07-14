import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { env } from '@/lib/env';
import * as schema from './schema';

/**
 * Drizzle client backed by Neon's serverless HTTP driver. pgvector columns are
 * declared in `schema.ts` and queried via Drizzle's `sql` helper.
 */
const sql = neon(env.DATABASE_URL);
export const db = drizzle(sql, { schema });
export type DB = typeof db;
