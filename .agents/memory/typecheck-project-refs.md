---
name: Typecheck needs libs built first
description: Per-artifact tsc typecheck fails with phantom "property does not exist" errors when lib/* project references are stale.
---
Rule: always run `pnpm run typecheck:libs` (root `tsc --build`) before any per-artifact `tsc -p ... --noEmit`.

**Why:** Artifact tsconfigs reference composite lib packages whose declaration outputs live in `dist/`. If those are stale (e.g. schema columns added), typecheck reports TS2339 "property does not exist" on symbols that clearly exist in source. Also run `pnpm install` first — a fresh clone lacks vitest/tsc binaries.

**How to apply:** Registered validation `api-typecheck` already chains both; reuse the same pattern for any new artifact's typecheck validation.
