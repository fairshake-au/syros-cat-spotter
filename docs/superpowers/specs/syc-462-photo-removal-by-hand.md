# Removing a photo by hand on a privacy request (SYC-462)

**Linear:** SYC-462 (launch-blocking for Saturday 31 October 2026). Related: SYC-246 (the team's "Delete for good" button, mid-November), SYC-66 (privacy policy), SYC-44 (Report an issue), SYC-415 (extra photos), SYC-396 PR 1.2 (small and medium versions), SYC-279 (photo caching).
**Status:** draft for Samuel's approval. Nothing here is built.
**Checked against:** `origin/main` at `bdffc3c3` (18 October 2026). Every "today" claim below names the file it was read in.
**Launch plan rows:** `docs/superpowers/plans/mvp-launch-31-oct.md` lines 58, 211 and 264.

---

## 1. The short version

Someone writes to hello@catspotters.com: "there's a photo of my front door (or my child, or my number plate) on a cat's page, please take it off." Until the team's own button arrives in November (SYC-246), this is what happens.

1. **A person decides.** Samuel or a Syros Cats team member looks at the photo and agrees it shows a person or a private place.
2. **Claude hides it first.** One command, run through the existing `db-ops` workflow, takes the photo off every public place at once. This step can be undone.
3. **Claude then removes it for good.** A second command wipes the picture itself and every copy the system made of it: the small and medium versions, and its place as the cat's main photo and as a matching reference. This step can't be undone, so it needs the photo's id typed twice and the word `REMOVE`.
4. **Claude checks it's gone.** The command searches the whole database for the picture and prints what it found. Claude then checks the photo's web address answers "not found".
5. **The person gets a reply** saying it's done, and honestly what we can't reach (a copy already saved on someone's phone, and backups that age out within 7 days).

Both commands **only show what they would do** unless they're given the confirmation. That's the dry run, and it's the default.

**No database change (migration) is needed.** The removed photo keeps its database row, with the picture wiped and a "removed" marker set, so nothing that points at it breaks. November's button (SYC-246) can take these rows over as they are (§9).

---

## 2. Who does what

| Step | Who | How |
|---|---|---|
| Request arrives | Anyone | Email to hello@catspotters.com (SYC-66), or a "Report an issue" report with the reason "shows a person or something private" (`photo_private`, SYC-44) |
| Finding the photo | Claude, with the team | From the cat the person names: the `photo-list` command (§5.1), or the team dashboard's cat page |
| **Approving** | **Samuel, or a Syros Cats team member** (team or management) | They confirm, in writing (an email or a Linear comment), that the photo shows a person or a private place. Claude never approves its own removal |
| Hide, remove, check | Claude | The `db-ops` workflow (§5). For `production`, Samuel first switches the session to "ask" mode, as for every production write (memory: Neon writes need ask mode) |
| Reply to the person | Whoever owns the inbox | A short template in the runbook (§7) |
| Ticket | Claude | A Linear comment on a per-request SYC ticket: photo id, approver, dates. **No name, email or address of the person asking**, because the repo and its workflow logs are public |

**The rule for when removal is allowed** is DECISIONS.md's Decision 3 of 14 October 2026, unchanged: *"Delete for good" is for privacy only.* That means a photo that shows a person or a private place. An offensive photo stays hidden, not removed. The `photo-remove` command enforces this (§5.4).

---

## 3. Every place a photo is kept today

Read from the code on `origin/main` (`bdffc3c3`). Paths are relative to the repo root. `api` means `artifacts/api-server/src`.

### 3.1 In the database

The picture itself lives in **one column only**: `photos.data`, base64 text, `NOT NULL` (`lib/db/src/schema/photos.ts:36`). Everything else is either a smaller copy or a pointer.

| # | Place | File:line | Link to `photos.id` | Locked against change? | What removal does |
|---|---|---|---|---|---|
| P1 | **The picture**: `photos.data` (with `mime` and `public_id`) | `lib/db/src/schema/photos.ts:33-37` | is the row | no trigger | **Wipe**: `data = ''`, `mime = 'application/x-removed'` (§4) |
| P2 | **Small and medium versions**: `photo_variants.bytes` | `lib/db/src/schema/photoVariants.ts:24-38`; `lib/db/migrations/0028_photo_variants.sql` | FK, `ON DELETE CASCADE` | no | **Delete** both rows. They're made again on demand (`api/lib/photoVariants.ts:35`), but not from a wiped picture (§4.3) |
| P3 | **The cat's main photo**: `cats.primary_photo_id` | `lib/db/src/schema/cats.ts:28` | **no FK**, `NOT NULL`, `0` means "no photo" | no | **Repoint** to the photo the public already sees in its place, or `0` if there isn't one (§4.2). This is what takes it out of matching |
| P4 | **The sighting's cover photo**: `sightings.photo_id` | `lib/db/src/schema/sightings.ts:21` | **no FK**, `NOT NULL` | **yes**: `sightings_append_only` (`lib/db/migrations/0013_deletion_unlinks_people.sql:21-79`) refuses changing it | **Left pointing** at the wiped row. Every reader already treats a hidden photo as "photo hidden" |
| P5 | **Every photo of a spot** (first, face, body; SYC-415): `sighting_photos` | `lib/db/src/schema/sightingPhotos.ts:26-44`; `0029_sighting_photos.sql` | FK, `CASCADE` | no | **Left in place**, pointing at the wiped row, so the spot keeps its shape ("photo hidden" in its slot) |
| P6 | **Answers and coat readings made from the photo**: `observations.photo_id` | `lib/db/src/schema/observations.ts:48` | **no FK**, nullable | **yes**: `observations_append_only` (`0001_data_spine_tables.sql:125`) | **Left pointing**. Holds no picture: `suggested_value` is the model's colour answer only (`api/lib/coatReading/record.ts:92`) |
| P7 | **Reports about the photo**: `welfare_reports.photo_id` | `lib/db/src/schema/welfare.ts:96`; `0023_issue_reports.sql:16,20` | FK, `NO ACTION`; a check requires it for the `photo_*` reasons | no | **Left pointing**. This link and P8 are why the row can't simply be deleted |
| P8 | **The hide and restore log**: `photo_visibility_events` | `lib/db/src/schema/photoVisibility.ts:34-57`; `0014_photo_visibility.sql:13,23-25` | FK, `NO ACTION` | **yes**: append-only, and refuses truncate | **One new `hide` row** records the removal: who, when, why (§4.4) |
| — | Reporter's own photos: `welfare_report_photos.bytes` | `lib/db/src/schema/welfare.ts:173-191` | **not** a `photos` row | no | **Out of scope** (§10, decision D3). Team-only, never public |

**Checked and holding no photo, its id or its address:** `sighting_matches` (cat ids and scores only, `lib/db/src/schema/sightingMatches.ts`), `notifications` and push payloads (addresses are built when read, `api/routes/notifications.ts:138-147`, `api/lib/push.ts:12-19`), `mail_outbox.payload` and `mail_deliveries` (`api/lib/mail/outbox.ts:199,219-224`), `profiles`, `colonies`, `feeding_sites`, `mapping_events`, `person_events`, `app_settings` and `map_tile_cache`. The photo's web address is never stored. It's built each time in one function (`api/lib/photoVisibility.ts:64-69`), and `api/lib/photoVisibility.source.test.ts` keeps it that way.

**Why the row can't just be deleted.** Two links block a `DELETE`: the append-only log (P8) and reports (P7). Getting round them means switching off a safety trigger in production and losing the record of who hid the photo. The approved storage spec already allows the alternative: *"delete the row, or null the bytes and mark it removed"* (`docs/specs/hosting-and-photo-storage.md` §6.5). November's design does the same: *"The row stays, so every link to it survives"* (`docs/superpowers/plans/syc-44-report-an-issue.md`, PR 7.2).

### 3.2 Copies made while the photo was used

| # | Place | File:line | What we can do |
|---|---|---|---|
| C1 | **Matching (OpenAI)**: a cat's main photo is sent with every nearby spot, **and today that includes a hidden main photo** (no hidden check on the read) | `api/routes/sightings.ts:276-289` | P3's repoint stops it being sent from the moment of removal. Whatever the provider kept from earlier calls is outside the system. We store no prompts, outputs or embeddings (only `sighting_matches`). The general "hidden photos are still sent" gap is filed separately (§11) |
| C2 | **A repeat upload of the same spot** re-reads that spot's photos and sends them again | `api/routes/sightings.ts:556-601` | Must skip a wiped photo (§6, change 2) |
| C3 | **Coat reader**: sends the cat's display photo, never a hidden one | `api/lib/photoVisibility.ts:103`; `api/lib/coatReading/sweep.ts:203` | Nothing needed: a hidden photo is never sent |
| C4 | **"Photo hidden" email** to the team inbox, **with the photo attached** (only when a report hid it) | `api/lib/mail/outbox.ts:568-603`; `api/lib/issues/alertEmail.ts:137-146` | Ask the inbox owner to delete that email (runbook step 9). Resend's own retention: **unchecked** |
| C5 | **Server logs**: the photo's public id in request paths, never the picture | `api/app.ts:30-41`; `api/lib/logger.ts:82-98` | Nothing needed. An id of a removed photo leads nowhere |

### 3.3 Caches

| # | Place | File:line | Behaviour |
|---|---|---|---|
| K1 | **Public photo address** `GET /api/photos/:publicId` | `api/routes/photos.ts:44-69` | A hidden or unknown photo answers `404` with `Cache-Control: no-store`. A shown photo is sent as `private, max-age=31536000, immutable`: **only that viewer's own browser or phone keeps it**, for up to a year, and doesn't ask again. No shared cache (Cloudflare or otherwise) may keep it (DECISIONS.md, Decision 1 of 14 October; SYC-279) |
| K2 | Team full photo `GET /api/team/photos/:publicId` | `api/routes/teamReports.ts:166-178` | `no-store`. Answers `404` for any row whose `mime` isn't an image type (`:150`), so the "removed" marker closes it with no code change (§4.1) |
| K3 | Team small/medium `GET /api/team/photos/:publicId/:size` | `api/routes/teamReports.ts:187-208` | `private, no-cache` with an ETag: asked again on every view. Closed by the same `mime` check |
| K4 | **The app's saved cat list** | `artifacts/cat-spotter/lib/catalogue.ts:17` | Keeps addresses, not pictures. The next fetch of the address gets `404` |
| K5 | **The app's and browser's image store** (`expo-image`, browser HTTP cache) | `artifacts/cat-spotter/components/CatPicker.tsx:289` and the defaults | **A phone that already showed the photo may keep it** until its cache clears. Nothing on the server can reach it. Said plainly in the reply (§7) |
| K6 | Spotter's own offline queue (photos waiting to upload) | `artifacts/cat-spotter/lib/pendingPhotos.ts:23`; `lib/webPhotoStore.ts:52` | The spotter's own phone, holding their own photo, until it uploads. Not ours to reach |

### 3.4 Backups and whole-database copies

From `docs/runbooks/neon-database.md` and the Neon switchover plan. **Which of these exist right now is unchecked.** The runbook lists them read-only each time (step 10).

| Copy | Kept for | What the runbook does |
|---|---|---|
| Neon `production` point-in-time history | 7 days (`neon-database.md:172`) | Nothing to do: it ages out. The reply says "within 7 days" |
| Neon `development` branch: a copy of real data | until reset | **Run the same removal there too**, or reset it from `production` after the removal |
| Neon `rehearsal` branch, archive branches (`replit-final-<date>`, `pre-restore-*`), named snapshots | until someone deletes them | Listed with the Neon tool (read-only). A named copy older than the removal goes on the ticket with its planned deletion date, for Samuel |
| Old Replit databases | cutover + 30 days (switchover plan G.1) | Same: listed, with their date |
| Encrypted dumps (GitHub artifact 7 days; Samuel's offline copy) | 7 days; Samuel's own | Same |

The privacy page (SYC-66) says how long backups keep deleted data (launch plan line 194). This runbook must say the same thing.

---

## 4. What "removed" means in the database

All of it happens in **one transaction**, holding the same photo-row lock that hiding takes (`select … for update` on `photos`, as in `api/lib/photoVisibility.ts:227-229` and `api/lib/issues/hide.ts:171`).

### 4.1 The picture is wiped and marked

`update photos set data = '', mime = 'application/x-removed' where id = $1`.

- `data = ''` meets the `NOT NULL` rule. There is no picture left in the row.
- `mime = 'application/x-removed'` is the **"removed" marker**. It needs no new column, and the team photo routes already refuse any non-image type (`api/routes/teamReports.ts:150`).
- `public_id` stays, so the old address answers `404`, and nothing reuses it.

### 4.2 The cat stops using it

For each cat whose `primary_photo_id` is the photo, set it to **the photo the public already sees in its place**: the newest visible cover photo of one of that cat's resolved sightings. This is the same stand-in rule as `displayPhotoRows`, `api/lib/photoVisibility.ts:119-162`. If there's none, set it to `0`, "no photo", which shows the placeholder.

The public page looks the same before and after. The cat stops being matched against the removed picture (C1), because matching reads only `primary_photo_id`.

### 4.3 The versions are deleted

`delete from photo_variants where photo_id = $1`. A request for a version after this finds no picture to make one from. `sharp` fails on empty input, so `variantFor` returns `null` and the route answers `404` (`api/lib/photoVariants.ts`; `api/routes/teamReports.ts:194`). In any case, K2/K3's `mime` check refuses first.

**The one race:** a version being made at the very moment of removal could be saved just after the transaction. So, after it commits, the command searches again (§5.5) and deletes any version it finds.

### 4.4 The removal is recorded

One more `photo_visibility_events` row is added:

- `action = 'hide'`
- `author` and `person_id` set to the approving team member
- `reason = 'removed: <request reference>'`

This keeps the photo hidden for good, since the newest event is a hide. It also answers "who removed this, when, and why?" in the add-only log the storage spec asks for (§6.5: *"Removal is recorded — who, when, why"*).

**The request reference is a short label, never personal data.** For example: `hello 2026-10-21 #1`, or the SYC ticket number. The workflow's inputs and output are visible on the public repo.

### 4.5 Everything else stays

P4, P5, P6 and P7 keep pointing at the row, which now holds no picture and stays hidden. Every reader already handles a hidden photo ("Photo hidden while Syros Cats take a look."; `api/routes/cats.ts:239`). Nothing else is touched.

---

## 5. The commands

There are four new `db-ops` commands. Each is run by `.github/workflows/db-ops.yml` from `main`, with `target` set to `development` or `production` (not `rehearsal`), exactly like the `people-*` commands (`scripts/db-ops.sh:491-498`). Behind them is one small CLI, `lib/db/src/photoRemoval/cli.ts`, built the way `lib/db/src/people/cli.ts` and `lib/db/src/appSettings/cli.ts` are built. It shares their rules:

- `--target` is required, and must equal `DATABASE_TARGET`.
- The connection comes only from the target's own variable.
- Output never includes an address, a host or a connection string. `grep_no_urls` checks this (`scripts/db-ops.sh`).

New workflow inputs:

| Input | Used by | Notes |
|---|---|---|
| `photo_id` | all but `photo-list` | The photo's public id (a UUID, as in its web address) |
| `photo_id_confirm` | `photo-remove` | The same id typed again |
| `photo_cat` | `photo-list` | The cat's number |
| `photo_by` | `photo-hide`, `photo-restore`, `photo-remove` | The approving team member's people id (from `people-list`) |
| `photo_ref` | `photo-hide`, `photo-remove` | The request reference (§4.4). Refused if it contains `@` or more than 40 characters, so an email address can't slip into the public log |
| `confirm` (existing) | `HIDE`, `RESTORE` or `REMOVE` | Without it, the command only prints what it would do |

### 5.1 `photo-list` (read-only)

Lists every photo of one cat, newest first. For each:

- its public id;
- where it's used (main photo; sighting number and role: first, face or body);
- the date taken;
- whether it's hidden, and why (the newest event's reason, and any report reasons);
- whether it's already removed.

It never prints a location, a device id, a person's name or any note text.

### 5.2 `photo-hide` (dry run unless `confirm=HIDE`)

It checks that the photo exists, isn't removed and isn't already hidden. Then it adds a `hide` event with `reason = 'privacy: <ref>'`, authored by `photo_by`. The approver must be a current team member: the `staff` or `management` role, not marked as left. Those are the roles that hold `hide_photo` in the dashboard (`api/lib/capabilities.ts`). The CLI lives in `lib/db` and can't call the app's `can()`, so it checks the roles directly, and T4 pins this. It prints the photo's state before and after.

**Undo:** `photo-restore`, or **Restore** on the team dashboard's cat page.

### 5.3 `photo-restore` (dry run unless `confirm=RESTORE`)

The undo for a hide. Same checks: a current team member, and the photo not removed.

### 5.4 `photo-remove` (dry run unless `confirm=REMOVE` and `photo_id_confirm` equals `photo_id`)

It refuses, and changes nothing, unless **all** of these hold. They are checked again inside the transaction, under the lock:

1. The photo exists in `photos`.
2. It's **hidden now**: its newest event is a `hide`.
3. It was **hidden for privacy**, under Decision 3. Either a hide event's reason starts with `privacy` (from `photo-hide`, or SYC-246's future tick), or a report with reason `photo_private` names it.
4. `photo_by` is a current team member (§5.2). `remove_photo`, the power SYC-246 adds, belongs to the same two roles (`docs/specs/roles-and-invites.md:301`).
5. `photo_ref` passes the §5 rule.

**A photo already removed** prints "already removed on <date>" and exits successfully, writing nothing. Running it twice is safe.

**The dry run prints** the full plan and the search (§5.5) as it stands, so the approver can see exactly what will change:

```
photo-remove (DRY RUN: nothing changed) target=development photo=3f2c…e91a
  hidden: yes, for privacy (privacy: hello 2026-10-21 #1, 21 Oct 2026)
  picture:            41,233 bytes → would be wiped
  versions:           small, medium → would be deleted
  main photo of:      cat 182 → would become photo 7c1d…02b4 (what the public sees now)
  spot photos:        sighting 5531 (first) → stays, shown as "photo hidden"
  answers/readings:   2 → stay, no picture in them
  reports:            1 (photo_private) → stays
  To do it: confirm=REMOVE and photo_id_confirm=<the same id>
```

**A real run** prints the same lines in the past tense, and then the search.

### 5.5 The search (part of every dry run and every real run)

After the change, the command searches for the photo's picture and copies everywhere in the database and prints one line per place:

1. `photos.data` for the row is empty, and `mime` is the marker.
2. `photo_variants` has no rows for it (re-checked after commit; any found are deleted and reported).
3. No `cats.primary_photo_id` points at it.
4. Its newest visibility event is a `hide`.
5. **The picture's bytes appear nowhere.** The command takes a fingerprint of the picture before wiping it: a 64-character slice of its base64 text, and the same bytes decoded. It then scans **every** text, `jsonb`, text-array and `bytea` column of **every** table in the `public` schema for that fingerprint. This is the same "every column" approach as `api/routes/me.delete.test.ts:324-346`. It catches a copy in a place nobody listed, including tables added after this spec.

The run ends `GONE` only if all five pass. Otherwise it ends `NOT GONE: <places>` and a non-zero exit, so the workflow run goes red.

### 5.6 Checks outside the database (runbook steps, not the command)

- `curl -sI https://<live host>/api/photos/<photo_id>` must answer `404` with `no-store`.
- The cat's public detail (`GET /api/cats/<cat>`) must not contain `<photo_id>` anywhere.

---

## 6. Two small safety changes in the app

Without these, two rare paths would misbehave after a removal. Neither leaks the picture, because it's gone, but both would look broken.

1. **Restore is refused for a removed photo.** `setPhotoVisibility` (`api/lib/photoVisibility.ts:221`), the only restore path (dashboard **Restore**, `api/routes/teamPhotos.ts:69`), returns a new refusal, `removed`. Otherwise, a team member pressing **Restore** on a removed photo would put an empty picture back on the public page. The dashboard shows its existing "couldn't do that" message. Its cat page lives in `teamPages/`, which another session is editing, so the button itself isn't changed now; SYC-246 replaces it in November.
2. **A repeat upload skips a removed photo** (`api/routes/sightings.ts:556-601`). The rows are filtered on the marker, and if none are left the existing "photo has gone" branch handles it. Otherwise an empty picture would be sent to the matcher.

Belt and braces: the public photo route (`api/routes/photos.ts:51`) also answers `404` for the marker, even if a removed photo somehow became visible again.

---

## 7. The runbook (`docs/runbooks/photo-removal.md`)

The runbook is written in this PR. Its steps are below.

1. **Log the request** as an SYC ticket (template: date, how it arrived, cat number, which photo). No requester details. Those stay in the inbox.
2. **Find the photo**: `photo-list` with the cat's number on `production` (read-only, no ask mode needed).
3. **Get approval** from Samuel or a Syros Cats team member, quoting the photo id and what it shows. Record it on the ticket.
4. **Heads-up to Samuel** that a production write is next, and ask him to switch to "ask" mode.
5. **Hide**: `photo-hide`, dry run, then `confirm=HIDE`. The photo is now off every public place. *Undo: `photo-restore`.*
6. **Remove**: `photo-remove`, dry run, read the plan, then `confirm=REMOVE` with the id typed twice. Expect `GONE`.
7. **Check from outside**: §5.6.
8. **The development branch**: run step 6 against `development` too, or reset it from `production`.
9. **The team inbox**: if a report hid the photo, ask the inbox owner to delete the "Photo hidden" email, which carries the photo as an attachment.
10. **Backups**: list Neon branches and snapshots (read-only), and note any copy older than the removal, with its deletion date, on the ticket.
11. **Reply** to the person (template):
    > "We've removed the photo from Cat Spotters. It no longer appears anywhere in the app or on the website, and we've deleted our copies of it. If your phone or browser had already shown it, a copy may stay there until its cache clears. Our backups keep data for 7 days, after which it's gone from them too."
12. **Close the ticket** with the run links.

**If a step fails:** before step 6, restore and start again. If step 6 ends `NOT GONE`, don't retry blindly. The output names the place, so stop and raise it on the ticket.

---

## 8. Test plan

All tests run against a **throwaway local Postgres database** with the real migrations and triggers (`lib/db/src/migrate/testDatabase.ts`, which refuses a `.neon.tech` host). They never touch Neon.

### 8.1 The full search test (the one the launch plan names)

**T1.** It seeds photo **P**, with a recognisable picture, in **every** place in §3.1:

- as a cat's main photo;
- as a sighting's cover and its `first` photo;
- as a second sighting's `face` photo;
- with small and medium versions;
- with an observation;
- with a `photo_private` report;
- with a privacy hide.

It also seeds a control photo **Q**, in the same places for another cat. It runs `photo-remove` for real, then asserts:

- the search (§5.5) reports `GONE`;
- an **independent** scan in the test, written separately from the command's own, finds P's bytes in no column of any table, and finds no version rows for P;
- no cat points at P, and the cat now points at its stand-in;
- **Q is untouched**: same bytes, same versions, same main photo.

**T2. Skip one place and T1 goes red.** The removal is written as a list of named steps (wipe, versions, main photo, record). A test-only option skips one. A parametrised test runs T1 once per step, with that step skipped, and expects the search to report `NOT GONE` naming that place. Skipping the after-commit version re-check is covered by T2b: a version is inserted between commit and check, and the search must catch it. Each red is also confirmed by hand once, as a mutation probe recorded in the PR.

**T3. A new photo link makes the catalogue test red.** It reads every foreign key to `photos` from the database, and every column named `photo_id`, `*_photo_id` or holding `bytea`. It compares them with the reviewed list in §3.1. A column added later, say by SYC-246 or by dashboard phase 3, turns this red until someone decides how removal treats it.

### 8.2 Refusals and safety

- **T4.** Each of these is refused, and a before/after checksum of the affected tables shows nothing changed:
  - not hidden;
  - hidden only for an offensive report (`photo_inappropriate`);
  - hidden by the team without a privacy reason;
  - unknown id;
  - `photo_id_confirm` different;
  - `confirm` missing (a dry run);
  - `photo_ref` holding an `@`;
  - `photo_by` not a team member;
  - target mismatch.
- **T5.** A second `photo-remove` says "already removed", writes nothing and exits 0.
- **T6.** Hide, then restore (the undo), leaves the photo exactly as before. Restore after remove is refused.
- **T7.** No command output contains a connection string, a device id, coordinates or note text.
- **T8.** Two removals at once: one writes and the other says "already removed" (the lock).

### 8.3 In the app (api-server tests)

- **T9.** After removal:
  - the public photo address answers `404` `no-store`;
  - both team photo addresses answer `404`;
  - the cat's public page shows the same stand-in photo as before and doesn't contain P's id;
  - the sighting shows "photo hidden".
- **T10.** Restore on a removed photo is refused (§6 change 1). Mutation probe: drop the check, and T10 goes red.
- **T11.** A repeat upload of a spot whose photo was removed returns that spot without a matcher call (§6 change 2). Mutation probe: drop the filter, and T11 goes red.
- **T12.** Matching for a new spot near the cat doesn't send P (the matcher mock records what it received).

### 8.4 The dry run

1. **Before the PR is ready:** run through `scripts/db-ops.sh` itself against a **local scratch database**. Set `TARGET=development`, `DATABASE_TARGET=development`, and `NEON_DEV_URL` to the scratch database. Seed it like T1, then run: list, hide (dry, then real), restore, hide, remove (dry, then real), and remove again. Paste the output into the PR.
2. **The launch checklist's run** ("the runbook's dry run passed on the development database", plan line 211) uses the Neon `development` branch, through the workflow, after merge. Decision D2 (§10) asks how far it goes. Claude gives Samuel a heads-up first, because it writes to a Neon branch.

---

## 9. How this fits November's button (SYC-246)

SYC-246's planned migration (`docs/superpowers/plans/syc-44-report-an-issue.md`, PR 7.2) does four things:

- makes `photos.data` nullable;
- adds `removed_at`, `removed_by` and `removed_reason`;
- enforces "no picture exactly when removed";
- refuses restore, skips removed photos in matching, and answers removed photos on the team route.

Rows removed by hand convert cleanly in that migration. `mime = 'application/x-removed'` picks them out: set `data = null`, take `removed_at`, `removed_by` and `removed_reason` from the `removed:` hide event (§4.4), and put the image type back. **That backfill is added to SYC-246 as a comment** when this PR opens, so November doesn't rediscover it.

Nothing here contradicts it:

- the same eligibility rule (Decision 3);
- the same "the row stays" shape;
- the same lock;
- the same restore refusal.

§6's change 1 becomes November's restore check, and §6's change 2 is November's "repeat sighting upload" row.

---

## 10. Decisions for Samuel

**D1. Wipe in place, or something bigger?**

- **A. Wipe the picture in place and mark it, with no database change (recommended).** Described above.
  - For: no migration, so nothing to coordinate with the 19 Oct publish. Every link keeps working, and November takes the rows over as they are.
  - Against: the "removed" marker is a value in an existing column rather than a proper column until November.
- **B. Bring forward SYC-246's database change now.**
  - For: the proper columns from day one.
  - Against: a migration in launch week, and every place that reads a picture changes at once. That is November's whole PR, in the same week as launch.
- **C. Delete the row**, switching off the log's safety trigger to do it.
  - Against: it destroys the record of who hid the photo, and leaves broken links in sightings that can never be repaired.

**Recommendation: A.**

**D2. How far does the development run go?**

- **A. A full rehearsal on the development branch (recommended).** On a real photo there: hide, restore, hide, remove, check.
  - For: it proves every step on real data, through the real workflow.
  - Against: that photo is gone from development until its next reset from production. Development is a copy, so this harms nothing.
- **B. Dry runs only on development.**
  - For: nothing changes there.
  - Against: the writing steps are only proven on the local scratch database.

**Recommendation: A.**

**D3. The reporter's own photos** (a cat-in-trouble photo showing someone's yard). These are team-only and never public.

