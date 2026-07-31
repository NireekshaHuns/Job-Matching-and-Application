/**
 * Single-user visa profile: the OPT / STEM-OPT end dates that drive the
 * tracker's time-sensitive nudges (spec §5.5). `get` returns the stored dates
 * plus freshly computed nudges; `set` upserts the single profile row.
 *
 * Single-user personal app: procedures are intentionally public (no auth).
 */
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { profile } from '@/server/db/schema';
import { computeVisaNudges } from '@/lib/visa/nudges';
import { createTRPCRouter, publicProcedure } from '../trpc';

/** A `YYYY-MM-DD` date or null (to clear). */
const dateOrNull = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .nullable();

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
    const [existing] = await ctx.db
      .select({ id: profile.id })
      .from(profile)
      .orderBy(asc(profile.id))
      .limit(1);

    if (existing) {
      await ctx.db
        .update(profile)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(profile.id, existing.id));
    } else {
      await ctx.db.insert(profile).values(input);
    }
    return { ...input, nudges: computeVisaNudges(input) };
  }),
});
