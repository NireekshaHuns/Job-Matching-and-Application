# CLAUDE.md — H1B Job Board

Personal H1B-focused job board + application tracker, and a portfolio piece (code quality, tests, and clean git history matter). Aggregates SWE jobs from compliant sources, scores each employer's H1B sponsorship likelihood against real US government data, filters out contract/staffing roles, ranks jobs against my resume(s), and tracks applications + hiring-manager outreach.

**Core principle:** H1B sponsorship is the organizing principle, ranked against government data — not a yes/no checkbox. Every job shows two independent scores: an H1B possibility tier and a relevance score vs. a selected resume.

## Stack

- Frontend: Next.js (App Router / RSC), TypeScript (strict), Tailwind, shadcn/ui, TanStack Query + Zustand.
- API: Next.js Server Actions + tRPC (no separate backend framework).
- DB: PostgreSQL + pgvector on Neon, Drizzle ORM.
- Pipeline: Inngest (scheduled, durable, retryable multi-step ingestion + enrichment).
- AI: LLM API (OpenAI or Anthropic) for classify + skill extraction; embeddings for relevance; pgvector for similarity. Classifier built as small testable steps with a lightweight evals harness.
- Integrations: Microsoft Graph (Outlook), GitHub API (job repos), public ATS feeds (Greenhouse/Lever/Ashby), one aggregator API (JSearch or FlyByAPIs).
- Storage: AWS S3 (resume PDFs). Infra: Terraform. CI: GitHub Actions. Observability: Sentry + OpenTelemetry.
- Hosting: Vercel + Neon + S3. Package manager: pnpm. Tests: Vitest. Lint/format: ESLint + Prettier.

## Architecture

Five stages: gather → check sponsorship → filter junk → rank vs. resume → help apply & follow up.

1. Inngest cron fans out to one connector per source; each writes new postings to `raw_jobs`.
2. Enrichment (durable, per-step retries): dedup by fingerprint → sponsor match → LLM classify (employment type + H1B tier + required skills) → embed JD → write clean row to `jobs`.
3. PostgreSQL + pgvector is the single source of truth.
4. Resume PDFs in S3; each resume embedded; relevance scored per job × resume into `job_scores`.
5. Next.js + tRPC app reads Postgres → board, tracker, outreach, dashboard. Outlook import via Graph; outreach helper opens a targeted hiring-manager search and logs a daily count.

## Data model

- `sponsors` — per company: `company_name_normalized` (join key), `sponsor_count`, `approval_rate`, `last_filed_year`.
- `resumes` — `id`, `label`, `s3_key`, `embedding`.
- `jobs` — `id`, `fingerprint` (company + normalized title + location), `source`, `url`, `posted_date`, `company`, `title`, `location`, `jd_text`, `embedding`, `employment_type` (full_time | contract), `sponsor_tier` (High | Medium | Low | Excluded), `sponsor_reason`, `sponsor_count`.
- `job_scores` — `job_id`, `resume_id`, `relevance_score` (0–100), `skill_gaps` (string[]).
- `applications` — `id`, `job_id`, `resume_id`, `status`, `applied_at`, `source` (manual | outlook).
- `contacts` — `id`, `job_id`, `name`, `title`, `linkedin_url`.
- `outreach_log` — `id`, `contact_id`, `contacted_at`, `channel`.

## Domain rules (invariants — do not violate)

