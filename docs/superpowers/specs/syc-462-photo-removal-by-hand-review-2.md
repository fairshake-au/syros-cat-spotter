# Adversarial review (revision 2): SYC-462 photo removal by hand

**Reviewer:** Sonnet subagent, 18 October 2026, run in its own worktree.
**Spec commit reviewed:** `d971a0d5`, checked out as `origin/claude/syc-462-photo-removal`, with main at `c1958d7a`.

*The author's session committed this review word for word. How each finding was handled is in the "Disposition" section at the end, which the author added.*

## Verdict

**Approve with changes. There are no true Blockers.**

The redesign is sound:
- A nullable `data`, plus the `removed_*` columns and a check constraint, matches SYC-246's plan PR 7.2 and hosting §6.5.
- The migration is safe for the app that is running now.
- §3.1's list of code that reads `photos.data` is almost complete.

Three things need fixing before the plan:
1. **T9 can't pass as written.** It says the team cat page shows a removed photo as removed, with no broken image. That needs changes outside R1–R8: in `teamCatView.ts`, and probably `teamPages/`.
2. **Carry-back fails on the first removed photo.** Copying back to the old Replit database breaks as soon as one photo has been removed.
3. **Re-applying removals after a restore has regressed.** The step re-runs only the remove. After a restore, the photo may no longer be hidden, and remove refuses a photo that isn't hidden.

## Findings

### 1. Major: T9 and the end of §3.1 — the team gallery will show a broken image for a removed photo, and R1–R8 can't fix it

**The contradiction.** §3.1 says the team address for a removed photo "answers 410". T9 says "no broken image". Both can't be true.

**What the code does today:**
- **The team cat page.**
  - `teamCatView.ts:586-596` (`photoPublicIds`) builds `teamPhotoUrl(publicId)` for every photo row, hidden or not.
  - So does `urlFor` (`:801-804`), which is used at `:876`, `:959`, `:962` and `:1062`.
  - The gallery items (`:885-899`) do the same.
- **What the page draws.**
  - `teamPages/catPages.ts:825-826` renders each address as `<img src=photoUrl>`, so a 410 shows as a broken image.
  - `galleryItem` (`catPages.ts:~410-425`) still shows a **Restore** button for a removed photo, and that button leads to the new 409 page.
- **The likely-coat review.**
  - `likelyReview.ts:148-157` builds team addresses for coat-evidence photos from `observations.photo_id`, which stays pointing at the removed photo.
  - `likelyPage.ts:43` renders them as `<img>`, so they break the same way.

**Fix:**
- Make `photoPublicIds` and `likelyReview` return no address for a removed photo, by adding `removed_at` to their selects. Both files are in `lib/`, not `teamPages/`.
- The image then disappears rather than "showing as removed", so reword T9 to "no broken image". A "Removed" label would need a `teamPages/` change; if you want one, say so and defer it to SYC-246.
- Add `teamCatView.ts` and `likelyReview.ts` to §6 and §13. Neither is listed today.
- T13's source test won't catch these two, because they select only `publicId`.

### 2. Major: §12 — carry-back breaks on any removed photo

**What happens.**
- `lib/db/src/switchover/carryBack.ts:469-499` fits Neon rows into the target database's columns.
- The target is the old baseline Replit database, where `photos.data` is `NOT NULL`.
- A removed photo has `data = null`, so the insert or update fails.
- The file's header (`:20-60`) says a failed apply changes nothing, so the whole rollback path is blocked.

**Why it matters.** This isn't only a test concern. Carry-back is the documented rollback (`neon-database.md:172` and `:213-232`). §12 only says "unchecked; the plan checks".

**Fix:** decide now, choosing one of:
- carry-back writes `''` (an empty image) in place of a null `data`, which is also safe for privacy;
- carry-back refuses, with a plain message;
- the runbook says carry-back is retired.

Then add a test to `carryBack.test.ts`. Whether the old Replit database still exists is unchecked; the spec says it is kept for "cutover + 30 days".

### 3. Major: §7 "After any restore" re-runs only step 6, but `photo-remove` refuses a photo that isn't hidden (§5.4 rule 2)

**What goes wrong.**
- A restore point can be older than step 5, the hide.
- If it is, the restored database shows the photo to the public.
- §5.4 rule 2 then makes the re-run of `photo-remove` fail until someone hides it again.
- Nothing in the runbook says the photo is visible in between.

Revision 1's wording had the same gap, and revision 2 didn't close it.

**Fix:**
- For every ledger row newer than the restore point, re-apply both steps: hide, then remove (steps 5 and 6).
- Do this before visitors reach the restored database, for example before a snapshot swap goes live.

