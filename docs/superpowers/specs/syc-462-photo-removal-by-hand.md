# Removing a photo by hand on a privacy request (SYC-462)

**Linear:** SYC-462. This blocks the launch on Saturday 31 October 2026.

**Related tickets:**
- SYC-246: the team's "Delete for good" button, mid-November
- SYC-478: report photos
- SYC-66: privacy policy
- SYC-44: Report an issue
- SYC-415: extra photos
- SYC-396 PR 1.2: small and medium versions
- SYC-279: caching
- SYC-303: hidden photos are still sent to the matcher
- SYC-276: copies already on phones

**Status:** revision 2. This is a draft for Samuel's approval, and nothing here is built yet.
- Samuel decided D1–D4 on 18 October 2026 (recorded on SYC-462; see §10). D1 chose **"Bring November's change forward"**, so this revision adds a database change. Revision 1 was written without one.
- The first adversarial review (`syc-462-photo-removal-by-hand-review.md`, 18 findings) is folded in. Its fixes carry over unless §13 says otherwise.
- A second review, of what changed in this revision, comes next.

**Checked against:** `origin/main` at `c1958d7a` (18 October 2026). Every claim about how things work today names the file it was read in.

**Launch plan rows:** `docs/superpowers/plans/mvp-launch-31-oct.md` lines 58, 211 and 264.

**For Samuel:** read §1, §2, §7, §10 and §11. The other sections are the engineering detail behind them, and you can skip them.

---

## 1. The short version

Someone writes to hello@catspotters.com: "there's a photo of my front door (or my child, or my number plate) on a cat's page, please take it off." Until the team has its own button in November (SYC-246), this is what happens.

1. **A person decides.** Samuel or someone on the Syros Cats team looks at the photo and agrees it shows a person or a private place.
2. **Claude hides it first.** Hiding takes the photo off every public page at once, and it can be undone. If the team has already hidden it from the dashboard, Claude just records that it was hidden for privacy. The photo is never shown again in between.
3. **Claude removes it for good.** That means:
   - the picture itself is deleted from the database;
   - so are its small and medium versions;
   - it stops being the cat's main photo;
   - it stops being used to recognise the cat.

   The photo's record stays, marked **removed**, with who removed it, when, and the request it answered. Removal can't be undone, so Claude has to type the photo's id twice, plus the word `REMOVE`.
4. **Claude checks it's gone.** The command searches the whole database for the picture and for any mention of it, and prints what it found. Claude then checks that the photo's web address answers "not found".
5. **The person gets a reply.** It says the photo is gone from the app and the website. It is honest about what we can't reach: a copy already saved on someone's phone, and backups. Backups clear after a time we look up for each request; we don't promise a number in advance.

Every command first **shows what it would do and changes nothing**. That's the dry run, and it's what happens unless Claude adds the confirmation word.

**What changes in the app.** The database gains a proper "removed" marker (a migration). Every part of the app that reads a photo's picture learns to treat a removed photo as gone. That's the database half of November's SYC-246, brought forward as Samuel decided. November then only has to add the team's button.

---

## 2. Who does what

| Step | Who | How |
|---|---|---|
| Request arrives | Anyone | An email to hello@catspotters.com (SYC-66), or a "Report an issue" report choosing "shows a person or something private" |
| Finding the photo | Claude, with the team | From the cat the person names, using the list command (§5.1) or the cat's page on the team dashboard |
| **Approving** | **Samuel, or someone on the Syros Cats team** | They confirm in writing (an email, or a Linear comment) that the photo shows a person or a private place. **Their judgement is the real safeguard.** A stranger's report only puts a photo forward; it never approves a removal. Claude never approves its own |
| Hiding, removing and checking | Claude | Through the existing database-commands workflow (§5). Before any change to the live database, Samuel switches the session to "ask" mode, as for every live database change |
| Replying to the person | Whoever looks after the inbox | Using the template in §7, once steps 9 and 10 are done |
| Keeping records | Claude | A ticket for each request, plus the **removal ledger** (§7). Both hold the photo's id, who approved, the dates and the workflow runs. **Never** the name, email or address of the person asking, because the code repository and its workflow logs are public |

**When removal is allowed** is unchanged from DECISIONS.md Decision 3 (14 October 2026): *"Delete for good" is for privacy only.* That means a photo showing a person or a private place. An offensive photo stays hidden, not removed. The remove command enforces this (§5.4).

**Removal is only switched on once the new app is live** (§4.6). Until then, a privacy request gets step 5 (hide) only. Hiding already takes the photo off every public page.

---

## 3. Every place a photo is kept today

All of this is read from the code on `origin/main`. Paths are relative to the repo root, and `api` means `artifacts/api-server/src`.

### 3.1 In the database

The picture itself is in **one column only**: `photos.data`, base64 text, `NOT NULL` (`lib/db/src/schema/photos.ts:36`). Everything else is either a smaller copy of it or a pointer to its row.

