# SYC-462 checkpoint

Branch `claude/syc-462-photo-removal`, worktree `.claude/worktrees/adoring-bohr-e8be1c`, from origin/main bdffc3c3. Draft PR #237.

## Done (18 Oct 2026)
- Research: ticket, SYC-246, SYC-66, project, launch plan, storage map (Explore/Sonnet), key claims spot-checked.
- Spec: `docs/superpowers/specs/syc-462-photo-removal-by-hand.md`.
- Adversarial review (Sonnet, own worktree, removed after): `...-review.md`, committed verbatim; all 18 findings folded (cc8383a1), disposition table at its end.
- Draft PR #237 opened. SYC-462 → In Progress with PR linked and a comment. Comments on SYC-246 (backfill) and SYC-44 (tile wording). SYC-303/SYC-276 already covered the side gaps (no new tickets).
- Artifact for reading: https://claude.ai/artifact/BkbLBsV4LgpoQcjs7P5Ku8

## Decisions (Samuel, 18 Oct 2026, via /decide; recorded on SYC-462)
- D1: **Bring November's change forward** (B): migration with nullable data + removed_at/by/reason; every bytes reader updated. Not the mime label.
- D2: Full rehearsal on development (after migrating development).
- D3: Not at launch; filed SYC-478.
- D4: settled by D1 (app changes required).

## Waiting on
- Spec revision 2 for D1=B DONE (d971a0d5). Review 2 (Sonnet) committed verbatim (ef3a6243) and all 14 findings folded in. Spec APPROVED by Samuel 19 Oct ("approved, write the plan"). Migration number to be agreed with live sessions (0031 is latest on main).

## Next, after approval
1. Write the plan (with model delegation), get it approved.
2. Build test-first in this PR (T1–T15), local scratch DB only. Dry run via db-ops.sh against local scratch; paste output in PR.
3. Runbook `docs/runbooks/photo-removal.md`, restore line in `neon-database.md`, launch plan line 58 wording.
4. Before merge: re-check live sessions; message them (db-ops.yml / sightings.ts overlap). No migration needed.
5. After merge (parent session): D2 development-branch run with heads-up.

