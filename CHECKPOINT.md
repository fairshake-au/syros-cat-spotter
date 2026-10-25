# CHECKPOINT: SYC-597 + SYC-711 flaky tests (test-only)
Env: `. $SCRATCH/env.sh`; loop: `$SCRATCH/loop.sh <dir> <file> 20` (scratchpad of this session).
Already Done in Linear: SYC-334, SYC-412 (SYC-452 fixed by #265). SYC-711 part 2 confirmed on main (#323).
SYC-421 was fixed in #317 (SYC-537: beforeEach clears shared welfare_reports); 20/20 now.

## Committed (one per ticket), 20-run tallies
711 p6, 359, 699, 551, 695(+keepSafe.code), 458 (20/20 takeover), 204 (20/20), 367 (20/20), 327 (code, loop pending),
127/321/373 (lib/db vitest.config.ts; loops pending), 465 + 584 (20/20 each, app)

## Next
- loops: matchHardening, lib/db files; forced straddle demo for 327
- 335 (claim v2) and 391 (team.walk): try to reproduce / read; else comment
- keepSafe.code timing test failed once ("112 <= 100") while a full suite ran concurrently - file as new ticket
- full api-server suite + app suite + lib/db suite, then `git rm CHECKPOINT.md`, draft PR with table
- Linear: comment/close, message live sessions before merge (not merging)
