# Removing a photo by hand on a privacy request (SYC-462)

**Linear:** SYC-462. It blocks the launch on Saturday 31 October 2026.

**Related tickets:**
- SYC-246: the team's "Delete for good" button, due mid-November
- SYC-66: the privacy policy
- SYC-44: Report an issue
- SYC-415: extra photos
- SYC-396 PR 1.2: the small and medium versions of each photo
- SYC-279: how photos are cached
- SYC-303: hidden photos are still sent to the matcher
- SYC-276: copies of a photo already saved on phones

**Status:** draft for Samuel's approval. Nothing here is built. The adversarial review (`syc-462-photo-removal-by-hand-review.md`, 18 findings) is folded in. Its last section says what happened to each finding.

**Checked against:** `origin/main` at `bdffc3c3` (18 October 2026). Every claim below about how things work today names the file it was read in.

**Launch plan rows:** `docs/superpowers/plans/mvp-launch-31-oct.md` lines 58, 211 and 264.

**For Samuel:** §1, §2, §7 and §10 are the parts to read. §3 to §6 and §8 are the engineering detail behind them, and you can skip them.

---

## 1. The short version

Someone writes to hello@catspotters.com: "there's a photo of my front door (or my child, or my number plate) on a cat's page, please take it off." Until the team gets its own button in November (SYC-246), this is what happens.

1. **A person decides.** Samuel or someone on the Syros Cats team looks at the photo and agrees it shows a person or a private place.
2. **Claude hides it first.** Hiding takes the photo off every public page at once, and it can be undone. If the team has already hidden it from the dashboard, Claude just records that it was hidden for privacy. The photo is never shown again in between.
3. **Claude then removes it for good.** This deletes:
   - the picture itself;
   - its small and medium versions;
   - its place as the cat's main photo;
   - its use for recognising the cat.

   This can't be undone, so Claude has to type the photo's id twice and the word `REMOVE`.
4. **Claude checks it's gone.** The command searches the whole database for the picture and for any mention of it, and prints what it found. Claude then checks that the photo's web address now answers "not found".
5. **The person gets a reply.** It says the photo is gone from the app and the website. It is honest about what we can't reach:
   - a copy already saved on someone's phone;
   - backups, which clear after a set time. We look that time up for each request rather than promising a number in advance.

Every command first **shows what it would do and changes nothing**. That's the dry run. It's what happens unless Claude adds the confirmation word.

**No database change (migration) is needed.** The removed photo's record stays, with the picture wiped out of it and a "removed" label on it, so nothing that points at the photo breaks. November's button (SYC-246) can take these records over as they are (§9).

---

## 2. Who does what

| Step | Who | How |
|---|---|---|
| Request arrives | Anyone | An email to hello@catspotters.com (SYC-66), or a "Report an issue" report choosing "shows a person or something private" |
| Finding the photo | Claude, with the team | From the cat the person names, using the list command (§5.1) or the cat's page on the team dashboard |
| **Approving** | **Samuel, or someone on the Syros Cats team** | They confirm in writing, by email or a Linear comment, that the photo shows a person or a private place. **Their judgement is the real safeguard.** A report from a stranger only puts the photo forward; it never approves a removal. Claude never approves its own |
| Hiding, removing and checking | Claude | Through the existing database-commands workflow (§5). Before any change to the live database, Samuel switches the session to "ask" mode, as he does for every live database change |
| Reply to the person | Whoever looks after the inbox | Using the template in §7, once steps 9 and 10 are done |
| Records | Claude | A ticket for each request, plus the **removal ledger** (§7). Both hold the photo's id, who approved it, the dates and the workflow runs. **They never hold the name, email or address of the person asking**, because the code repository and its workflow logs are public |

**When removal is allowed** is unchanged from DECISIONS.md, Decision 3 (14 October 2026): *"Delete for good" is for privacy only.* That means a photo showing a person or a private place. An offensive photo stays hidden; it isn't removed. The remove command enforces this (§5.4).

---

## 3. Every place a photo is kept today

All of this is read from the code on `origin/main` (`bdffc3c3`). Paths are relative to the repo root. `api` means `artifacts/api-server/src`.

### 3.1 In the database

The picture itself is held in **one column only**: `photos.data`, base64 text, `NOT NULL` (`lib/db/src/schema/photos.ts:36`). Every other place holds either a smaller copy or a pointer to that row.

