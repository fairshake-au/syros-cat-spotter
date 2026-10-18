# Adversarial review: SYC-462 photo removal by hand

**Reviewer:** Sonnet subagent, 18 October 2026, working in its own worktree.
**Spec commit reviewed:** `01471d40` on branch `claude/syc-462-photo-removal`, read on a detached checkout. Nothing was written to the repo.
**Spec base:** `origin/main` `bdffc3c3`.

*Committed verbatim by the author's session. How each finding was handled is in §"Disposition" at the end, which the author added.*

## Verdict

The core design holds up against the code:
- the picture in `photos.data` is wiped in place;
- the row stays;
- the removal is recorded as one more `hide` event.

The §3 map is mostly accurate. Outside `photos.data`, the only tables that store picture bytes are `photo_variants.bytes`, `map_tile_cache.bytes` and `welfare_report_photos.bytes`. No other INSERT copies bytes.

It should not be approved as written. Three ordinary-path problems are real, not corner cases:
- **(a)** A removed photo can still be sent to the matcher. The fallback when the same spot is uploaded again re-introduces it, and so does resolving a spot as a new cat.
- **(b)** A photo already hidden from the dashboard can't be made eligible for removal without showing it to the public again.
- **(c)** Two claims in the reply template ("deleted our copies", "7 days") are contradicted by the project's own runbooks.

Several launch-critical test claims also fail:
- T2's "skip any step, the test goes red" can't be met for the `record` step.
- A restore from a Neon snapshot silently brings removed photos back, and nothing re-applies the removals.
- The rules for `photo_ref` are too weak for a public repo.

Fix findings 1 to 6 before approval. The rest can go into the plan.

## Findings

### 1. Matching can still send a removed photo, through two paths the spec misses — Major

**Claim (§6 change 2, §4.2, C2):** a repeat upload "skips a removed photo", and "if none are left the existing 'photo has gone' branch handles it". The §4.2 repoint is the only thing keeping P away from the matcher.

**Evidence:**
- **The repeat-upload fallback.** In `artifacts/api-server/src/routes/sightings.ts:556-583`, filtering out every `sighting_photos` row makes `photos.length === 0`. That triggers the fallback, which re-reads `sightings.photo_id` (`existing.photoId`, lines 574-579). That is the same removed row. The fallback sets `photos = [{ photoBase64: only.data, mime: only.mime }]`. So the "photo has gone" branch is never reached, and an empty picture is sent. The spec's "filter, then the existing branch handles it" is wrong. The marker filter must also be applied at lines 575-579.
- **Resolving as a new cat.** At `sightings.ts:769-775`, resolving a waiting spot as a new cat inserts a cat with `primaryPhotoId: sighting.photoId`. Scenario: a tourist's waiting spot has a child in the frame. The team removes the photo. Later, a team member names the spot as a new cat. The new cat now has a removed photo as its main photo.
- **Main-photo candidates.** `sightings.ts:276-289` doesn't skip a wiped row. `lib/matching.ts:65-70` builds `data:${mime};base64,${data}`, which gives `data:application/x-removed;base64,` with an empty payload. That is almost certainly a 400 from the provider. The whole `matchCatPhoto` call then fails, so matching breaks for every spot near that cat (caught as `matcherFailed`). Whether OpenAI rejects it outright is unverified. Either way it's a bug.
- **SYC-246's own plan has this row.** `docs/superpowers/plans/syc-44-report-an-issue.md`, PR 7.2: "Matching (`computeMatchCandidates`) skips a removed main photo". Spec §6 and §9 leave it out, so §9's "nothing here contradicts it" is wrong.

**Fix:**
- Add a third small app change: `computeMatchCandidates` skips any candidate whose `mime` is the marker.
- Filter the marker on both the rows read and the legacy fallback of the repeat-upload path.
- When resolving as a new cat, use `0` if the cover photo is hidden or removed.
- Extend T11 to cover the fallback, and add T12b for a new cat whose cover photo was removed.
- In §3.1, list `sightings.ts` resolve (line ~773) as a way a pointer to P can be re-created after removal.

### 2. A photo already hidden without a privacy reason can't be made eligible without showing it again — Blocker

