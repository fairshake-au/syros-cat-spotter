# Adversarial review: photos-object-storage.md

**Reviewer:** an independent Sonnet subagent, read-only, given the spec and the code with no conclusions from the author (25 Oct 2026). It re-read the code but did not re-fetch prices, and did not check Linear ticket states (the author did; see the spec). Text below is the reviewer's report, with the author's resolution added in each **Resolution** line. Section numbers refer to the spec after the fixes.

Verdict: not ready for approval as first drafted (5 blockers, 8 major). All are folded in; none was disputed. The author re-verified blockers 1 and 2 and finding 9's settings point against the code before accepting them (`vetBatches.ts:339-346`, `welfare.ts:185`, `photoVariants.ts:31`, `appSettings.ts:96`).

## Blockers

**1. Deleting for good misses three deletion paths.**
`artifacts/api-server/src/lib/vetBatches.ts:339` hard-deletes `photos` rows for discarded vet-batch photos (team-only; the daily `vet-batches-cleanup.yml` triggers it) and `:342-346` sets `data: null, removedAt…` directly, bypassing `removePhoto`. `welfare_report_photos` rows go by FK cascade (`welfare.ts:184`), and the three-year report-photo retention and SYC-478 are further deletion paths. A discarded staged photo would lose its key with its row and the object would live forever.
*Fix proposed:* every deletion site writes a `photo_object_deletions` row in the same transaction before removing the row; a source test bans `delete(photosTable)`, `delete(welfareReportPhotosTable)` and `set({data: null})` outside the deletion module; orphan reconciliation runs on a schedule with a grace period.
**Resolution:** accepted. Spec §4.4 now lists every deletion path and routes all through one module, with the source test and the scheduled reconciliation.

**2. The step 1 migration collides with an existing column.**
Step 1 added `bytes` to `welfare_report_photos` ("the same three"; the list names four). `welfare_report_photos.bytes` already exists, holds the picture, and is NOT NULL (`welfare.ts:185`). `photo_variants.bytes` is NOT NULL too (`photoVariants.ts:31`), so step 7 could not null them and new report photos could not be inserted in object mode.
*Fix proposed:* name the new column `size_bytes`; drop NOT NULL on both byte columns with a check that a row has bytes OR a key; fix the count.
**Resolution:** accepted (§5 step 1).

**3. Backfill and dual-write race with `removePhoto`.**
Backfill reads a live photo, PUTs the object, then updates `storage_key`. `removePhoto` takes `for update`, sees `storage_key` null, records no deletion; backfill then leaves an object whose row is removed.
*Fix proposed:* hold `FOR KEY SHARE` as `variantFor` (`photoVariants.ts:68`) and `saveFingerprint` (`fingerprint/index.ts:48`) do, re-check `removed_at` after the PUT, delete the object if removed; add a race test like the existing T15 hooks.
**Resolution:** accepted (§4.4, §5 steps 2–3, test 10).

**4. "`data IS NULL` means removed" is hard-coded in about eight places.**
`routes/photos.ts:~55`, `routes/sightings.ts:291` and `:416` (`isNotNull(photosTable.data)` would silently drop live photos from the matcher), `photoVariants.ts:50` and `:68`, `smokeCheck.ts:101`, `vetBatchSearch.ts:~57`, `mail/outbox.ts:~613`, `lib/db/src/photoRemoval/search.ts:247`. A rolled-back build would treat every bucket-only photo as removed.
*Fix proposed:* step 1 moves every "removed" decision to `removed_at` with a source test; state that after step 6 the app cannot be rolled back past the step 1 build.
**Resolution:** accepted (§5 step 1, step 6).

**5. The removal tool cannot work after the move.**
`lib/db/src/photoRemoval/remove.ts` reads `data`, calls `fingerprint(data)` (throws on null, `rules.ts:~28`) and `planFor` uses `length(data)`; `scanBytes` only scans DB columns. The tool runs in GitHub Actions (`db-ops.yml`) with database credentials only and cannot reach the bucket. Its `GONE` verdict and the runbook's curl check are issued from the database row alone and cannot see a surviving object.
*Fix proposed:* specify the tool's new inputs (key from the row, bucket credentials in the `production` GitHub environment, token scope); add an object "not found" probe as an exit condition for `GONE`, or a verdict `GONE-PENDING-OBJECT`; update runbook steps 6, 7, 10 and 12.
**Resolution:** accepted (§4.4).

## Major

**6. The safety copy has design flaws.** Same Cloudflare account, so it does not protect against a suspended account or a leaked token; "a token that cannot delete" conflicts with propagating deletions (R2 tokens, as the reviewer understands, have no put-without-delete scope: unchecked); a copier that listed before a removal can copy the removed object after propagation ran, leaving a permanent orphan; "confirmed" only probes the main key. *Fix proposed:* put the copy in a different account or provider; propagate in the same sweeper; confirm both locations; reconcile the copy against `photo_object_deletions`.
**Resolution:** accepted (§5.8, D2).

**7. The schedule contradicts the approved trigger** (`hosting-and-photo-storage.md` §4.2; DECISIONS.md Part 2e): decision date 15 Nov 2026 with inputs and a default of "stay in Postgres through 2027"; and "stay in Postgres" is not offered as an option. *Fix proposed:* add D0; reconcile D6; say which inputs are met.
**Resolution:** accepted. Note SYC-47 was closed on 24 Oct with "moving photos stays with SYC-46, after launch", which supersedes the 15 Nov hosting review but not the volume-based default. D0 added; D6 reworded.

