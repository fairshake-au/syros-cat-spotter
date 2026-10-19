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