**Claim (§5.2, §5.4(3), T4):** `photo-hide` refuses a photo that is already hidden, and `photo-remove` needs either a hide reason starting `privacy` or a `photo_private` report.

**Evidence:**
- **Dashboard hides carry no reason.** In `artifacts/api-server/src/lib/teamPages/catPages.ts:~419-424` (`galleryItem`), the dashboard's Hide form posts only `cat` and a button, with no reason input. So every dashboard hide has `reason = null` (`photoVisibility.ts:236-243`, `teamPhotos.ts:34-39`). The "for privacy" tick is SYC-246 work (plan PR 7.2, "The privacy tick").
- **A second hide writes nothing.** `photoVisibility.ts:220-232`: `setPhotoVisibility` returns `already` and writes nothing when the newest event is already a hide. The spec's `photo-hide` copies this refusal.
- **Scenario.** After an email, Johnny hides the photo from the dashboard, as the existing button invites. It's now hidden with no reason. The only ways to remove it are `photo-restore` followed by `photo-hide`, which makes it public again for a while, or hoping a `photo_private` report exists.

**Fix:**
- Let `photo-hide` on an already-hidden photo add a second `hide` event with `privacy: <ref>`. Nothing forbids two hides in a row: neither `photo_visibility_events_action_ck` nor `_author_ck` does.
- State in §5.4(3) that the test is against the newest hide event, not any hide event, and state whether it is case-sensitive.
- Add a success case to T4: hidden from the dashboard with no reason, then `photo-hide` for privacy, then remove.

### 3. A restore from backup brings removed photos back, and nothing re-applies the removal — Major

**Claim (§3.4, runbook steps 8–10):** backups age out, so a removal is permanent.

**Evidence:**
- `docs/runbooks/neon-database.md:~170-172`: `restore_snapshot` onto `production` swaps the old data back in.
- The launch plan (`mvp-launch-31-oct.md:166`) takes a Neon snapshot before the 19 Oct publish.
- `carry-back-apply` and the rollback paths also copy whole databases.
- The `production (old)`, `pre-restore-*` and `replit-final-*` branches are "never deleted" until the aftercare step, and only with Samuel's OK (`syc-121-neon-switchover.md:669`).
- A restore brings back P's picture, and the hide log with it, as of the snapshot time.

**Fix:**
- Keep a removal ledger: a Linear ticket or label listing each photo's public id and removal date, with no personal data.
- Add a runbook rule: after any restore, snapshot swap, carry-back, or reset of `development` from `production`, re-run `photo-remove` for every ledger entry newer than the restore point.
- Add a line to the restore section of `neon-database.md`.

### 4. The reply template and §1 make claims the project's own docs contradict — Major

**Claim (§7 step 11, §1):** "we've deleted our copies of it" and "Our backups keep data for 7 days, after which it's gone from them too."

**Evidence:**
- **Old copies kept longer than 7 days:**
  - the old Replit databases are kept for at least 30 days after cutover (`syc-121-neon-switchover.md:22`);
  - `pre-restore-*`, `replit-final-*`, `production (old)` and named snapshots are kept until Samuel deletes them;
  - Samuel's own offline encrypted dump has no expiry.
- **Copies the commands can't clean:**
  - the `rehearsal` branch is excluded from all four commands (§5, following the `db-ops.sh:491-498` pattern);
  - the 7-day encrypted dump stored as a GitHub artifact (listed in §3.4 itself).
- **Copies outside the database:**
  - the "Photo hidden" alert email carries the photo as an attachment (C4) and stays in the team inbox until someone deletes it;
  - how long Resend keeps it is unchecked;
  - how long OpenAI and the Replit AI proxy keep anything is unchecked.
- **The "7 days" figure has no source:**
  - `neon-database.md:172` says the 7-day Neon window is set "when the project is created", and the live setting is unverified;
  - §3.4 says "which of these exist right now is unchecked", yet §1 and the template state "7 days" as fact. The project rule is to name a source or say "unchecked";
  - launch plan line 193 leaves "how long backups keep deleted data" open as a privacy-policy item.