| # | Place | File:line | Link to `photos.id` | Locked against changes? | What removal does |
|---|---|---|---|---|---|
| P1 | **The picture**: `photos.data` (plus `mime` and `public_id`) | `lib/db/src/schema/photos.ts:33-37` | is the row | no trigger | **Wipe it**: `data = ''`, `mime = 'application/x-removed'` (§4.1) |
| P2 | **The small and medium versions**: `photo_variants.bytes` | `lib/db/src/schema/photoVariants.ts:24-38`; `lib/db/migrations/0028_photo_variants.sql` | FK, `ON DELETE CASCADE` | no | **Delete** both rows, and stop them being made again (§4.3) |
| P3 | **The cat's main photo**: `cats.primary_photo_id` | `lib/db/src/schema/cats.ts:28` | **no FK**; `NOT NULL`; `0` means "no photo" | no | **Repoint** it to the photo the public already sees in its place, or to `0` (§4.2). Together with §6, this keeps the photo out of matching |
| P4 | **The sighting's cover photo**: `sightings.photo_id` | `lib/db/src/schema/sightings.ts:21` | **no FK**; `NOT NULL` | **yes**: `sightings_append_only` refuses changing it (`lib/db/migrations/0013_deletion_unlinks_people.sql:21-79`) | **Left pointing** at the wiped row. Readers treat it as a hidden photo, so the public sees no photo there (§4.5) |
| P5 | **Every photo of a spot** (first, face and body; SYC-415): `sighting_photos` | `lib/db/src/schema/sightingPhotos.ts:26-44`; `0029_sighting_photos.sql` | FK, `CASCADE` | no | **Left in place**, pointing at the wiped row, so the spot keeps its shape |
| P6 | **Answers and coat readings made from the photo**: `observations.photo_id` | `lib/db/src/schema/observations.ts:48` | **no FK**; nullable | **yes**: `observations_append_only` (`0001_data_spine_tables.sql:125`) | **Left pointing**. These rows hold no picture: `suggested_value` is only the model's colour answer (`api/lib/coatReading/record.ts:92`) |
| P7 | **Reports about the photo**: `welfare_reports.photo_id` | `lib/db/src/schema/welfare.ts:96`; `0023_issue_reports.sql:16,20` | FK, `NO ACTION`; a check requires it for the `photo_*` reasons | no | **Left pointing**. This link and P8 are why the row can't simply be deleted |
| P8 | **The log of hides and restores**: `photo_visibility_events` | `lib/db/src/schema/photoVisibility.ts:34-57`; `0014_photo_visibility.sql:13,23-25` | FK, `NO ACTION` | **yes**: rows can only be added, and the table can't be truncated | **One more `hide` row** records the removal (§4.4) |
| P9 | **A pointer created later**: turning a waiting spot into a new cat copies the spot's cover photo into the new cat's `primary_photo_id` | `api/routes/sightings.ts:769-775` | — | — | §6, change 3: a removed cover photo gives the new cat `0` instead |
| — | **Reporters' own photos**: `welfare_report_photos.bytes` | `lib/db/src/schema/welfare.ts:173-191` | **not** a `photos` row | no | **Out of scope** (decision D3). Only the team can see these; they're never public |

**Checked, and holding no photo, photo id or photo address:**
- `sighting_matches`: cat ids and scores only (`lib/db/src/schema/sightingMatches.ts`);
- `notifications` and push payloads: addresses are built when they're read (`api/routes/notifications.ts:138-147`, `api/lib/push.ts:12-19`);
- `mail_outbox.payload` and `mail_deliveries` (`api/lib/mail/outbox.ts:199,219-224`);
- `profiles`, `colonies`, `feeding_sites`, `mapping_events`, `person_events`, `app_settings` and `map_tile_cache`.

A photo's web address is never stored. It's built each time it's needed, in one function (`api/lib/photoVisibility.ts:64-69`), and `api/lib/photoVisibility.source.test.ts` keeps it that way. The search in §5.5 checks every text column anyway, in case one of these lists is wrong.

**Why the row isn't simply deleted.** Two links block a `DELETE`: the add-only log (P8) and reports (P7). Getting round them would mean switching off a safety trigger on the live database and losing the record of who hid the photo.

The approved storage spec already allows the alternative: *"delete the row, or null the bytes and mark it removed"* (`docs/specs/hosting-and-photo-storage.md` §6.5). November's design does the same: *"The row stays, so every link to it survives"* (`docs/superpowers/plans/syc-44-report-an-issue.md`, PR 7.2).

**Code that reads the picture today.** Each of these must cope with a wiped row:
- `api/routes/photos.ts`
- `api/routes/teamReports.ts:172`
- `api/routes/sightings.ts:276-289` and `556-583`
- `api/lib/photoVariants.ts:42`
- `api/lib/mail/outbox.ts:590`
- `api/lib/coatReading/sweep.ts:211`

§6 deals with the ones that don't cope. T13 (§8) stops a new reader being added without review.

### 3.2 Copies made while the photo was in use

| # | Place | File:line | What we can do |
|---|---|---|---|
| C1 | **Matching (OpenAI)**: a cat's main photo is sent with every nearby spot. **Today that includes a hidden main photo**, because nothing checks whether it's hidden (SYC-303) | `api/routes/sightings.ts:276-289` | P3's repoint and §6 change 2 stop it being sent from the moment it's removed. Anything the provider kept from earlier calls is outside our system and **unchecked**. We store no prompts, outputs or embeddings, only `sighting_matches` |
| C2 | **A repeat upload of the same spot** reads that spot's photos again and re-sends them, including through a fallback that reads `sightings.photo_id` | `api/routes/sightings.ts:556-583` | §6 change 2 skips a removed photo on both reads |
| C3 | **The coat reader** sends the cat's display photo, never a hidden one | `api/lib/photoVisibility.ts:103`; `api/lib/coatReading/sweep.ts:203` | Nothing needed |
| C4 | **The "Photo hidden" email** to the team inbox, **with the photo attached**. It's only sent when a report hid the photo | `api/lib/mail/outbox.ts:568-603`; `api/lib/issues/alertEmail.ts:137-146` | The inbox owner deletes that email (runbook step 9). How long Resend keeps it is **unchecked** |
| C5 | **Server logs**: the photo's public id appears in request paths, never the picture | `api/app.ts:30-41`; `api/lib/logger.ts:82-98` | Nothing needed. The id of a removed photo leads nowhere |
| C6 | **Screenshots** in the public code repository, pull request comments and Linear attachments | `docs/screenshots/`, `attached_assets/` (384 images) | Runbook step 10 searches for that photo's id and for screenshots of that cat. A copy in the repository's history can only be removed by rewriting history, so if one turns up, it goes to Samuel. The rule from now on: screenshots use seeded test data |