### 4. Major: R1 and R2 are only safe if "removed implies hidden", and nothing enforces that

**R1, the public route.** `routes/photos.ts:46-58` selects the whole row. `Buffer.from(photo.data, ...)` at `:58` crashes on null. The only thing returning a 404 first is `hiddenPhotoIds`.

**R2, the team route.**
- `servablePhoto` (`teamReports.ts:150-166`) lets anyone with `hide_photo` see a hidden photo.
- The route then reads the photo again (`:172-177`) and calls `Buffer.from(full.data)` at `:178`.
- If the photo was removed between the two reads, that's a 500, not the promised 410.

**Nothing ties removal to hiding.**
- The photo log is append-only, but the database never checks that a removed photo stays hidden.
- The refusal to restore lives only in `setPhotoVisibility`.
- A raw SQL restore, or `issues/hide.ts`, would get past it.

**Fix:**
- Add an explicit `data === null` guard in R1 that returns 404 with `no-store`.
- Add the same guard on the second read in R2 and R3.
- Better still, make `hiddenPhotoIds`, the one place every route asks, also return removed photos.
- Or add a trigger that refuses a restore event for a removed photo.

### 5. Major: §5.5 check 5 — the fingerprint exists only inside the run that did the removal

**When the check can't run.**
- The fingerprint is taken "before deleting the picture" and checked after the commit.
- If the run dies between the commit and the search, the bytes are gone and the check can never run.
- The same happens when a re-run says "already removed" (T5).
- Either way, the runbook has no way to prove "GONE".

**Where the slice comes from.**
- The first 64 base64 characters (48 bytes) are a JPEG or EXIF header.
- Many photos from the same phone share that header, so a slice from the start would match other photos, including control photo Q.

**Cost.**
- Scanning every column of the whole database has a 120-second timeout, and nothing sources that figure against the production database's size.
- A timeout would show as a false `NOT GONE`.

**Fix:**
- Run the byte scan inside the removal transaction, after the update, so it sees its own writes.
- Or state that a lost fingerprint means `NOT VERIFIED`, and say what to do then.
- Specify that the slice is taken from the middle of the data.
- State the cost of the scan.

### 6. Minor, but privacy-relevant: §4.3 — `variantFor`'s "checks again just before saving" is still a race

**The race.**
- `photoVariants.ts:42-52` reads the photo, runs `sharp`, then does a plain `insert ... onConflictDoNothing`.
- Checking again and then inserting is still check-then-act: the removal can land between the two.
- The double check two seconds apart (§5.5 check 2) is a backstop, not a guarantee, because `sharp` can take longer than two seconds under load.

**Fix:**
- Make the insert conditional: `insert ... select ... where exists (select 1 from photos where id=$1 and data is not null)`.
- Or take `select ... for share` on the photo row in one transaction, which blocks the removal's `for update`.
- T15 must exercise the interleaving itself, not only a removal that happens after the fact.

### 7. Minor: §4.1 — the rollback's order of steps

**The problem.**
- "Drop the check and three columns, then set `NOT NULL`" drops the columns holding the audit trail (`removed_*`) before the step that is meant to fail.
- If the rollback isn't atomic, that evidence is lost.
- Compare `0031_person_scopes_start_reach.sql`, whose rollback puts a `DO $$ ... RAISE EXCEPTION` guard first.

**Fix:**
- Put a guard first, before anything is dropped: `if exists (select 1 from photos where data is null) then raise exception`.
- Add to the runbook: once any photo has been removed, never roll the app back past this PR. The old code crashes on a null `data` in the team gallery routes (`teamReports.ts:178`, `routes/photos.ts:58`) and in the repeat-upload path.

### 8. Minor: §4.6 — the `photo_removal_on` gate works, but it relies on a person, not a check

**Adding the key touches more than §13 lists.** §13 mentions only "the `photo_removal_on` setting key" under `db-ops.yml`. The key also needs:
- an entry in `SETTING_KEYS`, and a boolean case in `settingShapeProblem` (`lib/db/src/appSettings/shape.ts:45-93`, following `extra_photos_on`);
- the `setting_key` choice list (`db-ops.yml:58-65`);
- `dbOps.settings.test.ts`;
- the list of settings in `neon-database.md:35`.

**Nothing enforces the order.**
- Nothing stops someone switching it on before the publish lands.
- It's unchecked that the live commit "includes this PR". `/api/healthz` returns `commit` (`routes/health.ts:9-27`), but that is a plain SHA, so the runbook needs `git merge-base --is-ancestor` to compare it.