**Fix:**
- Make the template depend on the list checked in runbook step 10.
- Say "deleted from the live app and our working database".
- Say "our backups clear within N days" only with N taken from the longest-lived copy found. Drop "7 days" until the privacy policy has a figure.
- Add a gate: the template can't be sent until step 9 (inbox email deleted) and step 10 (the list) are done.
- Reword point 5 of §1.

### 5. T2's "skip any step → NOT GONE" can't be met for the `record` step — Major

**Claim (§8.1 T2, launch plan line 264):** a test runs T1 with each named step skipped and expects the search to report `NOT GONE`, naming that place.

**Evidence:** the `record` step writes the extra `hide` event. But §5.4(2) already requires the photo to be hidden when it is removed. So search check #4 ("newest event is a hide") passes whether or not `record` ran, and skipping that step can't turn the search red. The only difference is the `removed:` reason text, which the search never checks.

**Fix:**
- Either add search check #6 ("a `hide` event with reason `removed: <ref>` exists"), or drop `record` from T2 and cover it with its own assertion.
- State plainly that T2 covers wipe, versions and main photo only, and say which search check names each place.

### 6. `photo_ref` and the public logs: refusing `@` isn't enough — Major

**Claim (§5):** `photo_ref` is refused if it contains `@` or runs past 40 characters, "so an email address can't slip into the public log".

**Evidence:**
- On the public repo, workflow inputs show on the public run page (`.github/workflows/db-ops.yml`). The repo has been public since 18 Oct (memory).
- A name, a phone number, a street, or "Maria Kounadis door" all fit in 40 characters without an `@`.
- The command's output is public too. `photo-list` prints reports' reasons next to photo ids. The dry run prints "main photo of cat 182" with the hide reason and date, so the log links a cat to a privacy complaint on a date.

**Fix:**
- Replace the blocklist with an allowlist pattern, for example `^(SYC-[0-9]{1,5}|hello [0-9]{4}-[0-9]{2}-[0-9]{2} #[0-9]{1,3})$`.
- Test it against names, digits and mixed text.
- Decide whether `photo-list` should print report reasons at all, since its output is public.
- Make the printed ids consistent: §5.1 says "its public id", but the §5.4 example shows `3f2c…e91a`. Print full ids only where they're needed as input.
- Record `GITHUB_ACTOR` on the ticket or in the reason. The event's author is the person typed into `photo_by`, who didn't press anything, so the log doesn't show who ran it.

### 7. Eligibility and the role check are looser than the app's own definition — Minor

**Claim (§5.2, §5.4(4)):** a "current team member" means `staff` or `management`, "not marked as left", checked directly in `lib/db`.

**Evidence:**
- `lib/db/src/people.ts` (~1020-1040, the `managerRecipient`/`findAllowedPerson` pattern) requires `acceptedAt IS NOT NULL`, `leftAt IS NULL`, and a `person_scopes` row that is in force (`scopeInForce()`, which checks expiry).
- The spec leaves out `accepted_at` and the expiry check, so an invitee who never joined, or a person whose scope has expired, would pass.
- The spec calls `remove_photo` a power "SYC-246 adds". It already exists: `artifacts/api-server/src/lib/capabilities.ts:92` (`remove_photo: island, TEAM`), documented at `docs/specs/roles-and-invites.md:301`.
- The roles in the check are right: TEAM = `ISLAND_ROLES`, line 41.
- The `photo_private` route (§5.4(3)) doesn't check the report's state, and an anonymous reporter can file `photo_private` against any photo. Removal still needs a person to approve and a hide, so this is acceptable, but say so: the approver's judgement is the real gate.

**Fix:**
- Reuse the people store's "on the list now" query in the CLI (joined, not left, role in force) rather than writing a separate role check.
- Correct the `remove_photo` sentence.
- Pin both with T4.

### 8. §6 change 1 needs a route change the spec doesn't list — Minor

**Claim (§6):** `setPhotoVisibility` returns a new `removed` result, and the dashboard "shows its existing 'couldn't do that' message".

**Evidence:**
- `artifacts/api-server/src/routes/teamPhotos.ts:68-111` handles `not_authorised | not_found | already | changed` only, with no default.
- A new `removed` result therefore falls through, and the request gets no response (it hangs) unless a branch is added.
- There is no general "couldn't do that" page.
- §12's file list doesn't include `teamPhotos.ts`.

