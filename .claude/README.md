# Claude Code setup

Project-local Claude Code configuration for the H1B Job Board.

## Skills (`skills/`)

Playbooks Claude loads on demand:

- **add-job-source** — add an ingestion connector (common interface, dedup fingerprint, fixture test).
- **db-change** — change the Drizzle schema → generate → apply migration → regenerate types.
- **enrichment-step** — add/modify a durable Inngest pipeline step (retries, caching, unit test).
- **feature-workflow** — the per-ticket definition of done (branch → test → PR → review → summary).

## Subagents (`agents/`)

- **code-reviewer** — read-only (Read/Grep/Glob, sonnet). Run on a diff after each feature.
  Use the built-in **Explore** agent for codebase questions. Subagents never edit.

## Hooks (`hooks/`, wired in `settings.json`)

- **PreToolUse** guardrail — blocks writing `.env`/secret files, `rm -rf`, and force-push to `main`.
- **PostToolUse** — Prettier-formats edited `.ts`/`.tsx` then runs `pnpm typecheck`.
- **Stop** — runs `pnpm test` so a turn never finishes with failing tests.

## MCP servers (`../.mcp.json`)

Both are remote, OAuth-authenticated (no secrets in the repo). Run `/mcp` in Claude Code to sign in.

- **github** — issues, PRs, push (`https://api.githubcopilot.com/mcp/`).
- **neon** — inspect the database during dev (`https://mcp.neon.tech/mcp`).
