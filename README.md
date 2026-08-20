# Job Board

A persona job board and application tracker. It aggregates software
engineering jobs from compliant sources, scores each employer's H1B sponsorship
likelihood against real US government data, filters out contract/staffing roles and
roles wanting more experience than I have, and tracks applications and hiring-manager
outreach.

**Organizing principle:** H1B sponsorship, ranked against government data — not a
yes/no checkbox. Every job shows an **H1B possibility** tier with a short "why",
derived from the employer's USCIS filing history and the posting's own words.

## Stack

- **App:** Next.js (App Router / RSC) · TypeScript (strict) · Tailwind · shadcn/ui · TanStack Query + Zustand
- **API:** Next.js Server Actions + tRPC (end-to-end types)
- **DB:** PostgreSQL + pgvector on Neon · Drizzle ORM
- **Pipeline:** Inngest (scheduled, durable, retryable ingestion + enrichment)
- **AI:** OpenAI (classification + skill extraction) · embeddings for résumé-bullet retrieval
- **Observability:** Sentry + OpenTelemetry · **CI:** GitHub Actions · **Hosting:** Vercel + Neon + S3

## Architecture

Five stages: **gather → check sponsorship → filter junk → rank by sponsorship + freshness → help apply & follow up.**
See [`CLAUDE.md`](./CLAUDE.md) for the full architecture, data model, and domain invariants.

## Getting started

```bash
nvm use                 # Node 22 LTS (.nvmrc)
pnpm install
cp .env.example .env     # fill in DATABASE_URL, OPENAI_API_KEY, etc.
pnpm dev
```

## Commands

| Task       | Command                                                   |
| ---------- | --------------------------------------------------------- |
| Dev server | `pnpm dev`                                                |
| Test       | `pnpm test` · `pnpm test:watch` · `pnpm test <path>`      |
| Quality    | `pnpm lint` · `pnpm typecheck` · `pnpm format`            |
| Database   | `pnpm db:generate` · `pnpm db:migrate` · `pnpm db:studio` |
| Pipeline   | `pnpm inngest:dev`                                        |

## Status

Feature-complete across Epics 0–13 (all five stages: gather → check sponsorship → filter junk → rank vs. résumé → apply & follow up). Ongoing work is tracked as GitHub Issues labeled `enhancement`.
