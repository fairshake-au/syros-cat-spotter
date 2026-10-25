# CHECKPOINT: SYC-597 + SYC-711 flaky tests (test-only)
Env: `. $SCRATCH/env.sh` (esbuild 0.28.1 darwin pack, DATABASE_URL local pg, dummy OpenAI). Loop: `$SCRATCH/loop.sh <dir> <file> 20`.
Already Done in Linear: SYC-334, SYC-412 (and SYC-452 per #265). SYC-711 part 2 confirmed on main (#323).

## Done (one commit each)
- SYC-711 p6 placeholder: seed no longer 1h-ago across Athens midnight. 20/20.

## Next
695, 458, 699, 359, 551, 204, 367, 391, 421, 335, 327, 465, 584, 127, 321, 373 (321 also check un-awaited resolves)
## Rule: removing CHECKPOINT.md (git rm) before PR opens.