- **A. Out of scope for launch (recommended).** File a ticket for SYC-246 to cover them.
  - For: smaller, and these photos are never public.
  - Against: a request about one would need ad-hoc handling. The runbook says to raise it with Samuel.
- **B. Include a `report-photo-remove` command now.**
  - For: covers that case.
  - Against: more to build and test this week.

**Recommendation: A.**

**D4. The two safety changes in §6.**

- **A. Include them (recommended).** They're small, each has a test that fails without it, and both are November's design anyway.
- **B. Database-only.** This avoids touching the app, but a team member pressing **Restore** on a removed photo would put an empty picture back on the public page.

**Recommendation: A.**

---

## 11. Found while mapping (filed, not fixed here)

- **Hidden photos are still sent to the matcher.** `api/routes/sightings.ts:276-289` reads a cat's main photo with no hidden check, so a photo hidden for privacy, but not yet removed, still goes to OpenAI with every nearby spot. The removal fixes this for removed photos (§4.2). For hidden ones it's a new ticket (dedupe checked first).
- **SYC-246 backfill note** (§9): a comment on SYC-246.
- **Reporter photos** (D3): a ticket, if Samuel picks A.

---

## 12. What this PR will contain, once approved

- `lib/db/src/photoRemoval/` (the CLI, the steps and the search) and its tests.
- `scripts/db-ops.sh` and `.github/workflows/db-ops.yml`: four commands and five inputs.
- `lib/db/package.json`: a `photos` script.
- The two §6 changes, plus the belt-and-braces line, with their tests.
- `docs/runbooks/photo-removal.md`.

**Model delegation** comes in the plan.