**Fix:**
- Add a `removed` branch (JSON 409 and a form page).
- List `teamPhotos.ts` in §12.
- T10 should call the route, not just the library function.

### 9. New readers of `photos.data` added in launch week aren't guarded — Major (partly unverified)

**Claim (§8 T3):** the catalogue test catches new links to photos.

**Evidence:**
- T3 compares only columns and foreign keys.
- A new reader of `photosTable.data` would silently send or serve a wiped picture. Find from a photo (dashboard 2.5, planned for Wed 21; launch plan lines 85 and 168) is such a reader. I couldn't check its code, because it isn't on main, so this is unverified.
- The current readers of `photos.data`, which I checked:
  - `routes/photos.ts`;
  - `routes/teamReports.ts:172`;
  - `routes/sightings.ts:276-289` and `556-583`;
  - `lib/photoVariants.ts:42`;
  - `lib/mail/outbox.ts:590`;
  - `lib/coatReading/sweep.ts:211`.
- SYC-246's plan has exactly this as T7-8: "a source test fails if `photosTable.data` or `photos.data` is read in a file outside the reviewed list". The spec leaves it out.

**Fix:**
- Add the source test over readers of `photosTable.data` (and `mime`), using the list above.
- Note in the PR that any new reader must be added to the reviewed list.

### 10. Gaps in the search (§5.5) — Minor

- **The same picture in a second row.** `routes/sightings.ts:~533-541` admits that a race can create two rows for one device and capture moment. The same picture can then sit in a second `photos` row with its own public id. The fingerprint scan would find it and the command would end `NOT GONE`, but the runbook only says "stop and raise it". Say what to do: list the duplicate photo ids in the output and treat each as its own request, with its own approval and hide.
- **Pointers aren't scanned.** The scan looks for bytes. It doesn't look for the photo's `public_id` or integer id in text or `jsonb` columns, and T3 only matches names like `photo_id` and `*_photo_id`. Add a second fingerprint: scan every text, `jsonb` and array column for the `public_id` string, excluding `photos.public_id` itself. T3 should also list the `jsonb` columns that can hold ids.
- **Alignment.** The 64-character base64 slice assumes the picture was copied whole, as a string. That holds today, because stored base64 is a single line (`spotPhotos.ts:~92`, `buffer.toString("base64")`). A copy embedded at an offset that isn't a multiple of 3 (a MIME attachment, wrapped lines) would be missed. State the assumption.
- **Versions.** Small and medium versions are re-encoded JPEGs, so the byte scan can't find them. They're covered by the row check, which is fine.
- **When and how the scan runs.** State that it runs after commit, read-only, and not while holding the photo lock across every column of every table. At production size, `column::text like '%…%'` reads every `photos.data` in full. That's fine at launch but grows without limit, so add a statement timeout and print how long it took.
- **Column types.** `me.delete.test.ts:324-346` (confirmed: `columnsHolding` is at 324) covers only `text`, `character varying`, `jsonb`, `json` and arrays. Add `bytea`, as the spec says, and confirm `public` has no other custom type.

### 11. The race note in §4.3 is incomplete — Minor

**Evidence:** `variantFor` reads `photos.data` without a lock (`lib/photoVariants.ts:41-53`), then inserts into `photo_variants`. That insert takes a key-share lock on the `photos` row. So it waits behind the removal's `for update` and lands right after the commit. The re-check after commit can run just before that insert lands.

**Fix:** either make the re-check retry once after a short delay, or make `variantFor` skip the insert for a row carrying the marker.

### 12. The §4.2 stand-in rule is a second copy, and its match is assumed — Minor

**Claim:** the repoint uses "the same stand-in rule as `displayPhotoRows`".

**Evidence:**
- It matches today (`photoVisibility.ts:119-162`): the cat's resolved sightings, cover photo only, newest first by `created_at` then `id`, the first one not hidden.
- But `displayPhotoRows` is private to the api-server, and the CLI lives in `lib/db`. A second copy of the rule will drift.
- T9's single case isn't enough to pin it.
- `0` is safe as the fallback:
  - `displayPhotoRows` filters `> 0` (line 124);
  - `sightings.ts:276` selects nothing for 0;
  - `coatReading/due.ts:161` and `guardianCatView.ts:131` both guard it.

