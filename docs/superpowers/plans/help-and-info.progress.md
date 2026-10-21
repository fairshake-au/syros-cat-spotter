# Help & info build: progress

Checkpoint notes, newest last. Each agent appends after every commit.

- 21 Oct: plan approved. Step 1 starting.
- 1.1 done: migration generated as `0035_report_suggested_cat` (this branch's base has no 0035, and the runner needs journal idx contiguous, so drizzle numbers it 0035; renumber to 0036 on rebase once the SYC-396 0035 lands). migrate:check ok; runner.test.ts (rollback) 25/25. Next: 1.2 reports routes.
- 1.2 done: catId on both report bodies, knownCatId(tx|db), explicit reporterCatId in both upsert sets; reports.test.ts 38/38. Next: probes for 1.2 (recorded below), then 1.3.
