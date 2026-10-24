# Checkpoint (SYC-557 + SYC-620)
Done: Areas page: Add via map picker (/team/areas/new, /new/map, /new/pick), Bring back (kind "restored", no migration), MIN_AREAS=5 guard. Tests added; areas+teamPages suites pass.
Next: SYC-620 Home (empty-state wording, skip unused colonyFigures work, per-figure failure + tests, island-wide viewers test), then full api-server suite, screenshots, draft PR.
Env: ESBUILD_BINARY_PATH from scratchpad esb/package/bin/esbuild; DATABASE_URL=postgres://localhost:5432/catspotter_test