## Plan (19 Oct)
- Written: `docs/superpowers/plans/syc-462-photo-removal.md` (12 tasks, inline Opus, mutation probes). Waiting on Samuel's plan approval.
- Migration number AGREED: 0034_photo_removal (PR 2.4 #245 holds 0033_named_areas; others none). photoRemoved field agreed in principle with SYC-44 6.1 (their choice pending: inert app tile now, or SYC-246).
- Branch rebased onto origin/main 4cad95e3 (force-pushed, own branch).

## Build (started 19 Oct, plan approved "approved, start building")
- Env: scratchpad env.sh (ESBUILD_BINARY_PATH 0.28.1, DATABASE_URL postgres://samuelporter@localhost:5432/postgres); rollup darwin copied; hoisted @esbuild/darwin-arm64 replaced 0.27.3→0.28.1. Baseline: lib/db photoVisibility 6/6; api photos.cache+team.photos 13/13.
- **Task 1 DONE**: migration `0034_photo_removal.sql` (journal idx 33 — the runner needs consecutive idx; `0033_named_areas` (#245) isn't on main; whoever merges second regenerates). photoRemoval.test.ts 10/10; migrate:check ok; carryBack.test droppedColumns updated (photos gains removed_* as Neon-only). Full lib/db parallel run had load timeouts (~5 s) in different files each run; the failing files re-run serially 71/71.
- Type ripple (ground-truth reader list): coatReading/sweep.ts:228, photoVariants.ts:48, routes/photos.ts:58, routes/sightings.ts:286,567,579, routes/teamReports.ts:177, plus tests sightings.extraPhotos.test.ts:345, sightings.upload.test.ts:79. Matches spec R1–R5, R7 (R6 already null-safe). No unlisted reader.
- Next: Task 2.
- **Task 2 DONE**: hiddenPhotoIds counts removed photos; public route 404 guard; team full/versions 410 (servablePhoto check + second-read guard). photoRemoval.app.test.ts 4/4; regression set 8 files 70/70. Probes: (1) drop removed union → T18 red; (2) drop union + public guard → public 404 test red; (3) drop servablePhoto removedAt → 410 test red. Not probed: the team route's second-read guard (only reachable in a race; the type checker forces it).
- **Task 3 DONE**: setPhotoVisibility returns `removed` for a restore of a removed photo; teamPhotos route 409 JSON / plain page; exhaustive `default: never`. T10 (3 tests) + photoVisibility.test + team.walk: 56/56. Probe: drop the refusal → both T10 restore tests red (500 from the trigger). 7 TS errors left = Tasks 4–5 readers.
- **Task 4 DONE**: variantFor returns null for a removed photo; save is a conditional insert (`where exists … data is not null`); test hook `__variantHooks.afterRead`. T15 3 tests + variants suites 35/35. Probe: unconditional save → "removal between read and save" red.
- **Task 5 DONE**: R4 (nearby main photos skip a removed one), R5 (repeat upload filters rows + fallback), P9 (new cat from a removed cover gets 0), R7 sweep guard; R6 email already null-safe, now pinned by T16 in issueMail.test.ts. New file routes/photoRemoval.matching.test.ts 4/4; regression (all sightings*, coatReading*, internalCoat, issues*, spotPhotos) 26 files 366/366. api-server typecheck: 0 errors. Probes: R4→T12 red; R5 rows→T11a red; R5 fallback→T11a+T11b red; P9→T12b red. Not probed: sweep guard (unreachable except a race: a removed photo is hidden, never due).
- **Task 6 DONE (except step 5b)**: photoPublicIds + likelyReview leave removed photos out (team cat page HTML/JSON and likely list); T13 source test (177 files) guards photosTable.data / whole-row readers. photoRemoval.app.test 12/12; regression 8 files 189/189; typecheck 0. Probes: photoPublicIds → cat-page test red; likelyReview → likely test red; `photosTable.data` in colourCheck.ts → T13 red.
  - **Step 5b (photoRemoved field + "Photo removed" tile) WAITING on SYC-44 PR 6.1 = #246 (open, unmerged).** Do it after #246 merges, rebased onto it.
  - Colour-check / guardian-page "shows the stand-in" assertions move to Task 7 (they need removePhoto's repoint).
- **Task 7 DONE**: lib/db/src/photoRemoval/{rules,eligibility,standIn,search,remove}.ts + __fixtures__/seed.ts. remove.test.ts 25/25 (T1 + face photo + shared-prefix permanent probe, T2 ×3 + T2b, T4 refusals/successes, dry run, T5, T8), catalogue.test.ts (T3) 2/2. Probes: privacy rule → 3 T4 cases red; left_at → T4 person red; fingerprint-from-start → shared-prefix test red.
  - Deviations from plan text (corrections, not redesign): (a) T2 "delete_and_record" fails checks picture+record, not bytes — the byte scan excludes the row itself, which check 1 covers; (b) enum columns (USER-DEFINED, typtype 'e', e.g. cat_updates.update_type) are treated as unable to hold a picture; any other unknown type still fails the scan; (c) "already" results also carry a read-only search (fp unavailable → bytes "checked during the removal run").
- **Task 8 DONE**: hide.ts (hidePhotoForPrivacy, restorePhoto) and list.ts (listCatPhotos). hide.test.ts 9/9; photoRemoval total 36/36. Probe: hide writes reason null → hide tests red (written test-and-code together, so the probe stands in for the red run).
- **Task 9 DONE**: photoRemoval/cli.ts (`photos list|hide|restore|remove`), package script `photos`, package export `@workspace/db/photoRemoval` (index.ts; for SYC-246 too), setting key `photo_removal_on` (shape.ts), db-ops.sh `run_photos` + case, db-ops.yml (4 commands, 5 inputs, setting option, confirm description). actionlint ok; 15 inputs. Tests: cli.test 9/9 (T7 output hygiene, target/rehearsal/confirm/ref refusals, production switch, exit 3 NOT GONE naming the duplicate row, already), dbOps.photos.test + settings 21/21, api parity T14 5/5, app e2e (removePhoto → public, team, guardian pages show the stand-in) — app/parity/source 195/195. Typecheck libs + api clean.
  - Exit codes (adjusted to the settings CLI's convention): 0 done/already/dry run; 1 refused/failed; 2 usage/target; 3 NOT GONE; 4 NOT VERIFIED.
  - Probe: standIn order `s.id asc` → T14 tie case red.
  - Finding while testing: seedCat's shared fake bytes make the search (correctly) report "the same picture is photo row N" → the e2e test gives its cat its own picture. The search's duplicate detection works.
- **Task 10 DONE**: carry-back writes and compares a removed photo as an empty picture (`projectedColumnExpr` in switchover/fingerprint.ts, used by projected fingerprints, carryBack rowKeys and writeRows; plain `t::text` fingerprints unchanged). T17 in carryBack.test.ts (an update and an insert of removed photos; second apply finds nothing). switchover suite 44/44 (serial). Probe: drop the coalesce → T17 red.
  - Deviation from plan text: the rule lives in fingerprint.ts (projected mode only), not only writeRows — carry-back's post-write verify uses the projected compare, so both sides must agree (the plan anticipated this "if the comparison hashes data").
- **Task 11 DONE**: docs/runbooks/photo-removal.md (go-live, 13 steps with exact gh commands, ledger template, both replies, after-restore rule, failures); neon-database.md (commands list, `photo_removal_on` setting row, after-restore line); launch plan line 58 "caches" wording corrected.