- **Never discard unknown sponsorship.** Tier it: High (JD states sponsorship, or heavy sponsor history), Medium (company sponsored before, JD silent), Low (JD silent + little/no history). Only explicit disqualifiers ("no sponsorship", "must be authorized without sponsorship", "US citizen / GC only") → `Excluded`.
- `Excluded` jobs are hidden by default but retained, with a UI toggle to view them (so the filter can be audited).
- Employment filter: drop contract / staffing / C2C / 1099 / "W-2 contract"; keep full-time direct-hire.
- Two independent scores stored and displayed per job card: H1B possibility (tier + short "why") and relevance (% vs selected resume + skill-gap chips). A combined score exists only as the default sort; both scores are independently sortable. Never blend them into a single stored value.
- Multiple resumes ("lenses"): relevance is computed per job × resume. Jobs whose required skills exceed a resume are **not hidden** — they score lower and show the gap (e.g. "missing: Kafka, Go").
- Cost control: run LLM classify/embed **once per new job** and cache; never re-analyze an already-processed job.
- Sourcing: never scrape LinkedIn/Indeed/Glassdoor directly — their listings only via the aggregator API. Prefer public ATS endpoints and public GitHub repos.
- Do NOT build application autofill (Simplify's extension handles the submit step).

## Conventions

- Strict TypeScript; no `any` without a comment justifying it.
- DB changes go through Drizzle: edit schema → generate migration → apply → regenerate types (see the `db-change` skill).
- New ingestion sources implement the common connector interface with a dedup fingerprint and fixture-based tests (see the `add-job-source` skill).
- Inngest steps are small and individually testable (see the `enrichment-step` skill).
- Secrets live in `.env` (git-ignored); keep `.env.example` current. Never commit secrets.
- Conventional Commit messages. Small, logical commits.

## Working process

- Work one ticket (GitHub Issue) at a time. Pause after each completed feature for a summary before starting the next.
- Definition of done per ticket: branch from the issue → implement → write Vitest unit tests → `pnpm format:check` + lint + typecheck + tests pass → commit in small chunks → push → open a PR that closes the issue → run the read-only `code-reviewer` subagent on the diff and address findings → ensure CI is green → **squash-merge the PR and delete the branch** → post a summary (what changed, which files, how to test manually, what the tests cover).
- Always run `pnpm format:check` before pushing (CI enforces it, and the post-edit hook doesn't always cover every file).
- Merging is part of the flow: once a PR is green and its review is addressed, squash-merge it (matching the repo's `… (#NN)` history) and delete the branch — don't leave finished PRs open. If the PR was based on an older `main` (e.g. an earlier PR merged first), update it from `main`, re-run the gates, and let CI re-verify the combination before merging.
- Commit small and often; push when a ticket is done (not after every edit). Never force-push `main`.
- Propose genuinely useful new features/tools as GitHub Issues labeled `enhancement`; don't implement unrequested scope.
- Ask me before anything destructive or irreversible, before adding a paid service, and before large changes to architecture or data model.

## Descoped (intentional)

The Stack/Architecture sections above describe the original intent; these pieces were deliberately dropped and are **not** pending work (don't reintroduce without asking):

- **Aggregator API connector** (JSearch / FlyByAPIs) — public ATS feeds + the GitHub repo give enough coverage.
- **Embedding / pgvector relevance** — relevance uses interpretable keyword overlap instead (`src/server/resume/fit.ts`). The `embedding` columns/indexes exist but don't feed scoring.
- **S3 resume storage** — resumes are handled locally (PDF text extraction + LaTeX compile).
- **Terraform** — no infra-as-code.
- **Standalone `/outreach` route** — outreach lives in the tracker page as `OutreachPanel`.

## Commands

Runtime: Node 20 LTS (`.nvmrc`) + pnpm 10. Run `nvm use` on entry if needed.

- Dev: `pnpm dev`
- Test: `pnpm test` · single file: `pnpm test <path>` · watch: `pnpm test:watch`
- Lint: `pnpm lint` · Typecheck: `pnpm typecheck` · Format: `pnpm format` (`format:check` in CI)
- DB: `pnpm db:generate` (migration) · `pnpm db:migrate` · `pnpm db:push` (dev sync) · `pnpm db:studio`
- Inngest dev server: `pnpm inngest:dev`

## Extensions

- Skills (`.claude/skills/`): `add-job-source`, `db-change`, `enrichment-step`, `feature-workflow`.
- Subagents (`.claude/agents/`): read-only `code-reviewer` (Read/Grep/Glob, sonnet); use built-in Explore for codebase questions. Subagents stay read-only; edits happen in the main session.
- Hooks: PostToolUse (Prettier + typecheck on .ts/.tsx edits), Stop (run tests), PreToolUse guardrail (block secrets/.env writes, `rm -rf`, force-push to main).
- MCP: GitHub (issues/PRs/push), Neon/Postgres (inspect DB). Optional later: Playwright (e2e), Atlassian (if Jira replaces GitHub Issues).