| # | Place | File:line | Link to `photos.id` | Locked? | What removal does |
|---|---|---|---|---|---|
| P1 | **The picture**: `photos.data` | `lib/db/src/schema/photos.ts:33-37` | is the row | no trigger | **`data = null`**, and the new `removed_*` fields are filled in (§4.1) |
| P2 | **Small and medium versions**: `photo_variants.bytes` | `lib/db/src/schema/photoVariants.ts:24-38`; `0028_photo_variants.sql` | FK, `ON DELETE CASCADE` (but the row isn't deleted, so this never fires) | no | **Delete** both rows. They can't be made again (§4.3) |
| P3 | **The cat's main photo**: `cats.primary_photo_id` | `lib/db/src/schema/cats.ts:28` | **no FK**; `NOT NULL`; `0` means "no photo" | no | **Repoint** it to the photo the public already sees in its place, or to `0` (§4.2) |
| P4 | **The sighting's cover photo**: `sightings.photo_id` | `lib/db/src/schema/sightings.ts:21` | **no FK**; `NOT NULL` | **yes**: `sightings_append_only` (`0013_deletion_unlinks_people.sql:21-79`) | **Left pointing** at the removed row. Readers treat it as gone (§4.5) |
| P5 | **Every photo of a spot** (first, face, body): `sighting_photos` | `lib/db/src/schema/sightingPhotos.ts:26-44` | FK, `CASCADE` | no | **Left in place**, so the spot keeps its shape |
| P6 | **Answers and coat readings**: `observations.photo_id` | `lib/db/src/schema/observations.ts:48` | **no FK** | **yes**: `observations_append_only` (`0001_data_spine_tables.sql:125`) | **Left pointing**. Holds no picture (`api/lib/coatReading/record.ts:92`) |
| P7 | **Reports about the photo**: `welfare_reports.photo_id` | `lib/db/src/schema/welfare.ts:96`; `0023_issue_reports.sql:16,20` | FK, `NO ACTION` | no | **Left pointing** |
| P8 | **The log of hides and restores**: `photo_visibility_events` | `lib/db/src/schema/photoVisibility.ts:34-57`; `0014_photo_visibility.sql` | FK, `NO ACTION` | **yes**: add-only | **Untouched** by removal. The hide for privacy (§5.2) is written here before removal |
| P9 | **A pointer made later**: resolving a waiting spot as a new cat copies its cover photo into the new cat's `primary_photo_id` | `api/routes/sightings.ts:769-775` | — | — | A removed cover photo gives the new cat `0` (§6) |
| — | Reporters' own photos: `welfare_report_photos.bytes` | `lib/db/src/schema/welfare.ts:173-191` | not a `photos` row | — | **Out of scope** (D3; SYC-478) |

**Checked and holding no photo, photo id or photo address:**
- `sighting_matches`;
- `notifications`, and push payloads (`api/routes/notifications.ts:138-147`, `api/lib/push.ts:12-19`);
- `mail_outbox.payload` and `mail_deliveries` (`api/lib/mail/outbox.ts:199,219-224`);
- `profiles`, `colonies`, `feeding_sites`, `mapping_events`, `person_events`, `app_settings` and `map_tile_cache`.

A photo's web address is built every time it's needed, never stored (`api/lib/photoVisibility.ts:64-69`, guarded by `photoVisibility.source.test.ts`). The search in §5.5 checks every column anyway.

**Why the row isn't deleted.** P7 and P8 block a `DELETE`, and P8 is add-only. The storage spec's contract is *"null the bytes and mark it removed"* (`docs/specs/hosting-and-photo-storage.md` §6.5), and that is what SYC-246's plan does: *"The row stays, so every link to it survives"* (`docs/superpowers/plans/syc-44-report-an-issue.md`, PR 7.2). This revision builds exactly that.

**Every place that reads the picture (`photos.data`) today.** I found these by searching for `photosTable.data` and for every whole-row `select()` from `photos`. Making `data` nullable means the type checker flags each one, and T13 stops a new one slipping in.

| # | Reader | File:line | After removal |
|---|---|---|---|
| R1 | Public photo address | `api/routes/photos.ts:46-58` | `404`, `no-store` (it's hidden already) |
| R2 | Team full-size photo | `api/routes/teamReports.ts:149,172-177` | `410` page: "Removed for good on <date>." `no-store` |
| R3 | Team small/medium versions | `api/routes/teamReports.ts:187-208` via `api/lib/photoVariants.ts:42-48` | `410`, and no version is made |
| R4 | Matching: the main photos of nearby cats | `api/routes/sightings.ts:279-286` | That cat is skipped (it isn't sent) |
| R5 | Matching: a repeat upload of the same spot | `api/routes/sightings.ts:560-579` | The removed photo is skipped in both reads, including the older single-photo fallback. If nothing's left, the existing "photo has gone" branch runs |
| R6 | "Photo hidden" email attachment | `api/lib/mail/outbox.ts:590-591` | No attachment. The email already says the bytes were deleted (`api/lib/issues/alertEmail.ts:93-95`) |
| R7 | Coat reader | `api/lib/coatReading/sweep.ts:211` | Skipped. It already never picks a hidden photo (`photoVisibility.ts:103`) |
| R8 | Spot insert | `api/lib/spotPhotos.ts:96` | A writer, not a reader. It always writes a picture |

Places that read only a photo's id, public id or type, never the picture, are unaffected. That's `likelyReview.ts:151`, `teamCatView.ts:592`, `capabilityTargets.ts:140`, `photoVisibility.ts:128`, `guardianCatView.ts:140`, `colourCheck.ts:113` and `routes/issues.ts:286`. Each still builds a team address for a removed photo, and that address answers `410`. T9 checks the team cat page shows the photo as removed rather than as a broken image.

### 3.2 Copies made while the photo was in use

| # | Place | What we can do |
|---|---|---|
| C1 | **Matching (OpenAI)**: today a cat's main photo is sent with every nearby spot, **hidden or not** (SYC-303), from `api/routes/sightings.ts:279-286` | R4, plus the repoint in P3, stops it being sent from the moment of removal. Anything the provider kept from earlier calls is outside our system and **unchecked**. We store no prompts, outputs or embeddings |
| C2 | Repeat upload | R5 |
| C3 | Coat reader | Never sends a hidden photo |
| C4 | **"Photo hidden" email with the photo attached** (only when a report hid it) | The inbox owner deletes it (runbook step 9). How long Resend keeps it: **unchecked** |
| C5 | Server logs: the public id appears in request paths (`api/app.ts:30-41`) | Nothing needed |
| C6 | **Screenshots** in the public repository (`docs/screenshots/`, `attached_assets/`, 384 images), pull requests and Linear | Runbook step 10 searches for them. A copy in git history can only be removed by rewriting history, so it goes to Samuel. From now on, screenshots use seeded test data |

### 3.3 Caches

| # | Place | Behaviour |
|---|---|---|
| K1 | **Public photo address** (`api/routes/photos.ts:44-69`) | A hidden, removed or unknown photo answers `404` with `no-store`. A shown photo is `private, max-age=31536000, immutable`. **Only that viewer's own browser or phone keeps it**, for up to a year. No shared cache may keep it (DECISIONS.md Decision 1; SYC-279) |
| K2/K3 | Team photo and version addresses (`api/routes/teamReports.ts`) | `no-store` and `private, no-cache`. Both answer `410` once a photo is removed |
| K4 | The app's saved cat list (`artifacts/cat-spotter/lib/catalogue.ts:17`) | Holds addresses, not pictures. The next fetch gets `404` |
| K5 | **The image store in the app and browser** (`expo-image`, HTTP cache) | **A phone that already showed the photo may keep it** until its cache clears. The server can't reach it (SYC-276). The reply says so |
| K6 | The spotter's own offline upload queue (`artifacts/cat-spotter/lib/pendingPhotos.ts:23`) | Their own photo on their own phone. Not ours to reach |

Launch plan line 58 says the command removes "caches". It removes every copy in the database and stops the photo's addresses answering. It can't empty a phone's cache. The plan's wording is corrected when the runbook lands.

### 3.4 Backups and whole-database copies

From `docs/runbooks/neon-database.md` and the Neon switchover plan. **Which of these exist right now is unchecked.** Runbook step 10 lists them read-only each time.

| Copy | Kept for | What happens |
|---|---|---|
| Neon `production` point-in-time history | 7 days according to `neon-database.md:172`. The live setting is **unchecked**, and step 10 reads it | Ages out |
| Neon `development` branch (a copy of real data) | Until it's reset | The same removal is run there, or it's reset from `production` afterwards (step 8) |
| `rehearsal`; the archive branches `replit-final-<date>`, `pre-restore-*` and `production (old)`; named snapshots | Until someone deletes them | Listed on the ticket with their deletion date, for Samuel to decide |
| Old Replit databases | Cutover + 30 days | Listed |
| Encrypted dumps (a GitHub artifact, and Samuel's own) | 7 days for the artifact; Samuel's is his own | Listed |

**A restore brings removed photos back.** Any of these brings back the database as it was at that moment:
- a snapshot swap;
- using a point-in-time restore;
- a carry-back;
- resetting `development` from `production`.

So every removal goes on the **removal ledger** (§7). After any of these, the runbook re-runs `photo-remove` for every ledger entry newer than the restore point. A line saying so is added to the restore section of `neon-database.md`.

---

## 4. The database change, and what "removed" means

### 4.1 Migration `0033_photo_removal` (number provisional)

`0032` is claimed by PR #239 (SYC-45). The number is agreed with every live session before the file is written (§12).

In `lib/db/src/schema/photos.ts`, so `migrate:check` passes:
- `data` loses `.notNull()`;
- three new columns, all nullable:
  - `removed_at`, `timestamptz`;
  - `removed_by`, `uuid`, references `people.id` with no cascade (people are never deleted: Decision 7);
  - `removed_reason`, `text`;
- one check, `photos_removed_ck`, which says either:
  - `removed_at`, `removed_by` and `removed_reason` are all null and `data` is not null; or
  - all three are set and `data` is null.

  So **a photo has no picture exactly when it is marked removed**, with who and why. The database itself enforces this.

**The migration doesn't rewrite any row.** Every existing photo has a picture and no `removed_*`, so it already passes the check. It's an additive change plus one relaxed rule, which is safe for the app that's running now (§4.6).

**Rollback** (commented, as the migrations README requires). Drop the check and the three columns, then set `data` back to `NOT NULL`. That last step fails if any photo has been removed. The rollback block says in capitals: **A REMOVED PHOTO'S BYTES CANNOT BE BROUGHT BACK. IF ANY PHOTO IS REMOVED, THIS ROLLBACK FAILS ON PURPOSE. SHIP A FIX FORWARD INSTEAD.**

### 4.2 The cat stops using it

Each cat whose `primary_photo_id` is the photo is pointed at **the photo the public already sees in its place**:
- the newest cover photo of one of that cat's resolved sightings that is neither hidden nor removed;
- newest first, by `created_at` then `id`;
- the same rule as `displayPhotoRows` (`api/lib/photoVisibility.ts:119-162`).

If there isn't one, it's set to `0`, "no photo", and the placeholder shows.

- **The public page looks the same before and after**, because a hidden main photo already shows that stand-in.
- **`0` is safe everywhere it's read:**
  - `displayPhotoRows` filters `> 0` (`:124`);
  - matching selects nothing for it;
  - `coatReading/due.ts:161` and `guardianCatView.ts:131` guard it.
- **The rule exists in two places**, here and in the app. A parity test (T14) keeps them the same.
- **Accepted side effect.** The coat reader may read the stand-in once, with the label `main_restored` (`coatReading/due.ts:161-183`). It's already public, so this is harmless.

### 4.3 The small and medium versions are deleted, and can't come back

`delete from photo_variants where photo_id = $1`.

`variantFor` (`api/lib/photoVariants.ts:35-53`) reads a photo's picture without a lock. With `data` now nullable, it returns `null` for a removed photo when it reads. It also checks again just before saving, so a version can't be saved for a removal that happened in between. After the commit, the search (§5.5) checks twice, two seconds apart, and deletes any version it finds.

### 4.4 The removal is one write, and it is the record

In **one transaction**, holding the same lock on the photo's row that hiding takes (`select … for update`, as in `api/lib/photoVisibility.ts:227-229`):

1. Check the rules (§5.4) again.
2. `update photos set data = null, removed_at = now(), removed_by = <approver>, removed_reason = <ref> where id = $1 and removed_at is null`.
3. Delete its versions (§4.3).
4. Repoint any cat using it (§4.2).

`removed_at`, `removed_by` and `removed_reason` answer "who removed this, when, and for which request?" That's the storage spec's *"Removal is recorded — who, when, why"* (§6.5). Nothing is added to the hide/restore log. The photo is already hidden for privacy, and stays hidden.

The GitHub account that ran the workflow goes on the ledger, with the run link.

**One implementation.** These steps live in `lib/db/src/photoRemoval/remove.ts`. Today's command calls it. SYC-246's November button calls the same function, so there's never a second way to remove a photo.

### 4.5 Everything else stays

P4 to P8 keep pointing at the row. The row now holds no picture, is marked removed, and stays hidden. Every public reader already treats a hidden photo as having no address (`photoUrl: null`; `api/routes/cats.ts:239`, `api/lib/photoVisibility.ts:64`). `catDisplayPhotos` additionally skips removed photos, as a second guard (§6).

The tile text "Photo hidden while Syros Cats take a look" belongs to SYC-44 PR 6.1, which isn't on `main` yet, and it's wrong for a removed photo. A note to that effect is on SYC-44.

### 4.6 The order things go live

1. **Migrate `development`, then `production`.** The migration is safe for the app that's running now. No photo has `data = null` until someone removes one, and nothing in the old code reads the new columns.
2. **Publish the app that understands "removed".**
3. **Only then can anyone remove a photo.**

The old app would crash (`Buffer.from(null)`) on the team photo routes and in the email worker for a removed photo, and would send it to the matcher. So `photo-remove` refuses to run on `production` until a setting, `photo_removal_on`, is `true`. The runbook sets that setting after it has checked that the live build (`/api/healthz` commit) includes this PR. The setting uses the existing settings store (`app_settings`; `lib/db/src/appSettings/cli.ts`). Hiding works throughout.

---

## 5. The commands

Four new `db-ops` commands, run by `.github/workflows/db-ops.yml` from `main`, against `target` = `development` or `production` (never `rehearsal`), exactly like the `people-*` commands (`scripts/db-ops.sh:491-498`). Behind them is one small tool, `lib/db/src/photoRemoval/cli.ts`. It's built like `lib/db/src/people/cli.ts` and keeps its rules:
- `--target` is required and must equal `DATABASE_TARGET`;
- the database address comes only from the target's own variable;
- no database address, host or connection string is ever printed.

**Everything these commands print is public** (the repository is public). So output never includes:
- a location, a device id, a person's name or any note text;
- a report's reason or a hide's reason.

It prints photo ids, cat numbers, dates and yes/no answers.

**One run at a time.** The workflow's `concurrency` group keeps one waiting run, so the runbook runs each step only after the last one has finished.

**New workflow inputs** (15 in total). GitHub's limit is confirmed with actionlint and a real dispatch while building. The reviewer believes it's 25, which is **unchecked**.

| Input | Used by | Notes |
|---|---|---|
| `photo_id` | all but `photo-list` | The photo's public id |
| `photo_id_confirm` | `photo-remove` | The same id, typed again |
| `photo_cat` | `photo-list` | The cat's number |
| `photo_by` | `photo-hide`, `photo-restore`, `photo-remove` | The approving team member's people id (from `people-list`) |
| `photo_ref` | `photo-remove` | **Only** `SYC-<number>` or `hello YYYY-MM-DD #<n>` (pattern `^(SYC-[0-9]{1,5}\|hello [0-9]{4}-[0-9]{2}-[0-9]{2} #[0-9]{1,3})$`). This way a name, a phone number or a street can never reach the public log. It's stored as `removed_reason` |
| `confirm` (already exists) | `HIDE`, `RESTORE` or `REMOVE` | Without it, a command only shows what it would do |

**Who counts as a team member** for `photo_by` is someone on the list now:
- they joined (`accepted_at` set);
- they haven't left;
- they hold the `staff` or `management` role, and it's in force (not expired).

That's the people store's own "on the list now" query (`lib/db/src/people.ts`), reused rather than written again. Those two roles hold `hide_photo`, `restore_photo` and `remove_photo` in the app (`api/lib/capabilities.ts:41,90-92`; `docs/specs/roles-and-invites.md:301`).

### 5.1 `photo-list` (read-only)

Every photo of one cat, newest first. For each:
- its full public id;
- where it's used: main photo, or sighting number and role;
- the date taken;
- `hidden`, `hidden for privacy` and `removed` (with date), each yes or no.

### 5.2 `photo-hide` (a dry run unless `confirm=HIDE`)

- **Not hidden:** adds a `hide` event with `reason = 'privacy'`, authored by `photo_by`. That's the same reason November's "for privacy" tick will store.
- **Already hidden** (for example from the dashboard, whose Hide button records no reason; `api/lib/teamPages/catPages.ts:414-424`): adds a **second** `hide` event with `reason = 'privacy'`. The photo is never shown in between. The log's rules allow two hides in a row.
- **Already hidden for privacy, or removed:** writes nothing, says "already", and succeeds.

**Undo:** `photo-restore`, or **Restore** on the team dashboard.

### 5.3 `photo-restore` (a dry run unless `confirm=RESTORE`)

The undo for a hide. The same check on `photo_by`. Refused for a removed photo.

**Warning, repeated in the runbook:** after a restore, a later public report no longer hides that photo automatically (`api/lib/issues/hide.ts:187-192`). So restore only a hide that was a mistake.

### 5.4 `photo-remove` (a dry run unless `confirm=REMOVE` and `photo_id_confirm` equals `photo_id`)

It refuses, and changes nothing, unless **all** of these hold. They're checked again inside the transaction, under the lock.

0. On `production`, the setting `photo_removal_on` is `true` (§4.6).
1. The photo exists.
2. It's **hidden now**: its newest event is a `hide`.
3. It was **hidden for privacy** (Decision 3), in one of two ways:
   - a `hide` event with `reason = 'privacy'` exactly (case-sensitive), with no `restore` after it; or
   - a report with reason `photo_private` names it.
4. `photo_by` is on the team now (§5).
5. `photo_ref` is in one of the two allowed forms.

**Already removed:** it says "already removed on <date>", writes nothing and succeeds. Running it twice is safe.

**The dry run prints** the plan, and the search (§5.5) as things stand:

```
photo-remove (DRY RUN: nothing changed) target=development photo=3f2c9a1e-…-e91a
  hidden now: yes · hidden for privacy: yes · removal switched on: yes
  picture:            41,233 bytes → would be deleted
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

The search runs **after the commit, read-only, with no lock held**, has a 120-second statement timeout, and prints how long it took. It prints one line for each check:

1. `photos.data` is null, and `removed_at`, `removed_by` and `removed_reason` are set.
2. `photo_variants` has no rows for it. This is checked twice, two seconds apart, and any rows found are deleted and reported.
3. No `cats.primary_photo_id` points at it.
4. Its newest visibility event is a `hide`.
5. **The picture's bytes appear nowhere else.** Before deleting the picture, the command takes a fingerprint of it: a 64-character slice of its base64 text, and the same bytes decoded. It then scans **every** text, `varchar`, `json`, `jsonb`, array and `bytea` column of **every** table in `public` (the same "every column" approach as `api/routes/me.delete.test.ts:324-346`). It also checks there's no other column type it would miss.
   - The assumption, stated: pictures are stored as one unbroken line of base64 (`api/lib/spotPhotos.ts:~92`), so a whole copy keeps the same slice.
   - **The same picture under another id** (a race can save one spot twice; `api/routes/sightings.ts:~533-541`): the search names that row. The runbook treats it as its own request, with its own approval.
6. **No other mention of it.** Every text, `json`, `jsonb` and array column is scanned for the photo's public id, except `photos.public_id`.

It ends `GONE` only if all six pass. Otherwise it ends `NOT GONE: <checks>` with a non-zero exit, and the run goes red.

### 5.6 Checks from outside (runbook)

- `curl -sI https://<live host>/api/photos/<photo_id>` answers `404` with `no-store`.
- `GET /api/cats/<cat>` contains `<photo_id>` nowhere.

---

## 6. The changes in the app

All the readers in §3.1 (R1–R7). Most of these are November's T7-7 rows, built early.

1. **`photos.data` is nullable.** Every reader handles a removed photo as in §3.1's table, and none of them returns a 500.
2. **Restore is refused for a removed photo.**
   - `setPhotoVisibility` (`api/lib/photoVisibility.ts:221`) gets a new result, `removed`.
   - The dashboard route (`api/routes/teamPhotos.ts:68-111`), which today has no branch for unknown results, gets one: JSON `409` `{code: "REMOVED"}`, or a short page saying "This photo was removed for good on <date>. It can't be restored."
   - The Restore button on the cat page lives in `teamPages/`, which is being edited by another session. It isn't touched now; SYC-246 replaces it in November.
3. **Matching never sends a removed photo**, in either R4 or R5.
4. **A new cat never gets a removed photo as its main photo** (P9). It gets `0`.
5. **Versions are never made from a removed photo** (R3, §4.3).
6. **`catDisplayPhotos` skips removed photos**, so the public page never builds an address for one, even if it somehow became visible.
7. **The team photo routes answer `410`** for a removed photo (R2, R3), so the team's cat page shows "removed" rather than a broken image.

---

## 7. The runbook (`docs/runbooks/photo-removal.md`, written in this PR)

**Once, at go-live:**
- After the migration and the publish, check that `/api/healthz` shows a commit that includes this PR.
- Then set `photo_removal_on` to `true` on `production` with `set-setting`.
- Until that's done, a request gets steps 1–5 only.

**For each request:**

1. **Log it** as an SYC ticket: the date, how it arrived, the cat's number and which photo. Nothing about the person asking.
2. **Find the photo**: `photo-list` with the cat's number on `production` (read-only).
3. **Get approval** from Samuel or the Syros Cats team, quoting the photo's id and what it shows. Record it on the ticket.
4. **Heads-up to Samuel** that a live database change is next, and ask him to switch to "ask" mode.
5. **Hide**: `photo-hide`, dry run first, then `confirm=HIDE`. *Undo: `photo-restore`. Read the warning in §5.3 first.*
6. **Remove**: `photo-remove`, dry run first. Read the plan, then run it with `confirm=REMOVE` and the id typed twice. Expect `GONE`. If the search names another photo id with the same picture, go back to step 3 for that id.
7. **Check from outside**: §5.6.
8. **The development copy**: run steps 5 and 6 there, or reset it from `production` after the removal.
9. **The team inbox**: if a report hid the photo, ask whoever looks after the inbox to delete the "Photo hidden" email, which has the photo attached. Wait for them to confirm.
10. **Other copies**:
    - list the Neon branches and snapshots, and the restore window on `production` (read-only), and note on the ticket any copy older than the removal, with its deletion date;
    - search the repository, pull requests and Linear attachments for the photo's id and for screenshots of that cat.
11. **The ledger**: add one row to the "Photo removals" Linear ticket. It holds:
    - the photo's id;
    - the date;
    - the request ticket;
    - who approved;
    - the run links;
    - the GitHub account that ran it.
12. **Reply** (only after steps 9 and 10):
    > "We've removed the photo from Cat Spotters. It no longer appears anywhere in the app or on the website, and we've deleted it from our live database [and from our team's inbox]. If your phone or browser had already shown it, a copy may stay there until its cache clears; that's on your device, and we can't reach it. Our backups still hold it for up to [N] days, after which it's gone from them too."

    **N** is the longest-lived copy found in step 10. It's never an assumed figure. If a copy has no known deletion date, the reply waits for Samuel.
13. **Close the ticket** with the run links.

**After any restore** (a snapshot swap, using a point-in-time restore, a carry-back, or resetting `development` from `production`), re-run step 6 for every ledger row newer than the restore point.

**If a step fails:**
- Before step 6: restore the photo and start again.
- If step 6 ends `NOT GONE`: stop and raise it on the ticket. Don't retry blindly.

---

## 8. Test plan

Every test runs against a **throwaway local Postgres** with the real migrations and triggers (`lib/db/src/migrate/testDatabase.ts`, which refuses a `.neon.tech` host). No test touches Neon.

### 8.1 The migration

- **T0.** The usual migration checks pass: `migrate:check`, and the rollback restores the previous schema on a database with no removed photos. A rollback on a database **with** a removed photo fails.
- **T0b.** The check `photos_removed_ck` refuses all of these:
  - `data = null` without `removed_*`;
  - `removed_at` set while `data` still holds a picture;
  - `removed_at` set without `removed_by` or without `removed_reason`;
  - `removed_by` naming no person.

### 8.2 The full search test (the one the launch plan names)

**T1. Remove one photo from every place it's kept.**

Seed photo **P**, with a recognisable picture, in **every** place in §3.1:
- a cat's main photo;
- one sighting's cover and `first` photo;
- another sighting's `face` photo;
- small and medium versions;
- an observation;
- a `photo_private` report;
- a privacy hide.

Seed control photo **Q** in the same places for another cat. Run `photo-remove` for real, then assert:
- the search says `GONE`;
- **a separate scan, written in the test independently of the command,** finds P's bytes and P's public id in no column of any table, and no version rows;
- no cat points at P, and that cat now points at its stand-in;
- **Q is untouched**: the same bytes, versions and main photo.

**T2. Skip one step and T1 goes red.** The removal is written as named steps:
- delete and record (P1, one statement, because the check forces both together);
- versions (P2);
- main photo (P3).

A test-only option skips one step. A parameterised test runs T1 once for each skipped step and expects `NOT GONE`, naming the check that should catch it:

| Step skipped | Check that must fail |
|---|---|
| delete and record | 1 and 5 |
| versions | 2 |
| main photo | 3 |

**T2b.** A version saved between the commit and the check is caught and deleted.

Each red is also confirmed by hand once, as a mutation probe recorded in the PR.

**T3. A new photo link turns the catalogue test red.** It reads from the database itself:
- every foreign key to `photos`;
- every column named `photo_id` or `*_photo_id`;
- every `bytea`, `json` and `jsonb` column.

It compares them with the reviewed list here. A column added later turns it red until someone decides how removal treats it.

### 8.3 Refusals and safety

**T4.** Each of these is refused, and a before-and-after checksum shows nothing changed:
- the photo isn't hidden;
- it's hidden only because a report called it offensive (`photo_inappropriate`);
- it's hidden with no privacy reason;
- it had a privacy hide, then a restore, then a plain hide;
- unknown id;
- `photo_id_confirm` is different;
- no `confirm`;
- a `photo_ref` with a name, digits, an `@` or mixed text;
- `photo_by` never joined, has left, has an expired role, or is only a cat guardian;
- the target doesn't match;
- on `production` while `photo_removal_on` is off.

**T4 also has success cases:**
- hidden from the dashboard with no reason, then `photo-hide` for privacy, then removed;
- hidden by a `photo_private` report, then removed directly.

**T5.** A second `photo-remove` prints "already removed", writes nothing and exits 0.

**T6.** Hide, then restore (the undo), leaves the photo exactly as it was. `photo-restore` after a removal is refused.

**T7.** No output contains:
- a connection string;
- a device id;
- coordinates;
- any note text;
- any reason text.

**T8.** Two removals at once: one writes, the other says "already removed".

### 8.4 In the app (api-server tests)

- **T9.** After a removal:
  - the public address answers `404` with `no-store`;
  - both team addresses answer `410` with `no-store`;
  - the team cat page shows the photo as removed, with no broken image;
  - the cat's public page shows the same stand-in and doesn't contain P's id;
  - the sighting payload has `photoUrl: null`.
- **T10.** Restore through the dashboard route, JSON and form, is refused with `REMOVED`.
- **T11.** A repeat upload of a spot whose photo was removed returns the spot without calling the matcher. Two cases: with `sighting_photos` rows, and with only the older `sightings.photo_id` fallback.
- **T12.** Matching for a new spot near the cat doesn't send P (the mock records what it was given).
- **T12b.** Resolving as a new cat a spot whose cover photo was removed gives the new cat main photo `0`.
- **T13.** A source test fails if `photosTable.data`, or a whole-row `select()` from `photos`, appears in a file outside R1–R8 (as in SYC-246's T7-8).
- **T14.** Parity: for several cats, the `lib/db` repoint picks the same photo `catDisplayPhotos` shows. The cases:
  - several candidates;
  - one candidate hidden;
  - one candidate removed;
  - a tie on `created_at`;
  - none at all.
- **T15.** `variantFor` on a removed photo returns `null` and saves nothing. That includes a removal that lands between its read and its save.
- **T16.** The "Photo hidden" email for a removed photo is sent without an attachment, and the coat reader skips the photo.

**Mutation probes**, each recorded in the PR. Remove one of these and the named test goes red:
- the restore check (T10);
- either matching skip (T11, T12);
- the new-cat guard (T12b);
- the `variantFor` guard (T15).

### 8.5 The rehearsal (D2: full rehearsal)

1. **Before the PR is marked ready:** run `scripts/db-ops.sh` itself against a **local scratch database**. Use `TARGET=development`, `DATABASE_TARGET=development`, and `NEON_DEV_URL` pointing at the scratch database. Seed it as in T1, then run:
   - list;
   - hide (dry run, then for real);
   - restore;
   - hide;
   - remove (dry run, then for real);
   - remove again.

   Paste the output into the PR.
2. **After merge, on the Neon `development` branch**, through the workflow. Claude gives Samuel a heads-up first, because it writes to a Neon branch.
   - Migrate `development`.
   - On one real photo: list, hide, restore, hide, remove, check.

   This is the launch checklist's "the runbook's dry run passed on the development database" (plan line 211).

---

## 9. How this fits November's button (SYC-246)

**This PR delivers the database half of SYC-246's PR 7.2**, as Samuel decided:
- the migration (§4.1);
- every reader handling a removed photo, which is its T7-7 rows;
- the source test (T7-8);
- the concurrency test (T7-10);
- the removal function itself (§4.4), in `lib/db`.

The eligibility rule (Decision 3) and the privacy reason (`'privacy'`, exactly) are November's own.

**What November still adds:**
- the "for privacy" tick on the team's Hide form;
- the **Delete for good** button and its confirmation page, calling the same `lib/db` function, with the `remove_photo` power;
- the Restore button's "removed" state in `teamPages/`.

SYC-246's earlier backfill comment is withdrawn (a comment of 18 Oct). There's no backfill, because hand removals already use the final fields.

**What changes in November's plan.** SYC-246's PR 7.2 shrinks to the button and the tick. That's noted on SYC-246.

---

## 10. Decisions (Samuel, 18 October 2026, all recorded on SYC-462)

| | Question | Decision |
|---|---|---|
| D1 | How a photo is removed | **Bring November's change forward**: proper "removed" fields now, and the picture deleted |
| D2 | How far the rehearsal on the development copy goes | **Full rehearsal**: hide, restore, hide, remove, check (§8.5) |
| D3 | Photos sent with cat-in-trouble reports | **Not at launch**: SYC-478, mid-November |
| D4 | The small safety changes in the app | **Settled by D1**: required (§6) |

---

## 11. What D1 costs, in plain terms (for Samuel to know before approving)

- **More to build.** The PR now changes the database and eight places in the app that read photos. With revision 1 it was one tool and five small changes. **Estimate: about a day more of building and testing** (unchecked; the plan will say).
- **A database change in launch week.** It's the safe kind: it adds fields and relaxes one rule, and rewrites no existing data. It still needs a migration number agreed with the other sessions, a slot in a publish, and Samuel's "ask" mode for the live run.
- **Removal only works after that publish.** Until the new app is live, a privacy request gets the hide, which already takes the photo off every public page, and the removal follows once the app is live (§4.6). If the publish slips past 31 October, launch still has the hide.
- **What it buys.** There's one way to remove a photo, now and in November. The record is in proper fields that the database checks itself, and November's work shrinks.

---

## 12. Before building

- **The migration number.** `0032` is claimed by PR #239. Message every live session on this repo (re-listed first), agree `0033` or the next free number, and write it on SYC-462.
- **Files other sessions own:**
  - `api/routes/sightings.ts` (matching): check for in-flight work in it before editing;
  - `teamPages/` is untouched;
  - `db-ops.yml`: other commands may be in flight (the `set-setting` keys); agree the order with that session.
- **The switchover tools** (`lib/db/src/switchover/`) copy tables between databases by column. Whether they need the three new columns listed is **unchecked**; the plan checks.

## 13. What this PR will contain, once approved

- `lib/db/migrations/0033_photo_removal.sql` (number provisional) and the `photos.ts` schema change.
- `lib/db/src/photoRemoval/`: the remove function, the command, and the search, with tests T0–T8 and T14.
- `scripts/db-ops.sh` and `.github/workflows/db-ops.yml`: four commands, five inputs, and the `photo_removal_on` setting key.
- `lib/db/package.json`: a `photos` script.
- The app changes in §6, with T9–T13, T15 and T16:
  - `routes/photos.ts`;
  - `routes/teamReports.ts`;
  - `routes/teamPhotos.ts`;
  - `routes/sightings.ts`;
  - `lib/photoVisibility.ts`;
  - `lib/photoVariants.ts`;
  - `lib/mail/outbox.ts`;
  - `lib/coatReading/sweep.ts`.
- `docs/runbooks/photo-removal.md`, the restore line in `docs/runbooks/neon-database.md`, and the line 58 wording in the launch plan.

**Model delegation** comes in the plan.

**What changed from revision 1, for the first review's findings.** Everything carries over except these:

| Finding | Revision 1 | Revision 2 |
|---|---|---|
| 1 | A marker in `mime` | A null `data` with the new fields |
| 5 | A `removed:` hide event | The record is the `removed_*` fields: one statement, enforced by the check |
| 11 | The race guard | Keyed on `data` being null |
| 17 | The `mime` backfill | No backfill needed |
