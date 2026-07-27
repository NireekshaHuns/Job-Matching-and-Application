---
name: db-change
description: Change the database schema. Use whenever adding/altering a table or column. Covers editing the Drizzle schema, generating + applying a migration, and regenerating types — never hand-edit SQL or the DB directly.
---

# Database change

All DB changes go through Drizzle. The schema in `src/server/db/schema.ts` is the single
source of truth. Never `ALTER TABLE` by hand or edit generated SQL.

## Steps

1. **Edit the schema** in `src/server/db/schema.ts`. Match the data model in CLAUDE.md.
   For vector columns use Drizzle's `vector('embedding', { dimensions: N })` (pgvector).
   text-embedding-3-small = 1536 dims.

2. **Generate the migration**: `pnpm db:generate`. This writes SQL to `drizzle/`. Review the
   generated SQL — confirm it does what you intended (no unintended drops).

3. **Apply it**:
   - Local/dev iteration: `pnpm db:push` to sync fast, OR `pnpm db:migrate` to apply the
     versioned migration (preferred once a migration is committed).
   - The `pgvector` extension must exist: `CREATE EXTENSION IF NOT EXISTS vector;` (add as the
     first migration if not present).
   - **Papercut:** drizzle-kit does NOT emit `CREATE EXTENSION`. It is hand-added as the first
     line of migration `0000` and is not tracked in `meta/`. If you ever regenerate `0000`
     (delete + `db:generate`), re-add that line at the top, before any `vector(...)` column or
     `USING hnsw` index — Postgres needs the type/opclass to exist first.

4. **Types regenerate automatically** — Drizzle infers TS types from the schema, so `import`
   the table and its `$inferSelect` / `$inferInsert` types. Run `pnpm typecheck` to confirm
   downstream code still compiles.

5. **Commit** the schema change AND the generated `drizzle/` migration together, in one commit.

## Invariants

- Migrations are forward-only and committed to git; never delete an applied migration.
- Denormalized columns (e.g. `jobs.sponsor_count`) are written by the pipeline, not by hand.
- Keep the two scores (`sponsor_tier`, `relevance_score`) in separate columns — never blend.
- Ask before destructive migrations (dropping columns/tables with data).
