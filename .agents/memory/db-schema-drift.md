---
name: Dev DB schema drift
description: Symptoms and fix when the dev Postgres is missing columns defined in the Drizzle schema
---
Rule: if API routes 500 with drizzle "Failed query" errors mentioning a column that exists in the schema code, the dev database is behind — run the db package's `push` script before debugging application code.

**Why:** The username feature shipped with schema code but the column was never pushed; every username endpoint returned Express HTML 500s that looked like app bugs.

**How to apply:** On any "column does not exist"-style failure, compare `\d <table>` against the Drizzle schema first, then `pnpm --filter @workspace/db run migrate`. `push` no longer exists (SYC-64): schema changes are `pnpm --filter @workspace/db run generate`, plus a hand-written `-- rollback-begin`/`-- rollback-end` block, committed under `lib/db/migrations/`.
