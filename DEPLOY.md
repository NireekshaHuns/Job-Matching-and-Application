# Deploying the H1B Job Board

The app is a standard Next.js (App Router) project that deploys to **Vercel** with a
**Neon** Postgres database. It boots on a single required secret (`DATABASE_URL`); every
other integration is feature-gated and optional.

## Prerequisites

- A Vercel account connected to this GitHub repo.
- The existing Neon database (already migrated and seeded) or a new Neon branch.
- The AI keys you use locally (see `.env`), if you want résumé tailoring / keyword extraction.
- An Inngest Cloud app, if you want the in-app **"Find new jobs"** button to work (see
  [Background jobs](#background-jobs)).

## 1. One-time local build check

```bash
nvm use                       # Node 22 (.nvmrc)
pnpm install --frozen-lockfile
pnpm build                    # needs DATABASE_URL in .env — imports validate env at load
```

## 2. Create the Vercel project

1. **Add New → Project** and import this repo.
2. Framework preset auto-detects **Next.js** — leave build/output settings at their defaults
   (`pnpm build`). `packageManager` + `engines` in `package.json` pin pnpm 10 / Node 22.
3. **Set the environment variables (step 3) before the first deploy** — the build fails
   without `DATABASE_URL`.

> **Node version:** `engines.node` in `package.json` wins over the Vercel project's
> Node.js setting, so the pin here is what builds actually run on. Node 20 stopped being
> accepted for new Vercel builds on 2026-10-01, hence the 22.x pin.

## 3. Environment variables

Set for **Production** (and Preview if you use preview deploys). Vercel injects them at
build and runtime.

| Variable                                   | Required?                           | Notes                                    |
| ------------------------------------------ | ----------------------------------- | ---------------------------------------- |
| `DATABASE_URL`                             | **Yes — app won't boot without it** | Pooled Neon connection string.           |
| `AUTH_SECRET`                              | Yes (to lock the app)               | `openssl rand -base64 32`.               |
| `OWNER_EMAIL`                              | Yes (to lock the app)               | Your login email.                        |
| `OWNER_PASSWORD`                           | Yes (to lock the app)               | Your login password.                     |
| `OPENAI_API_KEY`                           | Recommended                         | Classify/embed + JD keyword extraction.  |
| `OPENAI_TAILOR_BASE_URL`                   | Recommended                         | e.g. OpenRouter, for GLM tailoring.      |
| `OPENAI_TAILOR_API_KEY`                    | Recommended                         | Tailoring endpoint key.                  |
| `OPENAI_TAILOR_MODEL`                      | Recommended                         | e.g. `z-ai/glm-4.6`.                     |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Only for "Find new jobs"            | See [Background jobs](#background-jobs). |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`     | Optional                            | Error monitoring.                        |

**Auth is all-or-nothing:** all three of `AUTH_SECRET`, `OWNER_EMAIL`, `OWNER_PASSWORD`
must be set, or the app stays fully public — `authorized()` in `src/server/auth/config.ts`
returns `true` for every route when the trio is absent. Since the tracker holds real
applications, contacts, and résumé content, treat these as required for a public URL.
Leave MS Graph / Hunter / Apollo / AWS / GitHub vars unset — they're feature-gated.

Do **not** set `E2E_DATABASE_URL` in Vercel: the Playwright seed truncates whatever it
points at.

## 4. Database

- **Reusing the existing Neon DB:** migrations (`drizzle/`) are already applied — nothing to do.
- **Fresh Neon DB:** run migrations once against it:
  ```bash
  DATABASE_URL="<new-neon-url>" pnpm db:migrate
  ```

Migrations are **not** applied at build/deploy time — run `pnpm db:migrate` manually whenever
new migrations land.

**Discovered ATS boards don't ship.** `ats-boards.json` (written by `pnpm ats:discover`) is
git-ignored, so production ingestion only fans out to the code-seeded boards in
`src/server/ingest/registry.ts`. Locally discovered boards are local-only until they're
promoted into those seed lists.

## 5. Deploy & verify

Push to `main` (or hit Deploy). After it's live:

1. Open the URL in a private window → redirects to `/sign-in`; correct owner creds log in.
2. `/dashboard` shows job counts (confirms the DB connection).
3. `/studio`: paste a JD → **Extract keywords** and **Generate résumé**; confirm the
   in-browser **WASM PDF preview** renders.
4. Drag-and-drop a PDF/.tex/.txt onto the Studio dropzone → it ingests into the corpus.
5. `/jobs` → **Find new jobs**: only meaningful once Inngest is wired up; confirm a run
   appears in the Inngest dashboard, then reload the board.
6. Check Vercel **Function logs** for 500s on first navigation.

## Background jobs

Ingestion + enrichment run on **Inngest**, and so does the in-app **"Find new jobs"**
button: `jobs.refresh` (`src/server/trpc/routers/jobs.ts`) only publishes a
`jobs/refresh.requested` event — the durable `enrich-jobs` function does the work. With no
Inngest keys set, that button has nothing to deliver to and the board won't pick up new
postings. Pick one:

- **Wire up Inngest (needed for the UI button + the cron).** In Inngest Cloud, add an app
  pointing at `https://<your-app>.vercel.app/api/inngest`, then set `INNGEST_EVENT_KEY` +
  `INNGEST_SIGNING_KEY` in Vercel and redeploy. The webhook is intentionally excluded from
  the auth middleware (`src/middleware.ts`), so it works with auth on.
- **Skip it and refresh from your machine**, pointing the CLI at the same Neon DB:
  ```bash
  pnpm enrich          # fetch + classify + score new postings
  pnpm score:fits      # re-score jobs × résumés
  ```