**The production-only gate is fine.** Development runs the main branch's code.

**The reply is undefined while the gate is off.** The template (§7 step 12) says "deleted from our live database", which isn't true for a photo that is hidden but not yet removed. Add a hide-only reply, or say the reply waits.

### 9. Minor: §4.1 — the check constraint compared with SYC-246's plan

- **Stricter than the plan, which is fine.** The plan (`syc-44-report-an-issue.md:~481`) says `data is null` exactly when `removed_at is not null`. Revision 2 also requires `removed_by` and `removed_reason` to be set.
- **Two formats for one field.** The hand path stores `removed_reason` as the `photo_ref` (`SYC-123`), while November's button will have a free-text "why". Define one format for `removed_reason`, so November doesn't break the check or the allowlist.
- **A dropped tile.** The plan's "Photo removed" tile in the sightings payload is dropped here. That's reasonable, but note it on SYC-246.
- **Wording.** T0b lists "`removed_by` naming no person" as a check failure. It's a foreign-key violation, not the check.

### 10. Minor: §4.1 — "the migration doesn't rewrite any row", and the lock

**The lock.**
- `ADD CONSTRAINT ... CHECK` takes an ACCESS EXCLUSIVE lock and scans the whole table, and `photos` holds the base64 data. `DROP NOT NULL` only changes metadata.
- `MIGRATE_LOCK_TIMEOUT` is 5 seconds (migrations README), so a long photo read could make the first attempt fail. That means a retry, not lost data.
- Say in the runbook to retry if it times out, and run it off-peak.

**No problem with the tooling.**
- Drizzle's `check()` has precedent, for example `person_scopes_start_ck` in 0031, so `migrate:check` should accept it.
- An import cycle `photos → people → colonies → people` already exists via `photoVisibility.ts:12-13`, and it uses lazy references, so the new foreign key adds no new problem.

### 11. Minor: R6 is already null-safe

- **R6, the outbox.** `outbox.ts:590-593` already does `stored?.data ? Buffer.from(...) : null`. The spec lists R6 as a change; it only needs a test.
- **R7, the sweep.** `sweep.ts:211-217` already copes with a missing row, but not with a null `data`. The type checker will force a guard.
- **R4 and R5.** `sightings.ts:279-286` (R4) and `sightings.ts:560-579` (R5) need filters for non-null `data`, as the spec says.

### 12. Minor: can T2 actually be run?

- **The first row of T2.** "Delete and record" being one statement is fine. Because the check makes skipping half of it impossible, the first row of T2 can only test "nothing removed at all". That still works: checks 1 and 5 fail, because the photo's own `photos.data` still matches the fingerprint. The table should say so.
- **No overlap.** T0b and the search checks don't overlap in a wrong way.
- **T13 is fragile.** Its pattern for `photosTable.data` and whole-row selects can miss `.select()` and `.from(photosTable)` written on separate lines. Test it against `sightings.ts:577-578`.

### 13. Minor: plain English in §1, §2, §10 and §11

**Terms the approver won't know:**
- "ask mode" (§2);
- "removal ledger", which appears in §2 before it is defined;
- "publish";
- "migration number agreed with other sessions";
- "a slot in a publish" (§11);
- "relaxes one rule";
- "stand-in" (§4.2; §1 says "the photo the public already sees in its place" once);
- `photo-list` in the §2 table.

**What already works:** §1 point 5 is clear and honest, and §11's "about a day more" is flagged unchecked, so that's acceptable.

**One addition:** say what a person who wrote in sees while removal isn't switched on yet.

### 14. Nit: §5 — the pattern

The table shows `\|` inside a Markdown code span. Copied literally into code, that breaks the pattern. Show it in a code block instead.

## Revision-1 fixes checked

- **`photo_ref` allowlist.** Survived (§5); it's stored as `removed_reason`. The format question is finding 9.
- **A privacy hide on an already-hidden photo.** Survived (§5.2): a second `privacy` hide, and the photo is never shown. The `photo_private` report route is still in §5.4(3).
- **The ledger and re-applying after a restore.** Regressed or incomplete; see finding 3. Step 6 is re-run without step 5.
- **An honest reply template.** Survived: N is the longest-lived copy found.
  - The template doesn't mention copies held by other providers. C1 says OpenAI's retention is unchecked, and the reply claims nothing about it, which is fine.
  - It could add: "we can't reach copies held by services we use".
- **Public logs.** Survived (§5 "everything these commands print is public", T7).
  - `photo-list` prints the cat number, the removal date and "hidden for privacy". In a public repo's logs, that links a cat to a privacy event.
  - The risk is low, because the ids are unguessable, but it deserves a line in the spec.