**8. `VACUUM FULL` takes ACCESS EXCLUSIVE on `photos`**, which blocks everything that reads or joins it (`hiddenPhotoIds`, cat lists, `POST /api/sightings`, the fingerprint lock, the mail drain); a queued exclusive-lock request also blocks later queries behind it. *Fix proposed:* build a slim table and swap, or a rehearsed `lock_timeout` retry loop with maintenance mode; don't call it photo-route-only.
**Resolution:** accepted; slim-table swap is now the plan, `VACUUM FULL` only if rehearsal shows it is seconds (§5 step 7).

**9. Step 0 cannot do what it says, and some rollbacks are not real.** `neon-database.md:178`: snapshots and restores work only on a root branch, so a child branch of production cannot run the restore. `PHOTO_READ=db` "needs no deploy" only if it is an `app_settings` row (60 s cache, `SETTINGS_CACHE_MS`); an environment variable needs a republish. `PHOTO_STORAGE=shadow` is a read mode listed as a write mode. Restoring a pre-step-7 snapshot resurrects the `data` of photos removed since and un-hides them (runbook "After any restore"). *Fix proposed:* use the `rehearsal` branch or point-in-time restore to a new branch; state the control mechanism per switch; add the runbook re-removal step to every restore rollback.
**Resolution:** accepted (§5 preface, step 0, step 7).

**10. Missed writers and data stores.** `lib/vetBatches.ts:248` also inserts `photos` rows with `data` (inside a transaction, as does `spotPhotos.ts:96`; a PUT inside a transaction holds a connection and a rolled-back sighting leaves an orphan). `photoData.source.test.ts` guards only `photosTable.data` and whole-row selects, not `welfare_report_photos.bytes` (`teamReports.ts:139`, `outbox.ts:693`, `reports.ts:519`), `photo_variants.bytes` or raw SQL, so "nine files, enforced by a test" is overstated. The smoke check and `fingerprint-accuracy` run in GitHub with only `DATABASE_URL`. SYC-125's compare and carry-back read `photos.data` (`switchover/fingerprint.ts:101`, `carryBack.ts:804`), so bucket-only photos would carry back as empty pictures into the old database, which is kept 30 days. Approved but unbuilt `field_check_photos` (DECISIONS.md:373) is another photo-bytes table.
**Resolution:** accepted (§2.1, §4.7, §5 steps 1 and 6, §9).

**11. "The store's egress price is irrelevant" does not follow.** The matcher reads up to ten candidate photos per spot, plus the coat sweep, fingerprint filler, variant generation and shadow mode; at 60,000 spots that could be hundreds of GB. R2 and Neon (500 GB included) make that free; S3 does not; Replit App Storage bills downloads. *Fix:* correct the model or label it unestimated.
**Resolution:** accepted (§3.2). It strengthens R2.

**12. Ordering and fallback gaps in steps 2, 6, 7.** Step 7's nulling lacks `WHERE storage_key IS NOT NULL AND verified`; after step 8 "bucket down, write `data`" no longer exists; dropping `data` drops the multi-column `photos_removed_ck`; the down-migration cannot satisfy the original check.
**Resolution:** accepted (§5 steps 7–8).

**13. The variants race is a privacy gap.** `variantFor` uses `FOR KEY SHARE` to stop a variant being saved after removal; object variants have no such lock, and `photo_object_deletions` stores one key while `storage_key` is nulled on removal.
**Resolution:** accepted (§4.4, §4.7).

## Minor

14. Report and public photos in one bucket with one credential, and §4.2 contradicts §4.3. **Resolution:** separate bucket and token for report photos.
15. Relaxing a CHECK scans the table under ACCESS EXCLUSIVE; use NOT VALID then VALIDATE. **Resolution:** accepted.
16. The photo route buffers and gets an Express weak ETag (`photos.etag.test.ts`); streaming loses it unless the stored SHA-256 is used. **Resolution:** accepted; test added.
17. Sweeper details missing: where it runs (no scheduler in the app; GitHub cron is the pattern), who is alerted, credentials, and the "never log a photo id" rule. **Resolution:** accepted.
18. A dev reset or rehearsal branch copies `storage_key` values and pending deletion rows; those environments must never hold production bucket credentials. **Resolution:** accepted.
19. D5 quoted "You asked for…" with no source. **Resolution:** it came from the task brief for this spec; reworded.
20. §2.2 placeholder and coordinator id left in the text; `CHECKPOINT.md` committed. **Resolution:** the placeholder is filled or labelled before approval; `CHECKPOINT.md` is removed before the PR opens.
21. Cost table omits the +18% for smaller copies; D2's "+$0.40" is wrong because the 10 GB free tier is already used. **Resolution:** corrected.
22. The +300 ms budget is copied from the earlier spec without re-measuring. **Resolution:** labelled as a target to be measured in the rehearsal.

## Checked and correct (reviewer)

The nine reader files match `ALLOWED` in `photoData.source.test.ts`; the route order (row, hidden check, bytes) is a valid design; `hiddenPhotoIds` counts removed and team-only photos as hidden; the public route gives an identical 404 with `no-store` and `private, max-age=31536000, immutable`; vet photos share `photos` and are protected by `teamOnlyPhotoIds`; `photos_removed_ck` currently demands `data is not null` for live rows; the three variant sizes are 160/360/640; the EXIF strip is in `validatePhotoBase64`, used by all four writers; `severPerson.ts` matches the spec's description; the migrate runner's 5-second `lock_timeout` and one-step rollback; the 7-day Neon window; arithmetic for the cost lines and ratios (15×, 23×, 31×; "65×" is $1.50 ÷ $0.023); 31 Oct is a Saturday and 9 Nov a Monday.
