# Deploying the H1B Job Board

The app is a standard Next.js (App Router) project that deploys to **Vercel** with a
**Neon** Postgres database. It boots on a single required secret (`DATABASE_URL`); every
other integration is feature-gated and optional.

## Prerequisites

- A Vercel account connected to this GitHub repo.
- The existing Neon database (already migrated and seeded) or a new Neon branch.
- The AI keys you use locally (see `.env`), if you want résumé tailoring / keyword extraction.

## 1. One-time local build check

```bash
nvm use                       # Node 20 (.nvmrc)
pnpm install --frozen-lockfile
pnpm build                    # needs DATABASE_URL in .env — imports validate env at load
```

## 2. Create the Vercel project

1. **Add New → Project** and import this repo.
2. Framework preset auto-detects **Next.js** — leave build/output settings at their defaults
   (`pnpm build`). `packageManager` + `engines` in `package.json` pin pnpm 10 / Node 20.
3. **Set the environment variables (step 3) before the first deploy** — the build fails
   without `DATABASE_URL`.

## 3. Environment variables

Set for **Production** (and Preview if you use preview deploys). Vercel injects them at
build and runtime.

| Variable                               | Required?                           | Notes                                   |
| -------------------------------------- | ----------------------------------- | --------------------------------------- |
| `DATABASE_URL`                         | **Yes — app won't boot without it** | Pooled Neon connection string.          |
| `AUTH_SECRET`                          | Yes (to lock the app)               | `openssl rand -base64 32`.              |
| `OWNER_EMAIL`                          | Yes (to lock the app)               | Your login email.                       |
| `OWNER_PASSWORD`                       | Yes (to lock the app)               | Your login password.                    |
| `OPENAI_API_KEY`                       | Recommended                         | Classify/embed + JD keyword extraction. |
| `OPENAI_TAILOR_BASE_URL`               | Recommended                         | e.g. OpenRouter, for GLM tailoring.     |
| `OPENAI_TAILOR_API_KEY`                | Recommended                         | Tailoring endpoint key.                 |
| `OPENAI_TAILOR_MODEL`                  | Recommended                         | e.g. `z-ai/glm-4.6`.                    |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Optional                            | Error monitoring.                       |

**Auth is all-or-nothing:** all three of `AUTH_SECRET`, `OWNER_EMAIL`, `OWNER_PASSWORD`
must be set, or the app stays fully public (`src/server/auth/config.ts`). Leave
Inngest / MS Graph / Hunter / Apollo / AWS / GitHub vars unset — they're feature-gated.

## 4. Database

- **Reusing the existing Neon DB:** migrations (`drizzle/`) are already applied — nothing to do.
- **Fresh Neon DB:** run migrations once against it:
  ```bash
  DATABASE_URL="<new-neon-url>" pnpm db:migrate
  ```

Migrations are **not** applied at build/deploy time — run `pnpm db:migrate` manually whenever
new migrations land.

## 5. Deploy & verify

Push to `main` (or hit Deploy). After it's live:

1. Open the URL in a private window → redirects to `/sign-in`; correct owner creds log in.
2. `/dashboard` shows job counts (confirms the DB connection).
3. `/studio`: paste a JD → **Extract keywords** and **Generate résumé**; confirm the
   in-browser **WASM PDF preview** renders.
4. Drag-and-drop a PDF/.tex/.txt onto the Studio dropzone → it ingests into the corpus.
5. Check Vercel **Function logs** for 500s on first navigation.

## Background jobs (deferred)

Scheduled ingestion/enrichment runs on **Inngest** and is **off by default** in production.
To enable it later: register `/api/inngest` with Inngest Cloud and add the `INNGEST_EVENT_KEY`
and `INNGEST_SIGNING_KEY` vars in Vercel. Until then, refresh jobs via **"Find new jobs"** in
the UI or the CLI scripts against the same Neon DB.