- **Search check 5 (the `removed:` record).** Replaced by the `removed_*` fields (§13 table). That's OK; finding 5 covers its remaining weakness.
- **`variantFor`'s race guard (round-1 finding 11).** Now keyed on a null `data`, but not specified as atomic; see finding 6.
- **The `mime` backfill and marker.** Correctly dropped; no marker in `mime` is needed.
- **The restore branch in `teamPhotos.ts` (round-1 finding 8).** Survived (§6 item 2).

## Claims verified correct

- **No other code reads `photos.data` beyond R1–R8.** I found none.
  - Every other user of `photosTable` selects only `id`, `publicId` or `mime`: `colonyCats.ts:168`, `teamColonies.ts:305`, `teamCatList.ts:152`, `colourCheck.ts:112`, `guardianCatView.ts:139`, `capabilityTargets.ts:139`, `issues.ts:285` and `due.ts:263`.
  - `appSettings.ts:64` only reads `p.created_at`.
  - Raw SQL `from photos` appears only in `photoVisibility.ts:228` and `issues/hide.ts:172` (`select id ... for update`), plus tests.
  - Nothing imports the `Photo` type.
  - `artifacts/cat-spotter` and `mockup-sandbox` have no database access.
  - `fingerprint.ts` hashes `photos` rows generically, so the new columns are fine.
- **Whole-row selects.** `routes/photos.ts:46`, `sightings.ts:279-281` and `sightings.ts:575-578` select whole photo rows. These are R1, R4 and R5.
- **A source test like T13 already exists.** `teamCatList.source.test.ts` forbids `.from(photosTable)` in that file, and T13 follows the same pattern.
- **The old app against the new schema.**
  - The old code inserts `{data, mime}` (`spotPhotos.ts:96`, `roleKit.ts:58`). The check passes, because `data` is set and the `removed_*` columns are null.
  - The old code reads `data` as a string, which is fine until a photo is removed.
  - This is the harmless "old code + new schema" case in the migrations README.
- **The stand-in rule matches.** `displayPhotoRows` (`photoVisibility.ts:119-162`) orders resolved sightings by `createdAt desc, id desc` and leaves out hidden photos. Since removed implies hidden, adding "not removed" is consistent. `primaryPhotoId > 0` is guarded at `:124`.
- **"`teamPages/` is untouched".** Only partly true; see finding 1. `routes/teamPhotos.ts:68-111` really does have no branch for new outcomes, so the `removed` case needs one.
- **The migration number.** PR #239 does carry `0032_cat_news_check.sql` (checked with `gh pr view 239 --json files`). Open PRs #240 and #242 add no migrations. Unmerged branches without a PR are **unverified**.
- **Workflow inputs.** There are 10 today: `target`, `command`, `people_role`, `people_change`, `people_colony`, `setting_key`, `setting_value`, `base_url`, `confirm` and `fail_after`. Five new ones make 15, as the spec says. GitHub's limit is **unverified** (believed to be 25).
- **`/api/healthz` shows a commit.** Real: `routes/health.ts:9-27`, `buildInfo()`.
- **The settings CLI and `app_settings`.**
  - The CLI is in `lib/db/src/appSettings/cli.ts`; the `app_settings` table is in `lib/db/src/schema/matchWait.ts:9`.
  - A new key follows the `extra_photos_on` pattern in `shape.ts:45-93`.
  - The `photo-remove` CLI, which lives in `lib/db`, can read it directly.
- **Drizzle `check()` is widely used** (`welfare.ts:123-154`, `personEvents.ts:72`, `photoVisibility.ts`). The `photos → people` foreign key adds no new circular import problem (see finding 10).
- **Agreement with the plan and the storage spec.**
  - SYC-246's PR 7.2 (`syc-44-report-an-issue.md:479-489`) and hosting §6.5 (null the bytes, mark the photo removed, record who, when and why) match §4.1 and §4.4.
  - The restore refusal and the matching skip agree with the plan's table.
  - I didn't re-read `DECISIONS.md` Decision 3 beyond what the round-1 review already checked.
- **The `photo_visibility_events` rules.** The author check ties `author = person_id::text` for team members (`schema/photoVisibility.ts:~54-58`), so a team member as `photo_by` for hides is consistent.
- **Unverified:**
  - whether the old Replit database still exists for carry-back;
  - the size of the production tables, for the 120-second scan;
  - GitHub's limit on inputs;
  - the effort estimate in §11, which the spec labels unchecked.
