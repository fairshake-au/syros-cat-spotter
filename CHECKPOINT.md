# SYC-199 + SYC-307 checkpoint
Done: schema + migration 0050 (unique supersedes index replaces 0030's plain one; colony expression index), migrate:check ok.
Next: one-colony page uses catsInColony; EXPLAIN before/after on seeded local db (db syc199); tests; prod dup check result from coordinator (local_baf9188a...); full suites; draft PR; Linear In Progress.
Local env: ESBUILD_BINARY_PATH=<scratchpad>/package/bin/esbuild DATABASE_URL=postgres://localhost:5432/syc199
