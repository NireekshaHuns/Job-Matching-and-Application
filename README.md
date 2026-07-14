# H1B Job Board

A personal, H1B-focused job board and application tracker. It aggregates software
engineering jobs from compliant sources, scores each employer's H1B sponsorship
likelihood against real US government data, filters out contract/staffing roles,
ranks jobs against my resume(s), and tracks applications and hiring-manager outreach.

**Organizing principle:** H1B sponsorship, ranked against government data — not a
yes/no checkbox. Every job shows two independent scores: an **H1B possibility** tier
(with a short "why") and a **relevance** score against a selected resume (with
skill-gap chips).

## Stack

- **App:** Next.js (App Router / RSC) · TypeScript (strict) · Tailwind · shadcn/ui · TanStack Query + Zustand
- **API:** Next.js Server Actions + tRPC (end-to-end types)
- **DB:** PostgreSQL + pgvector on Neon · Drizzle ORM
- **Pipeline:** Inngest (scheduled, durable, retryable ingestion + enrichment)
- **AI:** OpenAI (classification + skill extraction) · embeddings + pgvector for relevance
- **Observability:** Sentry + OpenTelemetry · **CI:** GitHub Actions · **Hosting:** Vercel + Neon + S3

## Architecture

Five stages: **gather → check sponsorship → filter junk → rank vs. resume → help apply & follow up.**
See [`CLAUDE.md`](./CLAUDE.md) for the full architecture, data model, and domain invariants.

## Getting started

```bash
nvm use                 # Node 20 LTS (.nvmrc)
pnpm install
cp .env.example .env     # fill in DATABASE_URL, OPENAI_API_KEY, etc.
pnpm dev
```

## Commands

| Task       | Command                                                       |
| ---------- | ------------------------------------------------------------- |
| Dev server | `pnpm dev`                                                    |
| Test       | `pnpm test` · `pnpm test:watch` · `pnpm test <path>`          |
| Quality    | `pnpm lint` · `pnpm typecheck` · `pnpm format`                |
| Database   | `pnpm db:generate` · `pnpm db:migrate` · `pnpm db:studio`     |
| Pipeline   | `pnpm inngest:dev`                                            |

## Status

Foundation scaffolded (Epic 0). Feature work is tracked as GitHub Issues across Epics 1–8.
