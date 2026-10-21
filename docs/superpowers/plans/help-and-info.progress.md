# Help & info build: progress

Checkpoint notes, newest last. Each agent appends after every commit.

- 21 Oct: plan approved. Step 1 starting.
- 1.1 done: migration generated as `0035_report_suggested_cat` (this branch's base has no 0035, and the runner needs journal idx contiguous, so drizzle numbers it 0035; renumber to 0036 on rebase once the SYC-396 0035 lands). migrate:check ok; runner.test.ts (rollback) 25/25. Next: 1.2 reports routes.
- 1.2 done: catId on both report bodies, knownCatId(tx|db), explicit reporterCatId in both upsert sets; reports.test.ts 38/38. Next: probes for 1.2 (recorded below), then 1.3.
- 1.2 probes (all restored with git checkout; reports.test.ts back to 38/38):
  - drop reporterCatId from submit `set` -> FAIL "a draft with a cat, then a submit with catId null, ends null" (expected 2 to be null)
  - drop it from draft `set` -> FAIL "the draft route stores and clears the suggestion the same way" (expected 4 to be null)
  - set catId in submit insert -> FAIL "a known catId sets reporter_cat_id and leaves cat_id null" (expected 1 to be null)
  - set catId in draft insert -> FAIL "a draft names the cat but never sets cat_id" (expected 7 to be null) plus two more
- 1.3 done: /api/go/give (shared handler, count:false), gate exact path, new LINK_OFF_PAGE bodies (go.ts:35 comment fixed here too); go.test.ts + prelaunchGate.test.ts 63/63. Next: probes for 1.3, then 1.4.
- 1.3 probes (restored with git checkout; go.test.ts + prelaunchGate.test.ts back to 63/63):
  - remove /api/go/give from gate list -> FAIL prelaunchGate "10c ... GET and HEAD /api/go/give pass with no pass" (refused: true)
  - gate `startsWith("/api/go/give")` -> FAIL "10c ... anything next to it is still refused" (url /api/go/give/ got 302, wanted 401; the loop stops at the first miss, so /givex is not reached in that run)
  - `/go/give` counts (count:true) -> FAIL go.test.ts "GET /api/go/give > forwards ... writes nothing to donation_link_taps" (length 1), plus two more
- 1.4 done: /go/give in openapi, two Help-tab descriptions reworded, codegen run (api-zod, api-client-react) + typecheck:libs ok. NOTE: the welfare queue is not in openapi.yaml at all (no /reports, no queue schema), so there is no suggestedCat schema to add; skipped, flagged in report. Next: 1.5 team queue.
- 1.5 done: QueueReport/QueueDraft.suggestedCat (aliased joins on cats + photos), catRow four states, Yes form gated on change_report_state (renderQueuePage gets canTie), draftCard line, CSS; tests in team.tie.test.ts (state tests, capability, escaping, draft, Yes post) and team.queue.test.ts (JSON); 27 files / 581 tests pass in teamPages, dashboard, queue/tie/home routes. Next: probes for 1.5, then 1.6, typecheck.
- 1.5 probes (all restored by git checkout; team.tie.test.ts back to 31/31):
  - Yes form rendered unconditionally -> FAIL "a viewer without change_report_state sees the line and thumbnails but no Yes form" (expected ... not to contain "Yes, it's")
  - cat name unescaped in the "Sent from" line / the Yes button / the thumbnail caption / the thumbnail alt / the draft card (five separate probes) -> each FAIL "escapes a cat named <script> in the line, the thumbnail and the button, and on the draft card" at `not.toContain("<script>alert(1)")`
- 1.6 done: campaign.ts:2 and docs/SPEC.md 5.8 heading + limitation 8 reworded (go.ts comment was fixed in 1.3, openapi in 1.4). Next: typecheck, final test run.