### 3.3 Caches

| # | Place | File:line | Behaviour |
|---|---|---|---|
| K1 | **The public photo address**, `GET /api/photos/:publicId` | `api/routes/photos.ts:44-69` | A hidden or unknown photo answers `404` with `Cache-Control: no-store`. A shown photo is sent with `private, max-age=31536000, immutable`. That means **only the viewer's own browser or phone keeps a copy**, for up to a year, without asking again. No shared cache may keep it, Cloudflare or otherwise (DECISIONS.md, Decision 1, 14 October; SYC-279) |
| K2 | The team's full-size photo, `GET /api/team/photos/:publicId` | `api/routes/teamReports.ts:166-178` | `no-store`. Answers `404` for any row whose `mime` isn't an image type (`:87`, `:150-151`), so the "removed" label closes it with no code change |
| K3 | The team's small and medium versions, `GET /api/team/photos/:publicId/:size` | `api/routes/teamReports.ts:187-208` | `private, no-cache` with an ETag, so the browser asks again on every view. Closed by the same `mime` check |
| K4 | **The app's saved list of cats** | `artifacts/cat-spotter/lib/catalogue.ts:17` | Holds addresses, not pictures. The next time the app fetches the address, it gets `404` |
| K5 | **The image store in the app and the browser** (`expo-image`, the browser's HTTP cache) | `artifacts/cat-spotter/components/CatPicker.tsx:289` and the defaults | **A phone that has already shown the photo may keep it** until its cache clears. Nothing on the server can reach it (SYC-276). The reply says so plainly (§7) |
| K6 | The spotter's own offline queue: photos waiting to upload | `artifacts/cat-spotter/lib/pendingPhotos.ts:23`; `lib/webPhotoStore.ts:52` | The spotter's own phone holds their own photo until it uploads. That isn't ours to reach |

The launch plan's line 58 says the command removes "caches". It doesn't, quite: it removes the copies inside the database, and makes the photo's addresses stop answering. It can't empty a device's cache. The plan's wording is corrected when the runbook lands.

### 3.4 Backups and whole-database copies

From `docs/runbooks/neon-database.md` and the Neon switchover plan. **Which of these exist right now is unchecked.** The runbook lists them, read-only, each time (step 10).

| Copy | Kept for | What happens |
|---|---|---|
| Neon `production` point-in-time history | 7 days according to `neon-database.md:172`. The live setting is **unchecked**; runbook step 10 reads it | It ages out |
| Neon `development` branch, which is a copy of real data | until it's reset | **The same removal is run there too**, or the branch is reset from `production` after the removal (runbook step 8) |
| Neon `rehearsal` branch, the archive branches (`replit-final-<date>`, `pre-restore-*`, `production (old)`) and named snapshots | until someone deletes them | Listed. Any copy older than the removal goes on the ticket with its planned deletion date, for Samuel to decide |
| The old Replit databases | until 30 days after the cutover (switchover plan G.1) | Listed, with their dates |
| Encrypted dumps: a GitHub artifact, and Samuel's offline copy | the artifact for 7 days; Samuel's copy is his own | Listed. Samuel's copy is his to deal with |

**A restore brings removed photos back.** Any of these puts back the database as it was at that moment, including pictures removed since:
- a snapshot swap;
- a point-in-time restore that gets used;
- a carry-back;
- a reset of `development` from `production`.

So every removal goes on the **removal ledger** (§7). After any of those operations, the runbook re-runs `photo-remove` for every ledger entry dated after the restore point. A line saying so is added to the restore section of `neon-database.md`.

---

## 4. What "removed" means in the database

Steps 4.1 to 4.4 happen in **one transaction**. It holds the same lock on the photo's row that hiding takes (`select … for update` on `photos`, as in `api/lib/photoVisibility.ts:227-229` and `api/lib/issues/hide.ts:171`).

### 4.1 The picture is wiped and labelled

`update photos set data = '', mime = 'application/x-removed' where id = $1`.

- `data = ''` meets the `NOT NULL` rule, and the row no longer holds any picture.
- `mime = 'application/x-removed'` is the **"removed" label**. It needs no new column. The team photo routes already refuse anything that isn't an image type (`api/routes/teamReports.ts:150-151`).
- The original type (JPEG or PNG) isn't kept. Nothing needs it.
- `public_id` stays, so the old address answers `404` and is never reused.

### 4.2 The cat stops using it

Each cat whose `primary_photo_id` is this photo is pointed instead at **the photo the public already sees in its place**. That is the newest cover photo from that cat's resolved sightings that isn't hidden, newest first by `created_at` and then `id`. It's the same rule as `displayPhotoRows` (`api/lib/photoVisibility.ts:119-162`). If no such photo exists, the cat gets `0` ("no photo"), and the app shows its placeholder.

- **The public page looks the same before and after**, because a hidden main photo already shows that stand-in. The storage spec (§6.5) says "shows the placeholder". The stand-in is better, and it's what hiding already does.
- **`0` is safe everywhere it's read today:**
  - `displayPhotoRows` filters on `> 0` (`photoVisibility.ts:124`);
  - matching selects nothing for it (`sightings.ts:276`);
  - `coatReading/due.ts:161` and `guardianCatView.ts:131` both guard against it.
- **The rule lives in two places**: here, in `lib/db`, and in the app. A parity test (T14) keeps the two the same.
- **One accepted side effect.** After the repoint, the coat reader may read the stand-in photo once, labelled `main_restored` (`coatReading/due.ts:161-183`). That photo is already public, so no harm is done. Only the label is slightly off.

### 4.3 The small and medium versions are deleted, and can't come back

`delete from photo_variants where photo_id = $1`.

**Rebuilding is stopped at the source.** `variantFor` (`api/lib/photoVariants.ts:35-53`) reads the photo without a lock, then saves a version. If it read the photo just before the removal, it would save a version just after it, and bring one back.

§6 change 4 stops that: `variantFor` refuses a photo carrying the label, both when it reads and again just before it saves. As well as that, after the commit the command searches again (§5.5) and deletes any version it finds. It does this twice, two seconds apart.

### 4.4 The removal is recorded

One more row goes into `photo_visibility_events`:
- `action = 'hide'`;
- `author` and `person_id` set to the approving team member;
- `reason = 'removed: <ref>'`.

This keeps the photo hidden for good, because the newest event is a hide. It also answers "who removed this, when, and why?" in the add-only log, as the storage spec asks: *"Removal is recorded — who, when, why"* (§6.5).

The GitHub account that ran the workflow is recorded on the ledger, with the run link. The `author` in the log is the approver, who didn't press anything themselves.

### 4.5 Everything else stays

P4, P5, P6 and P7 keep pointing at the row, which now holds no picture and stays hidden. Every reader already treats a hidden photo as having no address: the public payload carries `photoUrl: null` (`api/routes/cats.ts:239`, `api/lib/photoVisibility.ts:64`), and the app shows no photo in that place.

The "Photo hidden while Syros Cats take a look" tile is SYC-44 PR 6.1. It isn't on `main` yet, and its wording would be wrong for a removed photo. That's a note for SYC-44 (§11).

Nothing else is touched.

---

## 5. The commands

There are four new `db-ops` commands. Each one is run by `.github/workflows/db-ops.yml` from `main`, against `target` = `development` or `production` (never `rehearsal`), exactly as the `people-*` commands are (`scripts/db-ops.sh:491-498`).

Behind them sits one small tool, `lib/db/src/photoRemoval/cli.ts`, built the same way as `lib/db/src/people/cli.ts` and `lib/db/src/appSettings/cli.ts`. It follows their rules:
- `--target` is required, and must equal `DATABASE_TARGET`;
- the database address comes only from that target's own variable;
- the output never includes an address, a host or a connection string (`grep_no_urls`).

**Everything these commands print is public**, because the repository and its workflow runs are public. So the output never includes:
- a location;
- a device id;
- a person's name;
- any note text;
- a report's reason or a hide's reason text.

It only prints photo ids, cat numbers, dates, and yes/no answers such as "hidden for privacy: yes".

**One run at a time.** The workflow's `concurrency` group keeps only one run waiting; a third run would replace it. So the runbook does the dry run, the real run and the check one after another, waiting for each to finish.

New workflow inputs (15 inputs in total). GitHub's limit on inputs is checked with actionlint and a real dispatch while building. The reviewer believes it's 25; that's **unchecked**.

| Input | Used by | Notes |
|---|---|---|
| `photo_id` | all commands except `photo-list` | The photo's public id: the UUID in its web address |
| `photo_id_confirm` | `photo-remove` | The same id, typed again |
| `photo_cat` | `photo-list` | The cat's number |
| `photo_by` | `photo-hide`, `photo-restore`, `photo-remove` | The approving team member's people id, from `people-list` |
| `photo_ref` | `photo-remove` | The request reference. **Only two forms are accepted:** `SYC-<number>`, or `hello YYYY-MM-DD #<n>` (pattern `^(SYC-[0-9]{1,5}\|hello [0-9]{4}-[0-9]{2}-[0-9]{2} #[0-9]{1,3})$`). So a name, a phone number or a street can never get into the public log |
| `confirm` (already exists) | `HIDE`, `RESTORE` or `REMOVE` | Without it, the command only prints what it would do |

**Who counts as a team member** for `photo_by`: someone on the list right now. That means:
- they've joined (`accepted_at` is set);
- they haven't left;
- they hold the `staff` or `management` role, and it hasn't expired.

The tool reuses the people store's own "on the list now" query (`lib/db/src/people.ts`) rather than writing a new one. Those two roles hold `hide_photo`, `restore_photo` and `remove_photo` in the app (`api/lib/capabilities.ts:41,90-92`; `docs/specs/roles-and-invites.md:301`).

### 5.1 `photo-list` (read-only)

Lists every photo of one cat, newest first. For each photo it shows:
- its full public id;
- where it's used: the main photo, or a sighting number and role (first, face or body);
- the date it was taken;
- `hidden`, `hidden for privacy` (rule 3 in §5.4) and `removed`, each as yes or no.

### 5.2 `photo-hide` (dry run unless `confirm=HIDE`)

- **A photo that isn't hidden** gets a `hide` event with `reason = 'privacy'`, authored by `photo_by`. That's the same reason November's "for privacy" tick will store.
- **A photo that's already hidden**, for example from the dashboard, gets a **second** `hide` event with `reason = 'privacy'`. The dashboard's Hide button records no reason (`api/lib/teamPages/catPages.ts:414-424`), which is why this is needed. The photo is never shown in between. The log's rules allow two hides in a row (`photo_visibility_events_action_ck`, `_author_ck`).
- **A photo already hidden for privacy, or already removed**, gets nothing written. The command says "already" and finishes successfully.

**Undo:** `photo-restore`, or **Restore** on the cat's page in the team dashboard.

### 5.3 `photo-restore` (dry run unless `confirm=RESTORE`)

This undoes a hide. It has the same check on `photo_by`, and it's refused for a removed photo.

**A warning the runbook repeats.** After a restore, a later public report about that photo no longer hides it automatically (`api/lib/issues/hide.ts:187-192`, `restored_before`). So restore only when the hide was a mistake.

### 5.4 `photo-remove` (dry run unless `confirm=REMOVE` and `photo_id_confirm` equals `photo_id`)

It refuses, and changes nothing, unless **all** of these hold. They're checked again inside the transaction, under the lock.

1. The photo exists in `photos`.
2. It's **hidden right now**: its newest event is a `hide`.
3. It was **hidden for privacy** (Decision 3). That means one of these:
   - at least one `hide` event has `reason = 'privacy'` exactly (case-sensitive), with no `restore` after it;
   - a report with reason `photo_private` names it.
4. `photo_by` is a team member on the list right now (§5).
5. `photo_ref` is in one of the two accepted forms.

**If the photo is already removed**, the command prints "already removed on <date>" and finishes successfully without writing anything. Running it twice is safe.

**The dry run prints** the whole plan, then the search (§5.5) as things stand:

```
photo-remove (DRY RUN: nothing changed) target=development photo=3f2c9a1e-…-e91a
  hidden now: yes · hidden for privacy: yes
  picture:            41,233 bytes → would be wiped
  versions:           small, medium → would be deleted
  main photo of:      cat 182 → would become photo 7c1d04f2-…-02b4 (what the public sees now)
  spot photos:        sighting 5531 (first) → stays, shown with no photo
  answers/readings:   2 → stay; no picture in them
  reports:            1 → stays
  To do it: confirm=REMOVE and photo_id_confirm=<the same id>
```

The ids are shortened here only to fit the line. The tool prints them in full.

**A real run** prints the same lines in the past tense, then the search.

### 5.5 The search (part of every dry run and every real run)

It runs **after the commit, read-only, with no lock held**. It stops after 120 seconds, and it prints how long it took. It prints one line for each of these checks:

1. `photos.data` for the row is empty, and `mime` is the "removed" label.
2. `photo_variants` has no rows for the photo. This is checked twice, two seconds apart; any rows found are deleted and reported (§4.3).
3. No `cats.primary_photo_id` points at it.
4. Its newest visibility event is a `hide`.
5. **The record exists**: a `hide` event with `reason = 'removed: <ref>'`.
6. **The picture's bytes are nowhere else.** Before wiping, the command takes a fingerprint of the picture: a 64-character slice of its base64 text, plus the same bytes decoded. It then scans **every** column of type text, `varchar`, `json`, `jsonb`, array or `bytea` in **every** table in the `public` schema. That's the same "every column" approach as `api/routes/me.delete.test.ts:324-346`. It also checks that no column is of some other type it would miss. This catches a copy in a place nobody listed, including in tables added after this spec.
   - **An assumption, stated plainly.** Pictures are stored as one unbroken line of base64 (`api/lib/spotPhotos.ts:~92`), so a whole copy carries the same slice. A copy inside a re-wrapped or shifted encoding, such as an email attachment, wouldn't match. No table holds one today.
   - **The same picture under another id.** A race can save one spot twice (`api/routes/sightings.ts:~533-541`), so the fingerprint can find the picture in a second `photos` row. The search names that row's id, and the runbook treats it as a request of its own: its own approval, hide and removal.
7. **No other mention of the photo.** Every text, `json`, `jsonb` and array column is scanned for the photo's public id, except `photos.public_id` itself.

The run ends `GONE` only if every check passes. Otherwise it ends `NOT GONE: <checks>` with a non-zero exit code, and the workflow run turns red.

### 5.6 Checks outside the database (runbook steps, not part of the command)

- `curl -sI https://<live host>/api/photos/<photo_id>` must answer `404` with `no-store`.
- The cat's public details (`GET /api/cats/<cat>`) must not contain `<photo_id>` anywhere.

---

## 6. Small safety changes in the app

The removal stands without these: the picture is gone either way. Without them, though, a few rare paths would send an empty picture somewhere or show a broken one. Each change is small, has a test that fails without it, and matches a row of November's design.

1. **Restore is refused for a removed photo.**
   - `setPhotoVisibility` (`api/lib/photoVisibility.ts:221`) gets a new result, `removed`.
   - The dashboard route (`api/routes/teamPhotos.ts:68-111`) gets a branch for it. Today it has no branch for an unknown result. The new branch answers with JSON `409` `{code: "REMOVED"}`, or a short page: "This photo was removed for good on <date>. It can't be restored."
   - The button on the cat page lives in `teamPages/`, which another session is editing, so it isn't touched now. SYC-246 replaces it in November.
2. **Matching never sends a removed photo.**
   - `computeMatchCandidates` skips a candidate whose `mime` is the label (`api/routes/sightings.ts:276-289`).
   - A repeat upload filters removed photos out of both the spot's photos and the older single-photo fallback (`:556-583`). A spot with nothing left goes down the existing "photo has gone" branch.
3. **A new cat never starts with a removed photo.** When a waiting spot is resolved as a new cat (`api/routes/sightings.ts:769-775`), the new cat gets `0` if the spot's cover photo carries the label.
4. **No small or medium versions are made from a removed photo** (`api/lib/photoVariants.ts:35-53`), as described in §4.3.
5. **A belt-and-braces check:** the public photo route (`api/routes/photos.ts:51`) also answers `404` for the label.

---

## 7. The runbook (`docs/runbooks/photo-removal.md`, written in this PR)

1. **Log the request** as an SYC ticket: the date, how it arrived, the cat's number and which photo. Nothing about the person asking; that stays in the inbox.
2. **Find the photo**: run `photo-list` with the cat's number on `production`. This only reads.
3. **Get approval** from Samuel or the Syros Cats team, quoting the photo's id and what it shows. Record the approval on the ticket.
4. **Warn Samuel** that a change to the live database is next, and ask him to switch to "ask" mode.
5. **Hide**: run `photo-hide` as a dry run, then with `confirm=HIDE`. The photo is now off every public page. *To undo: `photo-restore`. Read the warning in §5.3 first.*
6. **Remove**: run `photo-remove` as a dry run and read the plan. Then run it with `confirm=REMOVE` and the id typed twice, and expect `GONE`. If the search names another photo id holding the same picture, go back to step 3 for that id.
7. **Check from outside**: the checks in §5.6.
8. **The development copy**: run steps 5 and 6 on `development`, or reset `development` from `production` after the removal. Step 6 on its own fails there if `development` was copied before the hide.
9. **The team inbox**: if a report hid the photo, ask whoever looks after the inbox to delete the "Photo hidden" email, which has the photo attached. Wait for them to confirm.
10. **Other copies**:
    - list the Neon branches and snapshots, and the restore window on `production` (read-only), and put any copy older than the removal on the ticket with the date it will be deleted;
    - search the repository, pull request comments and Linear attachments for the photo's id and for screenshots of that cat.
11. **Add to the ledger**: one row on the "Photo removals" Linear ticket, with:
    - the photo's id;
    - the date;
    - the request ticket;
    - who approved it;
    - the links to the workflow runs;
    - the GitHub account that ran them.
12. **Reply to the person**, but only once steps 9 and 10 are done. The template has three gaps to fill: the number of days from step 10, and whether the inbox email or a screenshot was found.
    > "We've removed the photo from Cat Spotters. It no longer appears anywhere in the app or on the website, and we've deleted it from our live database [and from our team's inbox]. If your phone or browser had already shown it, a copy may stay there until its cache clears; that's on your device, and we can't reach it. Our backups still hold it for up to [N] days, after which it's gone from them too."

    **N** is the longest-lived copy found in step 10. It's never a number assumed in advance. If any copy has no known deletion date, the reply waits until Samuel decides what to do with that copy.
13. **Close the ticket** with the run links.

**After any restore** (a snapshot swap, a point-in-time restore that gets used, a carry-back, or a reset of `development` from `production`), re-run step 6 for every ledger row dated after the restore point.

**If a step fails:**
- **Before step 6:** restore the photo and start again.
- **If step 6 ends `NOT GONE`:** don't just run it again. The output names the check that failed. Stop, and raise it on the ticket.

---

## 8. Test plan

Every test runs against a **throwaway local Postgres database**, with the real migrations and triggers (`lib/db/src/migrate/testDatabase.ts`, which refuses a `.neon.tech` host). No test touches Neon.

### 8.1 The full search test (the one the launch plan names)

**T1. Remove one photo from every place it appears.**

Seed a photo, **P**, with a recognisable picture, in **every** place listed in §3.1:
- as a cat's main photo;
- as one sighting's cover and `first` photo;
- as another sighting's `face` photo;
- with small and medium versions;
- with an observation;
- with a `photo_private` report;
- with a privacy hide.

Seed a control photo, **Q**, in the same places for another cat.

Run `photo-remove` for real, then assert:
- the search (§5.5) says `GONE`;
- **a separate scan, written in the test independently of the command's own**, finds P's bytes and P's public id in no column of any table, and finds no version rows for P;
- no cat points at P, and the cat that did now points at its stand-in;
- **Q is untouched**: same bytes, same versions, same main photo.

**T2. Skip one step, and T1 goes red.**

The removal is written as a list of named steps: wipe (P1), versions (P2), main photo (P3) and record (§4.4). A test-only option skips one of them. A parameterised test runs T1 once with each step skipped, and expects `NOT GONE` naming the check below:

| Step skipped | Check that must fail |
|---|---|
| wipe | 1 and 6 |
| versions | 2 |
| main photo | 3 |
| record | 5 |

**T2b.** A version is saved after the commit but before the check (the race in §4.3). The search must catch it and delete it.

Each of these reds is also confirmed once by hand, as a mutation probe recorded in the PR.

**T3. A new link to photos turns the catalogue test red.**

The test reads these from the database:
- every foreign key to `photos`;
- every column named `photo_id` or `*_photo_id`;
- every `bytea`, `json` and `jsonb` column.

It compares them with the reviewed list in this spec. A column added later, say by SYC-246 or by dashboard phase 3, turns it red until someone decides how removal should treat it.

### 8.2 Refusals and safety

**T4. Refusals and successes.** Each of these must be refused. A checksum of the affected tables, taken before and after, shows nothing changed:
- the photo isn't hidden;
- it was hidden only after a report calling it offensive (`photo_inappropriate`);
- the team hid it with no privacy reason;
- it had a privacy hide, then a restore, then a plain hide;
- the id is unknown;
- `photo_id_confirm` is different;
- `confirm` is missing (a dry run);
- `photo_ref` holds a name, digits, an `@` or mixed text;
- `photo_by` never joined, has left, has an expired role, or is only a cat guardian;
- the target doesn't match.

These must succeed:
- a photo hidden from the dashboard with no reason, then `photo-hide` (privacy), then removed;
- a photo hidden by a `photo_private` report, then removed directly.

**T5.** A second `photo-remove` prints "already removed", writes nothing and exits 0.

**T6.** Hiding and then restoring (the undo) leaves the photo exactly as it was. After a removal, `photo-restore` is refused.

**T7.** No command's output contains:
- a connection string;
- a device id;
- coordinates;
- note text;
- a report's or a hide's reason text.

**T8.** Two removals at the same time: one writes, and the other prints "already removed" (the lock).

### 8.3 In the app (api-server tests)

**T9. After a removal:**
- the public photo address answers `404` with `no-store`;
- both team photo addresses answer `404`;
- the cat's public page shows the same stand-in as before, and doesn't contain P's id;
- the sighting's payload has `photoUrl: null`.

**T10.** Restore through **the dashboard route**, both JSON and form, is refused with `REMOVED`. Mutation probe: remove the check, and T10 turns red.

**T11.** A repeat upload of a spot whose photo was removed returns the spot without calling the matcher. Two cases: one with `sighting_photos` rows, and one with only the older `sightings.photo_id` fallback. Mutation probe: remove either filter, and T11 turns red.

**T12.** Matching for a new spot near the cat doesn't send P. The mock matcher records what it was given.

**T12b.** Resolving, as a new cat, a waiting spot whose cover photo was removed gives that cat main photo `0`.

**T13.** A source test fails if `photosTable.data`, `photos.data` or `photosTable.mime` is read in a file outside the reviewed list in §3.1. This is like SYC-246's T7-8. Any new reader, Find from a photo for example, has to be added to the list on purpose.

**T14. Parity.** For several cats, the `lib/db` repoint chooses the same photo that `catDisplayPhotos` shows. The cases are:
- several candidates;
- one candidate hidden;
- a tie on `created_at`;
- no candidates.

**T15.** `variantFor` on a removed photo returns `null` and saves nothing. This includes the case where the label appears between its read and its save.

### 8.4 The dry run

1. **Before the PR is marked ready:** run `scripts/db-ops.sh` itself against a **local scratch database**, with `TARGET=development`, `DATABASE_TARGET=development` and `NEON_DEV_URL` pointing at the scratch database. Seed it as in T1, then run, in order:
   - list;
   - hide (dry run, then real);
   - restore;
   - hide;
   - remove (dry run, then real);
   - remove again.

   Paste the output into the PR.
2. **The launch checklist's run** ("the runbook's dry run passed on the development database", plan line 211) is on the Neon `development` branch, through the workflow, after merge. Decision D2 asks how far it goes. Claude gives Samuel a heads-up first, because it writes to a Neon branch.

---

## 9. How this fits November's button (SYC-246)

SYC-246's planned database change (`docs/superpowers/plans/syc-44-report-an-issue.md`, PR 7.2):
- makes `photos.data` nullable;
- adds `removed_at`, `removed_by` and `removed_reason`;
- enforces "no picture exactly when removed".

Its code changes:
- refuse a restore;
- skip removed photos in matching and in repeat uploads;
- answer removed photos differently on the team route;
- keep the 12-month shrink away from them.

Rows removed by hand **convert cleanly** in that change:
- `mime = 'application/x-removed'` picks them out;
- `data` becomes `null`;
- `removed_at`, `removed_by` and `removed_reason` come from the `removed:` hide event (§4.4);
- `mime` goes back to `image/jpeg`, since the original type is gone and nothing reads it.

**That backfill is added to SYC-246 as a comment** when this PR opens.

The two designs share:
- the same rule for when removal is allowed (Decision 3);
- the same privacy reason (`'privacy'`, exactly);
- the same "the row stays" shape;
- the same lock.

§6's changes 1 to 3 are November's restore, matching and repeat-upload rows, built early. Change 4 is November's note about versions (`api/lib/photoVariants.ts:57-59`).

---

## 10. Decisions for Samuel

### D1. Wipe the picture but keep its record, or something bigger?

**A. Wipe the picture and label the record, with no database change (recommended).** As described above.
- **For the person who wrote in:** the photo is gone from everything we run, the same day.
- **For the team:** nothing changes on screen, except that the photo no longer shows.
- **Benefits:**
  - nothing to fit into launch week's database changes;
  - every link keeps working;
  - November's button takes these records over as they are.
- **Risk:** until November, "removed" is a label in an existing field, not a proper field of its own. The tests pin it.

**B. Bring November's database change forward.**
- **For the person:** the same result.
- **Benefit:** proper fields from the first day.
- **Risk:** a database change in launch week, and every piece of code that reads a photo changes at once. That's November's whole PR, in the same week as the launch.

**C. Delete the record outright**, by switching off the log's safety lock.
- **For the person:** the same result.
- **Risk:** it destroys the record of who hid the photo and why, and leaves links in sightings that can never be repaired. If someone later asks "what happened to this photo?", there's no answer.

**Recommendation: A.**

### D2. How far does the test run on the development copy go?

**A. A full rehearsal (recommended).** On one real photo in the development copy: hide, restore, hide, remove, check.
- **Who's affected:** nobody. Development is a private copy, and that photo is just missing from it until its next refresh.
- **Benefit:** every step is proven on real data, through the real workflow, before anyone writes in.

**B. Only the "show what you'd do" runs.**
- **Who's affected:** nobody.
- **Risk:** the steps that actually change things are proven only on a throwaway local database.

**Recommendation: A.**

### D3. Photos sent in with a cat-in-trouble report

For example, a report photo that shows someone's yard. Only the team ever sees these; they're never public.

**A. Not covered at launch (recommended).** File a ticket for SYC-246 to cover them.
- **For the person:** if they ask, the runbook says to raise it with Samuel, who handles it as a one-off.
- **Benefit:** less to build this week, for photos the public never sees.

**B. A command for them too, now.**
- **For the person:** the same removal as any other photo.
- **Risk:** more to build and test in launch week.

**Recommendation: A.**

### D4. The small safety changes in the app (§6)

**A. Include them (recommended).**
- **For the team:** pressing Restore on a removed photo gives a clear "removed for good" message, rather than putting an empty picture back.
- **For spotters:** matching near that cat keeps working. Without change 2, it could fail for every spot nearby.
- **Why it's safe:** each change is small, has a test that fails without it, and is something November needs anyway.

**B. Change the database only.**
- **Risk:** the picture still couldn't leak, but people would see broken pages and failed matches.

**Recommendation: A.**

---

## 11. Found while mapping (filed or noted here, not fixed)

- **SYC-303 (already filed):** hidden photos that haven't been removed are still sent to the matcher. §6 change 2 fixes this only for removed photos.
- **SYC-276 (already filed):** copies already saved on phones.
- **SYC-246:** a comment with the backfill in §9. If Samuel picks D3 A, the same comment notes that report photos aren't covered.
- **SYC-44 PR 6.1:** a note that the "Photo hidden while Syros Cats take a look" tile needs different words for a removed photo.
- **Launch plan line 58:** "caches" is reworded to match §3.3 when the runbook lands.
- **The "Photo removals" ledger ticket** is created at the first real removal. Until then, the runbook names it.

---

## 12. What this PR will contain, once approved

- `lib/db/src/photoRemoval/`: the tool, its steps and the search, with tests T1 to T8 and T14.
- `scripts/db-ops.sh` and `.github/workflows/db-ops.yml`: four commands and five inputs.
- `lib/db/package.json`: a `photos` script.
- The §6 changes, with tests T9 to T13 and T15, in:
  - `api/lib/photoVisibility.ts`
  - `api/routes/teamPhotos.ts`
  - `api/routes/sightings.ts`
  - `api/lib/photoVariants.ts`
  - `api/routes/photos.ts`
- `docs/runbooks/photo-removal.md`, and the restore line in `docs/runbooks/neon-database.md`.

**Model delegation** comes in the plan.
