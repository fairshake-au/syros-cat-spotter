---
name: Drizzle wraps pg error codes
description: How to detect Postgres unique-violation (23505) errors when using drizzle-orm
---

Drizzle-orm can wrap node-postgres errors in a DrizzleQueryError, so `err.code === "23505"` fails — the pg code lives on `err.cause.code`.

**Why:** A concurrency test showed a unique-index race returning 500 instead of 409 because the catch block only checked the top-level `code`.

**How to apply:** When catching DB constraint violations, walk the `cause` chain (see `isUniqueViolation` in the api-server profiles route) instead of checking `err.code` directly.
