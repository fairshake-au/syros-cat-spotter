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

## Step 1 review (session, Opus, 21 Oct)
- Re-ran myself: api-server 28 files / 641 tests passed; api-server tsc clean.
- lib/db full suite: the 29 failures were the known stale hoisted @esbuild/darwin-arm64 0.27.3 (tsx "Host version" clash). Replaced it with 0.28.1 in node_modules; then 3 timeouts remained, and those 5 files pass 80/80 run serially with longer timeouts. No real failure.
- Review fixes (commit after de0a63bc): catId no longer coerced (`true` would have become cat 1); curly apostrophe in the FR link-off body. Probe: re-adding z.coerce fails "an unknown or garbage catId gives null and a 201" (true: expected 1 to be null); restored.
- Migration is 0035_report_suggested_cat on this base. When SYC-396's 0035 merges first, delete ours plus meta and regenerate as 0036 (README rule).
- OpenAPI has no welfare-queue schema, so suggestedCat lives only in the QueueReport/QueueDraft types. Not added as new work.
- Next: step 2 (Help & info page).
- Migration number (agreed with the SYC-396 sessions, 21 Oct): 0035 is 3.3a (#260) and 0036 is 3.1b. Ours is 0037 or later. Before leaving draft, delete the local 0035_report_suggested_cat plus its meta entries, check `git ls-tree origin/main lib/db/migrations` and the open PRs, then regenerate.

## Step 2 (Sonnet)
- 2.1 done (d1410dfb): tab icons on all three variants; tabHelp EN "Help & info", FR "Aide". i18n.test.ts 10/10. Next: 2.2 Fold.
- 2.2 done: Fold.tsx exported with tone (default urgent); UrgentAdvice imports it; Fold.test.tsx + ReportAdvice.test.tsx 45/45 (ReportAdvice unmodified). Next: 2.4 strings first (2.3 needs the keys), then 2.3.
- 2.4 done (done before 2.3 because the page needs the keys): all spec §5 keys EN/EL/FR incl. reportAboutCat/reportDifferentCat; feedNudgeInsteadNoLink last sentence dropped x3 (FR had non-breaking spaces in « Aider »); EN howStepDontFeedBody/howStepHelpBody sterilise; campaignNotOpenYet/campaignOffline/campaignError deleted (only help.tsx used them; it is rewritten in 2.3). i18n.test.ts 10/10. Next: 2.3 page.
- 2.3 done: help.tsx rewritten (urgent card, vets, 2 plain folds, contact, privacy, giving last); lib/helpGiving.ts, lib/contactMail.ts, components/help/CampaignCard.tsx (uses lib/notify, no local notifyError); tests HelpInfoScreen (20), helpGiving, contactMail all green; typecheck clean. campaignEyebrow key is now unused (left in place). Next: probes (a)(b)(c), then 2.5.
- 2.5 done: FeedNudge/WaitingCard test names and no-link assertions (no "tab" in the line), FeedNudge.tsx comment, notifyUsage allowlist drops help.tsx (new page uses lib/notify; no local notifyError), notify.ts comment. 13/13 on the three files. Next: probes a/b/c.
- Step 2 probes (committed tree 7e6d4532 first; each restored with git checkout):
  - (a) deviceId line added to contactMailto body -> FAIL contactMail.test "carries nothing else: no device id, no location, no spotter name" (expected 'App 1.0.0 · iOSDevice: deviceId=abc123' to be 'App 1.0.0 · iOS'); also 3 more incl. HelpInfoScreen "Email us opens the mailto ... and no device id"
  - (b) "Be the first to chip in!" rendered in the state B card -> FAIL HelpInfoScreen '"Be the first to chip in!" never shows in state B or C' (expected <div> to be null)
  - (c) givingState returns 'campaign' while pending -> FAIL helpGiving.test "loading is never A: B with a saved host, C without (no spinner state)" + 6 HelpInfoScreen tests
- Full run found 2 failures in starterFacts.test.ts that the plan missed: it pins feedNudgeInsteadNoLink to docs/specs/feeding-nudge.md (updated that row, 3 languages), and helpGiveBody EL/FR need a non-breaking space before € (project rule), fixed. Full app suite 151 files / 1987 tests pass; typecheck clean.