**Fix:**
- Pin the rule with a parity test against `catDisplayPhotos`, covering several candidates, one hidden candidate and a tie.
- State in the spec that `0` is handled.

### 13. The repoint causes an extra coat reading — Nit

**Evidence:**
- After P is repointed to the stand-in S, `coatReading/due.ts:161-183` sees `mainPublic` become true.
- If the newest reading's `photoId` is different, it labels the cat `main_restored` and queues a model read.
- That sends S, a public photo, to OpenAI. Harmless, but it's an unannounced change in behaviour, and the reason label is wrong.

**Fix:** mention it in the spec or accept it.

### 14. Claims that don't hold or are unverified — Minor

- **"Photo hidden while Syros Cats take a look."** (§4.5, §3) is cited at `api/routes/cats.ts:239`.
  - That line is a comment, and the string isn't in the app code on main. SYC-44 PR 6.1 ("the hidden-photo tile") hasn't merged.
  - Today the public app shows no photo, not that tile.
  - The wording ("take a look") would also be wrong for a removed photo.
  - Fix the claim and the T9 expectation: the public payload has no address, rather than showing that string.
- **`sharp` failing on empty input** (§4.3) is unverified. I couldn't run it, because there's no `node_modules` here. The code does catch errors and return `null` (`photoVariants.ts:46-52`). Add a unit test.
- **The mutation probes for T10 and T11** are only as good as the filters in findings 1 and 8.
- **Launch plan line 58** says the command removes "caches". The spec is honest that it can't (§3.3 K5/K6), so correct the plan's wording.

### 15. Public git history and PR screenshots can hold a copy — Minor (unchecked)

**Evidence:**
- `git ls-files` shows 384 images in the public repo, including `docs/screenshots/*/*` (cat pages, pickers, dashboards) and `attached_assets/image_*.png`.
- I opened one, `attached_assets/image_1785084702664.png`: an error screen, not a photo.
- I didn't check the dashboard screenshots. Whether any of them show a real spotter's photo is unchecked.
- A copy in the public repo or in a PR comment can't be removed without rewriting history.

**Fix:**
- Add a runbook line: search the repo, PR comments and Linear attachments for the photo id and for any screenshot of that cat.
- Add a rule that screenshots of the app use seeded data.

### 16. Fit with the workflow — Minor

- **Input limit.**
  - `.github/workflows/db-ops.yml` has exactly 10 `workflow_dispatch` inputs today: `target`, `command`, `people_role`, `people_change`, `people_colony`, `setting_key`, `setting_value`, `base_url`, `confirm`, `fail_after`.
  - The spec adds 5, making 15.
  - I believe GitHub raised the limit to 25 but couldn't verify it. Confirm with a real dispatch or actionlint before relying on it.
- **One run at a time.** `concurrency: db-ops, cancel-in-progress: false` keeps only one waiting run, and a third queued run replaces the waiting one. A dry run, then the real run, then a check, one at a time, is fine. Say so in the runbook.
- **Target and confirm rules match.**
  - Only `development` or `production` (not `rehearsal`), plus the `DATABASE_TARGET` check, matches `db-ops.sh:491-498`.
  - A separate confirm word per command (`HIDE`, `RESTORE`, `REMOVE`) is consistent with `APPLY` and `FORCE`.
- **Secret check.** `grep_no_urls` (`db-ops.sh`) matches only `postgres://`. T7 is right to test coordinates and notes separately.
- **Runbook step 8 on `development`.** It assumes the development copy already has the hide event. If `development` was branched before the hide, it won't, and `photo-remove` refuses. Say: run steps 5 and 6 on `development`, or reset it from `production` after the removal.
- **Undoing a hide blocks later report hides.** A `photo-restore` (the undo in step 5) writes a `restore` event. After that, `lib/issues/hide.ts:187-192` skips every later automatic hide of that photo (`restored_before`). Warn the reader in the runbook.

### 17. Compatibility with SYC-246 — Minor

