/**
 * Single-user visa profile: the OPT / STEM-OPT end dates that drive the
 * tracker's time-sensitive nudges (spec §5.5). `get` returns the stored dates
 * plus freshly computed nudges; `set` upserts the single profile row.
 *
 * Single-user personal app: procedures are intentionally public (no auth).
 */
import { asc } from 'drizzle-orm';
import { z } from 'zod';
import { profile } from '@/server/db/schema';
import { computeVisaNudges } from '@/lib/visa/nudges';
import { createTRPCRouter, publicProcedure } from '../trpc';

/** The single profile row lives at a fixed id so `set` is a real upsert (no dup rows). */
const PROFILE_ID = 1;

/** True for a real calendar date in `YYYY-MM-DD` form (rejects e.g. 2027-02-30). */
function isCalendarDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** A valid `YYYY-MM-DD` date or null (to clear). */
const dateOrNull = z
  .string()
  .nullable()
  .refine((v) => v === null || isCalendarDate(v), 'expected a valid YYYY-MM-DD date');

export const setProfileInput = z.object({
  optEndDate: dateOrNull,
  stemOptEndDate: dateOrNull,
});

export const profileRouter = createTRPCRouter({
  /** The stored dates + current nudges (empty profile → just any cap-cycle nudge). */
  get: publicProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({ optEndDate: profile.optEndDate, stemOptEndDate: profile.stemOptEndDate })
      .from(profile)
      .orderBy(asc(profile.id))
      .limit(1);
    const dates = {
      optEndDate: row?.optEndDate ?? null,
      stemOptEndDate: row?.stemOptEndDate ?? null,
    };
    return { ...dates, nudges: computeVisaNudges(dates) };
  }),

  /** Upsert the single profile row (full replace of both dates). */
  set: publicProcedure.input(setProfileInput).mutation(async ({ ctx, input }) => {
    // Fixed-id upsert: concurrent first-time saves can't create a second row.
    await ctx.db
      .insert(profile)
      .values({ id: PROFILE_ID, ...input })
      .onConflictDoUpdate({
        target: profile.id,
        set: { ...input, updatedAt: new Date() },
      });
    return { ...input, nudges: computeVisaNudges(input) };
  }),
});
