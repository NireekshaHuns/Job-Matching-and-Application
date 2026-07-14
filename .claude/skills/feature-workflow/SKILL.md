---
name: feature-workflow
description: The per-ticket definition of done for this project. Use at the start of any GitHub Issue / feature so every session follows the same branch → implement → test → PR → review → summary flow.
---

# Feature workflow (per-ticket definition of done)

Work one GitHub Issue at a time. Pause after each completed feature for the summary
below before starting the next. Do not implement unrequested scope — propose it as a
new Issue labeled `enhancement`.

## Flow

1. **Branch** from the issue: `feat/<issue-number>-<slug>` (or `fix/…`, `chore/…`).
2. **Implement** the change in small, logical commits (Conventional Commits).
3. **Test with Vitest**:
   - Connectors → fixture-based tests (see `add-job-source`).
   - Scoring / classification / sponsorship logic → deterministic unit tests.
   - tRPC procedures → caller-based tests.
4. **Green gates** (hooks enforce, but run them): `pnpm lint`, `pnpm typecheck`, `pnpm test`.
5. **Push** when the ticket is done (not after every edit). Never force-push `main`.
6. **Open a PR that closes the issue** (`Closes #N`).
7. **Run the `code-reviewer` subagent** on the diff (read-only). Address findings in the
   main session.
8. **Post a summary** to the user: what changed, which files, how to test it manually, and
   what the unit tests cover.

## Guardrails

- Ask before anything destructive/irreversible, before adding a paid service, and before
  large architecture or data-model changes.
- Secrets stay in `.env` (git-ignored); keep `.env.example` current. Never commit secrets.
- Cost control: LLM classify/embed once per new job; never re-analyze.