- **The privacy reason.** SYC-246's plan stores the privacy tick as `reason = 'privacy'` exactly. The spec writes `privacy: <ref>` and tests "starts with". Align them, so the future button accepts photos hidden by hand.
- **The original image type is lost.** §9's conversion says "put the image type back", but the marker overwrote the original `mime`. Default to `image/jpeg`, or say the type is unknown.
- **Stand-in versus placeholder.** `docs/specs/hosting-and-photo-storage.md` §6.5 says a cat whose main photo is removed "shows the placeholder, exactly as the `primaryPhotoId: 0` sentinel". §4.2 shows the stand-in instead. What people see is the same as for a hidden photo (`catDisplayPhotos` already uses the stand-in), so this is fine, but note it.

### 18. Plain English for Samuel (§1, §2, §10) — Minor

Jargon a non-technical approver has to decode:
- **§1 and §2:** "`db-ops` workflow", "dry run", "migration" (explained, good), "ask mode", "Linear comment", `photo_private`, "SYC-44".
- **§2 table:** "`photo-list` command".
- **§10:** "wipe in place … marker", "append-only", "stand-in", "lock", "FK", "the 19 Oct publish", "belt and braces".

Other points:
- D1 to D4 give the benefits and risks in building terms. For each, add one plain line on who is affected: the person who wrote in, the spotter, or the team.
- §3 is an engineering reference. That's fine, but tell the approver it can be skipped.

## Claims verified correct

- **Only one column holds the picture.**
  - `photos.data` is `text NOT NULL` (`lib/db/src/schema/photos.ts:36`).
  - The other columns holding bytes are `photo_variants.bytes`, `map_tile_cache.bytes` and `welfare_report_photos.bytes`.
  - The only code that inserts a photos row is `lib/spotPhotos.ts:96`, plus the test kits.
  - No code copies data from one photo row to another.
- **Versions are deleted with their photo.** `photo_variants` has a cascading foreign key (`schema/photoVariants.ts:~33`, `0028_photo_variants.sql:10`).
- **Links and locks are as stated.**
  - `cats.primary_photo_id` has no foreign key (`schema/cats.ts:28`).
  - `sightings.photo_id` has no foreign key, and `sightings_append_only` guards it (`0013_deletion_unlinks_people.sql`).
  - `observations_append_only` exists (`0001_data_spine_tables.sql:125`).
  - `welfare_reports.photo_id` is a strict foreign key (`schema/welfare.ts:96`).
  - There's no trigger on `photos` or `cats`, so nothing blocks the wipe or the repoint.
- **The hide log's rules allow the extra event.**
  - The action check allows `hide`.
  - The author check requires `author = person_id::text` for a team member (`schema/photoVisibility.ts:~54-58`).
  - The append-only trigger allows inserts.
  - The lock order (photo `for update`, then insert) matches `photoVisibility.ts:227-229` and `lib/issues/hide.ts:171`.
  - There's no deadlock cycle, because removal takes no advisory lock.
- **A team hide sends no email.**
  - Only `lib/issues/hide.ts` (the report path, `enqueueIssueAlert`) queues one.
  - The daily brake counts only `author like 'report:%'` (`hide.ts:213-218`), so the `removed:` event doesn't affect it.
- **Public route.** A hidden photo answers 404 with `no-store` before its bytes are read (`routes/photos.ts:51-56`). A shown photo is served as `private, max-age=31536000, immutable` (`:64`).
- **Team routes.** `IMAGE_TYPES = {image/jpeg, image/png}` (`routes/teamReports.ts:87`), and `servablePhoto` answers 404 for anything else (`:151`). Both team routes go through `servablePhoto`, so the marker closes them with no code change.
- **Email.**
  - `processIssueAlert` reads `photos.data` when it sends, and sends with no attachment if it's empty (`lib/mail/outbox.ts:588-593`). A wiped photo can't be sent again, and the idempotency key gets a `nophoto` suffix.
  - Alert payloads hold no bytes (`:199, :219-224`).
- **Coat reader.**
  - `catsDueForReading` picks only a public photo id, via `catDisplayPhotoIds` (`coatReading/due.ts:~145-150`).
  - `sweep.ts:~203-213` checks again just before reading.
  - A hidden or removed photo is never sent.
