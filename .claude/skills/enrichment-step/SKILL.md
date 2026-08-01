---
name: enrichment-step
description: Add or modify an Inngest enrichment pipeline step (dedup, sponsor match, LLM classify, embed, write jobs). Use when touching the durable ingestion/enrichment pipeline. Covers step isolation, retries, caching, and unit tests.
---

# Enrichment pipeline step

The enrichment pipeline is a durable Inngest function whose steps each retry
independently. Order: dedup by fingerprint → drop non-software titles
(`looksLikeSwe`, before any paid call) → sponsor match → LLM classify
(employment_type + sponsor_tier + sponsor_reason + required skills) → embed JD →
write scored row to `jobs`.

## Steps

1. **Write the step logic** as a pure, testable function in
   `src/server/enrich/steps/<step>.ts` — inputs in, result out, no Inngest coupling.
   Keep it small (one responsibility). Inject external clients (OpenAI, db) as args.

2. **Wire it into the Inngest function** in `src/inngest/functions/` using `step.run('name', fn)`
   so it becomes an individually-retried, durable step. Register the function in
   `src/inngest/functions/index.ts`.

3. **Cache — run LLM classify/embed once per new job.** Gate the expensive steps on
   whether the job was already processed (check the `jobs` row / a cache key). Never
   re-analyze an already-processed job. This is a hard cost-control invariant.

4. **Unit test** the pure step (Vitest) with a stubbed client and deterministic input.
   For the classifier, add/extend cases in the evals harness (`src/server/enrich/evals/`)
   so classification quality is measured, not vibes.

5. Run `pnpm lint && pnpm typecheck && pnpm test <path>`.

## Sponsorship invariants (do not violate)

- Never discard unknown sponsorship. Tier it: High / Medium / Low. Only explicit
  disqualifiers ("no sponsorship", "must be authorized without sponsorship",
  "US citizen / GC only") → `Excluded` (retained + hidden by default).
- Employment filter drops contract/staffing/C2C/1099/"W-2 contract"; keep full-time direct-hire.
- Store `sponsor_tier` and `relevance_score` separately — never merge into one value.