- **Capabilities.** `hide_photo`, `restore_photo` and `remove_photo` are all `island`, with `TEAM = ISLAND_ROLES` (`capabilities.ts:90-92`).
- **Cited documents match the text:**
  - `DECISIONS.md:394` (Decision 3);
  - `docs/specs/roles-and-invites.md:301` (the `remove_photo` row);
  - `hosting-and-photo-storage.md` §6.5 allows "null the bytes and mark it removed" and requires that "removal is recorded";
  - `me.delete.test.ts:324` is the helper that scans every column;
  - `scripts/db-ops.sh:491-498` has the target restriction;
  - `neon-database.md:172` says 7 days (the live setting is unchecked).
- **Logs.** `app.ts:30-41` records request paths, which include the photo's public id.

---

## Disposition (added by the spec author, 18 October 2026)

Findings 1, 2, 8 and 14 were re-checked against the code before folding: `sightings.ts:769-775` (new cat takes `sighting.photoId`), `teamPages/catPages.ts:414-424` (Hide form has no reason), `teamPhotos.ts:68-111` (no default branch), and the "Photo hidden while…" string (not in app code on main). All four hold.

| # | Severity | Disposition | Where in the spec |
|---|---|---|---|
| 1 | Major | **Fixed.** Matching skips the marker; repeat upload filters both reads incl. the fallback; new cat from a removed cover gets `0`; P9 added | §3.1 P9, §6 changes 2–3, T11, T12b |
| 2 | Blocker | **Fixed.** `photo-hide` on an already-hidden photo adds a second `privacy` hide; never re-exposed; exact, case-sensitive rule | §5.2, §5.4(3), T4 success cases |
| 3 | Major | **Fixed.** Removal ledger; re-apply after any restore/swap/carry-back/dev reset; line added to `neon-database.md` | §3.4, §7 steps 11 and "after any restore" |
| 4 | Major | **Fixed.** Reply template conditional on step 10's list; no assumed "7 days"; sent only after steps 9–10 | §1 point 5, §7 step 12 |
| 5 | Major | **Fixed.** Search check 5 (the `removed:` record); T2 table maps each step to its check | §5.5, T2 |
| 6 | Major | **Fixed.** `photo_ref` allowlist; output never prints reasons; full ids; `GITHUB_ACTOR` on the ledger | §5 inputs, §5.1, §4.4, T4, T7 |
| 7 | Minor | **Fixed.** Reuse the people store's "on the list now" query (joined, not left, role in force); `remove_photo` sentence corrected; approver is the real gate | §2, §5, T4 |
| 8 | Minor | **Fixed.** `teamPhotos.ts` gets a `removed` branch (409 / page); T10 goes through the route | §6 change 1, §12, T10 |
| 9 | Major | **Fixed.** Source test over `photos.data`/`mime` readers | §3.1 readers list, T13 |
| 10 | Minor | **Fixed.** Duplicate-picture handling; public-id pointer scan; alignment assumption stated; post-commit, read-only, timeout, duration; `bytea` and "no other types" | §5.5 checks 6–7, §7 step 6 |
| 11 | Minor | **Fixed.** `variantFor` refuses the marker at read and before insert; re-check twice | §4.3, §6 change 4, T15 |
| 12 | Minor | **Fixed.** Parity test; `0` handling stated | §4.2, T14 |
| 13 | Nit | **Accepted and noted.** | §4.2 |
| 14 | Minor | **Fixed.** Tile claim corrected (payload `photoUrl: null`); `sharp` case covered by T15 (returns null, saves nothing); plan line 58 wording noted | §4.5, §11, T9, T15 |
| 15 | Minor | **Fixed (runbook).** Search repo/PRs/Linear for the id and cat screenshots; seeded-data rule | §3.2 C6, §7 step 10 |
| 16 | Minor | **Fixed.** Input count to be checked with actionlint + a real dispatch (limit unchecked); one run at a time; dev branch runs steps 5–6; restore warning | §5, §5.3, §7 step 8 |
| 17 | Minor | **Fixed.** Reason `'privacy'` exactly; `mime` back to `image/jpeg` in the backfill; stand-in vs placeholder noted | §5.2, §9, §4.2 |
| 18 | Minor | **Fixed.** Plain-English pass on §1, §2 and §10; "who's affected" line per option; §3 flagged skippable | §1, §2, §10 |
