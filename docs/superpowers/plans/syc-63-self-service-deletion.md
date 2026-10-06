# SYC-63: "Delete my data", self-service in the app

**Status:** **approved by Samuel, 29 Sep 2026** (recorded on Linear SYC-63), and built on branch `claude/syc-63-delete-my-data` (Oct 2026). The §5 migration is `0009_deletion_unlinks_people`; it also allows SYC-119's `awaiting_team` moves (Linear, 2 Oct).
**Spec:** `docs/specs/cat-record-data-spine.md` §8 (the mechanism) and §11.2 step 8, `docs/specs/email-capture.md` §3.5 and §6 (where the button sits, and every word on the screens), `docs/specs/privacy-policy.md` ("Deleting yourself"), `docs/specs/team-access-and-welfare-queue.md` §3.5 (the staff fallback), `DECISIONS.md` F3, D6 and Part 2c.
**Decision that overrides the spec:** Samuel's 29 September decision on SYC-63 ("DECISIONS.md Part 2g"), recorded as a Linear comment on SYC-63. The PR that would have added it to `DECISIONS.md` (#18) was **closed without merging**, so today it lives only in Linear. See "Things to flag" §1.
**Linear:** SYC-63 (this), related SYC-45 (email), SYC-43 (staff dashboard), SYC-40 (data spine).

---

## 0. In one paragraph

A spotter opens **Profile → Delete my data**, reads one screen saying exactly what goes and what stays, and taps **Delete my data**. By the time the next screen appears, the server has removed everything that identifies them: their points, streak, badges, spotter name, follows and notifications, and the link between them and every sighting and note they ever sent. The cat sightings themselves stay, with their name off them, so no cat loses its history. The phone forgets the old identity and starts a fresh one, so they can carry on spotting from zero straight away. It needs a connection, because the deleting happens on the server. It is one database transaction, and running it twice is safe.

**The one blocker:** doing this the way Samuel decided on 29 September needs a small database migration. This plan **does not add it**, because the SYC-43 chip holds this wave's migration slot. §5 describes the migration so whoever holds the next slot can write it. **Building starts only once that migration has a slot.**

---

## 1. What the person experiences

### 1.1 Finding it

The Profile tab already holds Language and Appearance. Below them goes one row, always there, whether or not the person ever gave an email address (email-capture §3.5):

> **Delete my data**: *Remove everything that identifies you.*

The row uses the screen's existing text and row styles. **No new fonts, sizes or weights.** The SYC-7 Greek-font chip is changing typography in this app, and this work must not collide with it.

"Stop emailing me" is not part of this work. It appears only once someone has given an address, and email capture (SYC-45) is not built yet.

### 1.2 The confirmation screen

This is a new full screen, `app/delete-my-data.tsx`. **Its words are email-capture §6.3, exactly as written.** That section is the copy of record, and the data spine says the two must never drift apart. The words are: the heading, "It can't be undone", **What goes**, **What stays**, and the two buttons **[ Delete my data ]** and **[ Keep my data ]**. "Keep my data" is the safe default: it gets the visual weight, and "Delete my data" does not.

Samuel approved three additions to the §6.3 copy on 29 September (§9 A, B and E). Email-capture §6.3 should be updated to match, so the copy of record and the screen stay the same:

- **No connection (E).** The delete button is disabled, with the line *"You need a connection to delete your data."* Nothing is deleted offline, and the app never pretends it was.
- **Spots that haven't been sent yet (B).** When there are any, the screen adds: *"You have 3 spots that haven't been sent yet. They'll be deleted too."* The number is the real count.
- **Cats they said live with them (A).** Under **What stays**, the screen adds a line saying such a cat keeps its home and the note about where it lives, but loses their name. Draft wording: *"If you told us a cat lives with you, it still shows as having a home, and the note about where it lives stays. Your name and your link to it come off."* Flag 5 is now settled (the link is cleared). The draft is approved along with the plan, like the privacy-policy line from flag 6.

### 1.3 What happens when they tap

1. The button shows it is working. The screen cannot be dismissed half-way.
2. The phone stops sending queued sightings and waits for any upload already in progress to finish (§6.2).
3. The phone asks the server to delete the person (`DELETE /api/me`).
4. **If the server says done:** the phone wipes its own copy of the person (§6.3), makes a new identity, and shows the "Done" screen.
5. **If the server fails or the connection drops:** nothing on the phone is wiped. An error line says it didn't happen and they can try again. Trying again is always safe (§4.4).

### 1.4 Afterwards

The "Done" screen uses email-capture §6.3's words exactly: *"Nothing on this phone is linked to you any more … you'll start again from zero."* Tapping on takes them into the app as a brand-new spotter. Because a new spotter has no spotter name, the existing first-run step asks them to choose one. That is what "start again from zero" means in practice.

### 1.5 What the person does *not* get, stated honestly

- **No undo.** Anyone holding the unlocked phone can do this (data spine §8.2, risk 10). This was accepted.
- **Other people's phones.** A phone that saved the cat list offline may still show the deleted person's spotter name as a cat's discoverer until that phone next refreshes online. We cannot reach into other people's phones. The next online refresh corrects it.
- **Backups.** Hosting keeps database backups for a period. Deleted data lingers in them until they expire. The privacy policy says nothing about this, so it goes to Linear as a follow-up (§10).

---

## 2. What happens to the data, table by table (tables on `main` today)

"Removed" means the row is deleted. "Unlinked" means the row stays, the columns that point at the person are cleared, and the row is stamped `redacted_at` / `redaction_reason = 'deleted by the person'`. This is data spine §8.3, applied to what actually exists.

| Table | What deletion does | Why |
|---|---|---|
| `device_credentials` | **Removed**, then replaced by a one-way "deleted device" marker (§4.3, decision D) | "The device row and its secret" go (§8.3) |
| `profiles` | **Removed**: nickname, username, points | §8.3. This frees the username for someone else to use later |
| `push_tokens` | **Removed** | §8.3 |
| `cat_subscriptions` | **Removed** (the cats they followed) | §8.3 "cat follows" |
| `notifications` | **Removed** (their in-app notification feed) | §8.3 "queued notifications" |
| `sightings` | **Unlinked**: `device_id` cleared (needs §5), stamped. Photo, date, position and cat are kept, and so is `status`. | §8.3: "every sighting" is kept |
| `observations` | **Unlinked**: `device_id` cleared, stamped. **Notes** also have their text emptied (`value = '{}'`), done in SQL as Samuel directed, not read and rewritten from JavaScript. Every other kind keeps its value, **including `name`**. | §8.3, §8.4, and the existing trigger in migration 0001 |
| `cats.discoverer_device_id` | **Cleared** (needs §5), and the cat is stamped. The cat shows its discoverer as *"a spotter"*. | §8.3 and Part 2g |
| `cats.owner_name`, `owner_device_id` | **Cleared.** The cat stays homed through its derived life status (spine PR 4) | Decision A and flag 5 (b), Samuel, 29 Sep |
| `cats.home_description` | **Kept** (§10 flag 6) | Decision A, Samuel, 29 Sep |
| `cats.name`, `description` | **Kept** | Names are community property (§8.4) |
| `photos` | **Kept.** Photos carry no link to a person. | §8.3 "every sighting: photo…" |
| `cat_updates` | **Kept.** Its messages hold only cat names ("Mimi was spotted again!"), never a person. | Checked in `routes/sightings.ts` |
| `cat_identity`, `colonies`, `colony_name_history`, `feeding_sites` | **Untouched.** Only staff write them, and none hold a device id. | — |

**Tables that don't exist yet.** Their specs already say what deletion does to them. §7 describes how they plug into this same function when they are built: email addresses and consent events (SYC-45), welfare reports (team-access), and `people` (SYC-43).

---

## 3. What the person sees change in the app, for everyone else

Once someone has been deleted, other spotters see:

- **The cat page and cat cards:** discoverer shown as *"a spotter"* (a new translated string), not a spotter code.
- **The cat's sightings list:** that person's sightings are still there, credited to *"a spotter"*.
- **The care timeline's "discovered" entry:** *"a spotter"*.
- **The leaderboard:** the person is simply gone, because their profile row is.
- **Sighting counts:** unchanged.
- **The "Fans" tile:** a deleted person stops counting, so the number can drop by one (decision C).
- **A cat they said lives with them:** it still shows as having a home, through its life status, and its home note stays. The owner's name and the link to them are gone (decision A).
- **Notifications:** a deleted person never receives anything again. Nothing is ever sent to "nobody".

---

## 4. API changes (`artifacts/api-server`)

### 4.1 `DELETE /api/me`

- **Who is asking:** the device id comes in an `X-Device-Id` header and the secret in the existing `X-Device-Secret` header. They go in headers rather than the URL so the device id never lands in request logs. They aren't in a body either, because some proxies drop the body of a DELETE. The default `cors()` in `app.ts` already reflects requested headers, so the web build works.
- **Checks, in order:**
  1. Is there a "deleted device" marker for this id? If so, return `204`, because it is already done. This check must come **before** the trust-on-first-use insert in `verifyDeviceSecret` (see §4.3).
  2. Otherwise run the existing `verifyDeviceSecret`. A wrong secret gets `403`, as everywhere else. As with every owner route, a device that has never presented a secret binds on first use. That is the existing trust model, unchanged.
  3. Run `severPerson` (§4.2) in one transaction, then return `204`.
- **Rate limit:** use the existing per-device limiter in `middlewares/rateLimit.ts`, with a small allowance.
- **OpenAPI:** add the path to `lib/api-spec/openapi.yaml` with an `X-Device-Id` header parameter, then regenerate the client with orval. Also make the three public spotter fields nullable (§4.5).

### 4.2 `severPerson(tx, { deviceId, reason })`: one function, three doors

It lives in a new file, `artifacts/api-server/src/lib/severPerson.ts`. The in-app button calls it today. The delete link in emails (SYC-45) and the staff "Delete this person's details" action (SYC-43) call the **same function** when they are built, so there is one mechanism with one test suite, never three.

Inside one transaction, in this order:

1. Lock the credential row (`SELECT … FOR UPDATE`), so two deletes of the same device queue up rather than interleave.
2. Redact the observations, in SQL: `update observations set device_id = null, redacted_at = now(), redaction_reason = $reason, value = case when kind = 'note' then '{}'::jsonb else value end where device_id = $id`. The trigger from migration 0001 already permits exactly this.
3. Unlink the sightings: `set device_id = null, redacted_at = now(), redaction_reason = $reason where device_id = $id`.
4. Unlink the cats they discovered: `set discoverer_device_id = null, redacted_at = coalesce(redacted_at, now()), redaction_reason = coalesce(redaction_reason, $reason)`. Then, for the cats they own (decision A): `update cats set owner_name = null, owner_device_id = null where owner_device_id = $id`. `owner_device_id` is already nullable, so this needs no migration. The home description is left alone.
5. Delete from `cat_subscriptions`, `notifications`, `push_tokens` and `profiles` where the device matches, then delete from `device_credentials`.
6. Insert the "deleted device" marker (§4.3).

The whole thing is **synchronous**: no queue and no nightly sweep (§8.5). Observations and sightings are looked up by device. Observations already have partial indexes from 0001. `sightings.device_id` has **no index today**, so the §5 migration adds one. Without it, deletion scans the whole sightings table while the person waits.

### 4.3 The "deleted device" marker (decision D, decided by Samuel 29 Sep)

**The problem it solves.** If an old copy of the app still has the old id and secret, the server's trust-on-first-use rule would happily recreate the deleted identity from the very next request. That old copy could be a second browser tab, an upload that was mid-flight, or an app killed between "server said done" and "phone wiped itself". The person would come back as a ghost with a fresh profile, and any sightings it sent would be linked to them again.

**The fix, with no new table.** After deleting the credential, insert a row into `device_credentials` whose key is `deleted:` followed by the sha256 of the device id, with a secret hash that can never match. `verifyDeviceSecret` checks for that marker first and answers **410 Gone**. The phone treats 410 as "this identity was deleted: finish wiping and start fresh" (§6.4).

- The marker is a one-way hash of a random id. It cannot be turned back into the id, and nothing else in the database links to it. This is the same idea as the email suppression hash the spec already keeps (§8.5).
- Real device ids start `dev-`, so a real id can never collide with a `deleted:` key. `verifyDeviceSecret` also refuses any incoming id starting `deleted:`.
- It does **not** break the promise that "no query returns the device id": the id itself is gone and only its hash remains.
- **Order inside `verifyDeviceSecret` (from review):** today it inserts the credential first and checks afterwards (`lib/deviceAuth.ts`). The marker lookup has to run **first**, before that insert. Otherwise the insert quietly re-creates the deleted identity and the marker never gets a say. This site gets its own mutation probe (§8.1).

**Routes that write a device id without checking its secret (from review, confirmed).** Three routes trust a `deviceId` sent in the request body and never call `verifyDeviceSecret`:
- `POST /cats` (register a cat you own), `routes/cats.ts:100`;
- `POST /cats/:catId/claim`, `routes/cats.ts:229`;
- `PATCH /cats/:catId`, `routes/cats.ts:283`.

On any of them, someone who knows a deleted person's device id could write it straight back onto a cat, with no secret and no 410. That would undo the "nobody can bring the identity back" promise. Data spine step 5 already requires the claim route to check the secret (§10.7, §11.2 row 5), and **SYC-107** already tracks the other two routes. **SYC-107 is delivered inside data spine PR 2**, not as separate work, and SYC-63 stays marked as blocked by it. The fix is to finish that job:
- all three routes go through `verifyDeviceSecret`, and with it the marker check;
- this is a **precondition of this build**, delivered by spine PR 2. That PR must be merged before this build starts;
- a test in §8.1 checks that each of the three routes returns 410 for a deleted id.

This is not a redesign. The repo's own rule (`.agents/memory/device-secret-auth.md`) is that any endpoint acting for a device must verify it. These three routes simply pre-date that rule.

### 4.4 Running it twice

The first call deletes and leaves the marker. Every later call with the same id finds the marker and returns `204` without binding anything. If the first response was lost to a timeout, the retry succeeds and the phone finishes its wipe. That covers §8.5's rule that "running the deletion twice is safe".

### 4.5 Read paths that must cope with "nobody"

Once §5 lands, these device ids can be empty, and TypeScript will flag every place that assumed they couldn't. Each one gets an explicit answer:

| Where | Change |
|---|---|
| `spotterCode()` in `lib/catHelpers.ts` | Takes `string \| null` and returns `null` for nobody |
| `catPayload` / `listCatsWithStats`: `discovererSpotterCode` | Nullable. The app shows *"a spotter"* |
| `GET /cats/:id`: `sightings[].spotterCode` | Nullable. The app shows *"a spotter"* |
| `GET /cats/:id`: care timeline "discovered" message | Falls back to a fixed `"a spotter"` marker, and the app translates it |
| `fansCount()` | Decision C. Recommended: count only sightings that still have a person |
| `notifyCatSpotters()` in `lib/notifications.ts` | Adds `device_id is not null`, so it never sends to nobody |
| `createUpdateAndFanOut()` | Reads subscriptions only. They are deleted, so no change is needed. A test proves it |
| The profile, streak and spotted-cats queries | Always keyed on a real device, so a null never matches. No change |

**Old app builds.** A phone on an older build that sees a null code would show "Spotter null". Nulls only exist once someone on the new build has deleted themselves, and closed-test testers are told to update. This is accepted and noted in the PR.

### 4.6 Logging

`DELETE /me` puts nothing identifying in the URL. The request logger doesn't log headers today; a test proves that `X-Device-Id` and `X-Device-Secret` never appear in the log output. The existing leak of device ids in `/notifications/:deviceId` and `/profile/:deviceId/push-token` URLs is older than this work, so it is filed as its own ticket (§10).

---

## 5. The migration this needs (described here, **not** added by this plan)

Samuel's 29 September decision (Part 2g) says deletion unlinks by **clearing** the column, and rejects the alternatives. A fixed stand-in value would create one phantom spotter holding everyone's points. A random stand-in per person would keep that person's walk trail grouped. Clearing a column that is `NOT NULL` today needs a migration. **So step 8 does not "depend only on step 1", and Part 2g says so itself.**

What the migration contains. The agreed queue is set in the data spine plan (`docs/superpowers/plans/data-spine.md`, PR #23):

**`0002` SYC-98 → SYC-43 part 1 → SYC-101 → spine PR 3 (data only) → SYC-63 deletion (this).**

- **No migration number is hardcoded.** Migrations merge one at a time, and whoever merges second rebases and regenerates, because the runner refuses one that lands behind another.
- **Every step is written so it can safely run twice,** as that plan requires: drop `NOT NULL`, add each check only if it is missing, create the trigger only if it is missing, and create each function with `CREATE OR REPLACE`.

1. `sightings.device_id`: drop `NOT NULL`, and add the check `device_id is not null or redacted_at is not null`.
2. `cats.discoverer_device_id`: drop `NOT NULL`. Add `cats.redacted_at` and `cats.redaction_reason`. Add the check `discoverer_device_id is not null or redacted_at is not null`.
3. **Index** `sightings(device_id) where device_id is not null`.
4. **An append-only guard on `sightings`**, which Samuel asked to be designed here. It is a trigger, like the observations one:
   - **Inserts:** must arrive unredacted.
   - **Updates:** only two are allowed.
     - **Resolve:** `status` goes `pending → resolved` and `cat_id` goes from null to a value, once, with nothing else changing. This is the only update the app makes today (`routes/sightings.ts:307`).
     - **Redaction:** stamped with a reason, the author cleared, nothing else changed. It may re-run.
   - **Deletes and `TRUNCATE`:** refused.
   - **Knock-on:** the api-server tests currently clean up with `delete from sightings` (in seven test files). The guard would refuse that. Those tests have to move to a throwaway database per run, with no bypass switch in the trigger, because a switch anyone can flip is not a guard. This is real work, and it is in the model-delegation table.
5. **Rollback:** putting `NOT NULL` back fails once any row has been redacted. The rollback has to say so and refuse, rather than pretend. That follows the rule in `lib/db/migrations/README.md` that destructive rollbacks are written and reviewed first.

**How this reaches production (SYC-121).** The database is on Neon, and Replit's publish no longer touches its structure. This migration, including the two CHECK constraints and the sightings append-only guard (a trigger and its function), reaches production only through the #13 runner, run by `db-ops` (`gh workflow run db-ops.yml --ref main -f target=production -f command=migrate`) **before** the code that uses it is published. The runner applies every statement exactly as written, in one transaction, so there's no partial delivery. Relaxing `NOT NULL`, the nullable columns and the index are applied the same way.

**Timing, per F6:** all September schema work must land before the Google Play closed test starts. This migration is schema work, so **it has to be scheduled before that clock starts**, whichever slot it gets.

---

## 6. App changes (`artifacts/cat-spotter`)

### 6.1 Files

- `app/(tabs)/profile.tsx`: add the "Delete my data" row using existing styles. No typography changes.
- `app/delete-my-data.tsx` (new): the confirmation screen and the Done screen, with the copy from email-capture §6.3.
- `lib/i18n.ts`: the copy in English and Greek. **The Greek needs a native speaker's review before release.** That review is already a Phase 1 item.
- `lib/deleteMyData.ts` (new): the step-by-step flow in §6.2, as plain functions so it can be tested without a screen.
- `context/DeviceContext.tsx`: gains `resetIdentity()`. This clears the id, secret, username and owned cats, then makes a new id and secret in the same way as first launch.
- `context/OfflineContext.tsx`: gains `pauseAndClear()`. This stops syncing, waits for `UPLOAD_LOCK`, then empties the queue through the existing single write path under `QUEUE_LOCK`, and deletes every queued and review photo.
- `lib/pendingPhotos.ts`: gains a "remove everything" helper covering native photo files, the web IndexedDB photo store, **and the 30-day queue backups**. The backups hold a raw copy of the queue, photos and exact positions included, so they have to go too.
- `components/CatCard.tsx` and `app/cat/[id].tsx`: show *"a spotter"* when the code is null.
- The API client's fetch wrapper: treat a `410` from any device-authenticated call as "identity deleted", and run the wipe in §6.4.

### 6.2 The order on the phone, and why

1. **Pause the queue and wait for uploads.** This stops a sighting from being uploaded under the old identity *after* the server has deleted it, and it needs different handling on web and on phones.
   - **On web,** taking `UPLOAD_LOCK` makes this tab wait until any other tab has finished uploading.
   - **On phones, that lock does nothing (from review, confirmed).** Phones have no lock manager, so `withLock` runs straight away (`lib/webLocks.ts`). The storage chain in `queueStore.ts` only puts *storage* changes in order, and the `createSighting` network call in `syncOne` sits outside it.
   - **So `OfflineContext` has to keep hold of its in-progress sync.** It stores the promise, and `pauseAndClear` then does two things. First, it sets a "paused" flag that `syncNow` and the reconnect trigger both respect. Second, it **awaits that stored promise** before going on.
   - **Server backstop:** the marker means a straggling upload that still lands after the delete gets 410, never a new identity. A §8.2 test starts an upload, starts deletion, and asserts the upload finishes (or is refused) before `DELETE /api/me` is sent.
2. **Call `DELETE /api/me`** with the old id and secret.
3. **Only on `204` (or `410`),** wipe the phone:

| Wiped | Kept |
|---|---|
| `cat-spotter/device-id`, `device-secret`, `username`, `owned-cat-ids`, `ownership-snapshot` | `cat-spotter/language`, `appearance` (preferences, not identity) |
| `cat-spotter/pending-sightings` and every queued photo, review photo and queue backup | `cat-spotter/cats-cache/public/v2` (the public cat list, so the map keeps working offline; renamed from `cat-spotter/cats-cache` by SYC-41) |
| The in-memory query cache: profile, notifications, anything else fetched with the old id | Offline map tiles |

4. **Make the new identity** and re-point the API client's secret getter at it.
5. **Show "Done".**

If step 2 fails, steps 3 to 5 don't run and the queue resumes. The person is exactly where they started.

**If the saved queue can't be read (from review).** The app already has a "read-only" state for a queue it cannot parse (`OfflineContext.readOnly`), and in that state normal queue changes throw `QueueWriteError`. Deletion must never get stuck on it, and must never skip the wipe to get past it. So on `204`, the wipe:
- removes the raw `cat-spotter/pending-sightings` key directly, rather than editing the list through the write path. The whole list is going, so there is nothing to merge;
- empties the photo stores wholesale.

A §8.2 test starts from an unreadable queue and checks that both are gone afterwards.

### 6.3 Being precise about offline

- **Deleting needs a connection.** The server does the deleting, so offline the button is disabled (decision E) and nothing happens.
- **Unsent spots** exist only on this phone. The server never saw them, so there is nothing there to unlink. Decision B covers what happens to them. The recommendation is to delete them with everything else, because they are "your spot history".
- **After deletion,** the offline cat list and map carry on working as before. New spots queue under the new identity in the usual way.

### 6.4 The interrupted case

If the app is killed after the server has deleted the person but before the phone wipes, the old id and secret are still on the phone at next launch. The first device-authenticated call gets `410`. The phone runs steps 3 to 5 and then shows the Done screen. Without the marker in §4.3, this case would silently bring the old identity back.

---

## 7. The other two doors, and staff accounts (not built here)

- **The delete link in every email (SYC-45).** It maps the address to its device ids and calls `severPerson`, then does email-capture's own part: remove the address, keep the suppression hash, and redact the consent events' identifying parts. **Contradiction to flag:** email-capture §5.8 says delete tokens never expire, while team-access §8.5 says "a signed, expiring token". SYC-45 has to settle this; it doesn't affect this build.
- **The staff action (SYC-43, team-access §3.5).** "Delete this person's details" calls the same `severPerson`. It is recorded with who, when, and which request.
- **Staff accounts and `people` (SYC-43 part 1, whose migration is ahead of this one in the queue).** `DELETE /me` acts on a **device** identity only. It never touches rows attributed by `account_id`, and it never touches `people`. So it doesn't depend on `people` existing and won't break when it does. A staff member who also spots cats on their own phone has two separate identities; deleting the spotter leaves the staff account alone. **Removing a staff member** is SYC-43's "one deletion, in one place" and is a different operation. Whether it also unlinks their name from team observations (who confirmed a sterilisation) is SYC-43's call, and the charity may well want that attribution kept as evidence. System-written observations (`account_id = 'system:…'`, Part 2g) are never touched.
- **Welfare reports (not built).** The reporter's device id is unlinked by the same function when that table exists, and so is the reporter's address, via the email side. §8's scan test will fail if a new table holds a device id that `severPerson` forgets.

---

## 8. Tests

### 8.1 Server (vitest + supertest, against a real database, as the repo already does)

The main test is **"the cat's data survives and the person is gone"**.

**Set-up.** Seed person P with:
- a profile with a username and a nickname, and some points;
- two resolved sightings and one pending sighting;
- a cat P discovered and named;
- a cat P claimed, with an owner name and home description;
- a note observation, an ear-tip observation and a name observation;
- a follow, two notifications and a push token.

Seed person Q with a sighting of the same cat. Record the cat's public payload, sighting count and derived statuses (through the resolver where it exists).

**Then** call `DELETE /api/me` as P and assert:

1. **No trace of P anywhere.** Scan every `text`, `varchar` and `jsonb` column of every table in the `public` schema, found through `information_schema` so that **tables added later are covered automatically**. None contains P's device id, username, nickname or owner name. This is spec §10.8 test 14 in its strongest form, and it is the guard for "where *else* must this hold?".
   - **No exceptions.** Samuel chose (b) for flag 5, so `cats.owner_device_id` is cleared too.
2. **The cat is unchanged:** same sighting count, same name, the same ear-tip and name observation values, and the same derived sterilised and life status.
   - **The claimed cat:** `owner_name` and `owner_device_id` are now null. `home_description` is unchanged. `hasHome` and its derived life status are still `homed`, through the redacted `homed` observation (spine PR 4).
3. **The note is emptied** and the observation row is still there. The total number of observations is unchanged.
4. **Q is untouched:** Q's sighting, profile and credit are unchanged.
5. **Public output** shows *"a spotter"* (a null code) for P's sightings and discovery.
6. **A second call returns `204`** and changes nothing.
7. **The old id and secret now get `410`** on every device-authenticated route, including `POST /sightings`, and no profile or credential is recreated. This applies equally to `POST /cats`, `POST /cats/:catId/claim` and `PATCH /cats/:catId`, sent with the old id **and no secret**.
8. **A wrong secret gets `403`** and deletes nothing.
9. **Notifications:** a later sighting of the cat by Q sends nothing to P and writes no notification row for a null device.
10. **One transaction:** force a failure part-way (for example, make the profiles delete throw). Nothing is redacted.

**Also:**
- **The sightings guard** (once §5 lands): refuses deletes, updates other than resolve and redaction, and `TRUNCATE`, mirroring `dataSpine.test.ts`.
- **Logs:** a captured log of the delete request contains neither header.

**Mutation probes (required, because these guard silent failures).** Remove each of these in turn and confirm a named test goes red, then restore it:
- the sightings update;
- the note-emptying `case`;
- the notification null filter;
- the owner-name and owner-link clearing;
- the marker check, including moving it *after* the insert in `verifyDeviceSecret`;
- the secret check on each of the three cat routes.

A green suite alone doesn't prove the test would notice.

### 8.2 App (vitest)

- The confirmation screen: with the phone offline, the button is disabled and shows the E line. With unsent spots, it shows the B line with the right count. It always shows the A line under What stays.
- `deleteMyData`: on a failed server call, nothing is wiped. On `204`, every key in the "wiped" column of §6.2 is gone and every "kept" key survives. On `410`, the same wipe happens.
- The queue: `pauseAndClear` waits for an upload in progress **with no lock manager present** (the phone case), and an item added during the wipe does not survive. An unreadable ("read-only") queue is still wiped.
- Photo stores: native files, IndexedDB photos and queue backups are all empty afterwards.

### 8.3 By hand, before the PR opens (Samuel's standing rules)

In the browser pane on the web build, at about 390 px and at desktop width:
- delete a seeded spotter;
- confirm the Done screen, the new-spotter first-run step, and "a spotter" on the cat page from a second profile;
- then curl `DELETE /api/me` with the old credentials and see `204`, and curl `POST /sightings` and see `410`.

---

## 9. Decisions: decided by Samuel, 29 Sep 2026

The options and recommendations are kept below for the record. Each one ends with Samuel's answer.

**A. A cat the person *claimed* as its owner.** The spec lists what goes but is silent on owner claims.
- *Options:*
  1. Clear the owner link, the owner's name and the home description.
  2. Clear only the name.
  3. Keep them all.
- *Benefits and risks:*
  - Option 1 removes everything they typed. The privacy policy promises "anything you typed" goes, and "the blue house by the church" can point at a home. The cost is that the cat loses its owner and its home note, and nobody can edit it any more.
  - Option 3 breaks the promise.
- **Related ticket:** SYC-69 is already open, asking whether old owner names should eventually be redacted.
- *Recommendation was:* 1.
- **Decided: owner name and owner link cleared; home description kept.** Samuel first chose option 2 (name only). He then settled flag 5 as (b) on 29 Sep, which clears the owner link too.
  - **What this means for the cat:** it stays homed through its derived life status. Spine PR 4 makes `hasHome` come from that status, and the redacted `homed` observation keeps it. PR 4 is already a prerequisite of this build (§11). Nobody can edit the cat after deletion.
  - **What stays behind:** the home description. The privacy policy's promise that "anything you typed" goes doesn't cover it as worded (flag 6 in §10, resolved by rewording the policy).

**B. Spots on the phone that haven't been sent yet.**
- *Options:*
  1. Delete them with everything else, and add one line to the confirmation screen: *"You have 3 spots that haven't been sent yet. They'll be deleted too."*
  2. Send them first, then delete.
  3. Keep them and send them under the new identity.
- *Benefits and risks:*
  - Option 2 sounds kinder to the cats, but each spot arrives needing its owner to pick the cat, and after deletion there is no owner. They would sit forever as a photo and an exact position attached to no cat.
  - Option 3 carries the old person into the new identity, which undoes "start from zero".
- **Decided: option 1, as recommended. The copy is approved.**

**C. The "Fans" tile on a cat page** counts distinct people who have spotted the cat.
- *Options:*
  1. A deleted person stops counting, so the number can go down by one.
  2. Every unlinked sighting counts as one fan, so the number can go up.
- **Decided: option 1, as recommended.**

**D. The "deleted device" marker (§4.3).**
- *Options:*
  1. Keep a one-way hash of the deleted device id, so the identity cannot come back.
  2. Keep nothing.
- *Risk of 2:* a second browser tab or an interrupted delete silently recreates the person, and their next sightings are linked again.
- **Decided: option 1, as recommended.**

**E. Offline.**
- *Options:*
  1. Disable the button with the line *"You need a connection to delete your data."*
  2. Let them tap, then show an error.
- **Decided: option 1, as recommended. The copy is approved.**

---

## 10. Things to flag, and follow-ups to file

1. **Spec vs. decision: a migration is needed.** Data spine §11.2 step 8 says deletion "depends only on step 1's redaction column". Samuel's 29 September decision (Part 2g) corrects that. **Part 2g is not on `main`:** PR #18 was closed unmerged, so it exists only as a Linear comment. It needs a home in `DECISIONS.md`. This chip must not edit that file.
2. **The migration slot.** §5 needs one. `0002` belongs to SYC-98. The agreed queue is: `0002` SYC-98 → SYC-43 part 1 → SYC-101 → spine PR 3 (data only) → SYC-63 deletion. Numbers are not hardcoded; whoever merges second rebases and regenerates. All the schema changes in the queue must land before the Play closed test (F6).
3. **"Two taps".** The privacy policy says you can delete yourself "in two taps". The real path from the Profile tab is the row, then the confirm button: two taps, three counting the tab. Close enough, or reword the policy to *"from Settings"*.
4. **Follow-ups for Linear** (deduplicated before filing):
   - scrub device ids from request-log URLs on the notifications and push-token routes;
   - state how long database backups keep deleted data, in the privacy policy;
   - settle the delete-token expiry contradiction (email-capture §5.8 vs team-access §8.5), within SYC-45;
   - api-server tests on a throwaway database, needed by the sightings guard.
5. **Resolved (Samuel, 29 Sep 2026): (b), remove the owner link.** Deletion clears `cats.owner_device_id` as well as the owner's name. The "no query returns the device id" test now applies with **no exceptions**. A claimed cat stays homed through its life status (spine PR 4, already a prerequisite).
6. **Resolved (Samuel, 29 Sep 2026): reword the privacy policy.** The home description stays with the cat. `privacy-policy.md` keeps "anything you typed all go" and adds one line after the names sentence: *"If you told us a cat lives with you, the note about where it lives stays with the cat, but your name and your link to it are taken off."* The copy is approved along with the plan. No Greek or French version of the policy exists in the repo, so none needs updating yet; when one is written, it needs this line. Email-capture §6.3 still needs the approved A, B and E lines added (§1.2).

---

## 11. Rollout order

0. **Samuel approves this plan.** Decisions A to E and flag 5 were settled on 29 Sep. Flag 6 was also settled; the privacy-policy line is in this PR. Part 2g lands in `DECISIONS.md` through its own PR.
0a. **SYC-121's cutover must be complete and verified before this migration reaches production.** Until then it goes to the Neon `development` branch only. Its place in the queue is after #24 (SYC-98) and #28 (SYC-43 part 1), so it's regenerated on top of them when it's built. Then:
   - Run `db-ops` `migrate` against production **before** publishing the server code (the migrate-then-publish order in `docs/DEPLOYMENT.md` §C).
   - **Probe, don't assume:** Claude confirms, through the Neon MCP's read-only `run_sql`, that `pg_trigger` lists the `observations` and `sightings` guards by name, and that `pg_constraint` lists both checks.
   - Take a note of the time before running it. Neon's 7-day restore is the backstop, and the rollback block's warning (restoring `NOT NULL` fails once any row is redacted) still applies.
   - If Replit's Publish ever shows a database review, cancel it (SYC-121 R3).
1. **Data spine PRs 2, 3 and 4 are merged before this build starts** (`docs/superpowers/plans/data-spine.md`, PR #23).
   - **PR 2** delivers SYC-107: the claim, registration and rename secret checks that §4.3 depends on. It also makes a claim write a `homed` observation.
   - **PR 3** is the data backfill.
   - **PR 4** makes `hasHome` come from the cat's derived life status.
   - **Spine PR 5** (the location oracle) is **not** a prerequisite.
   - **Steps 2 to 7 are sequenced in the data spine plan,** `docs/superpowers/plans/data-spine.md` (branch `claude/data-spine-plan`, SYC-40 and SYC-52). This plan doesn't reorder them; it only says which of them must come first.
2. **The §5 migration**, in its slot, before the Play closed test. It is additive apart from the relaxed `NOT NULL`, so nobody notices anything.
3. **Server, read side:** nullable spotter codes, the fans rule and the notification filter. This is harmless on its own, because no row is redacted yet.
4. **Server, `DELETE /api/me`:** `severPerson`, the marker, the 410 handling and all the §8.1 tests. Deploy it, then probe it with curl against the deployed API. It is not reachable from any shipped app yet.
5. **OpenAPI and client regeneration.**
6. **App:** the row, the screen, the wipe and the 410 handling. Check in the browser pane at 390 px and desktop width. Ship it in the next build.
7. **Later, with their own tickets:** the email delete link (SYC-45) and the staff action (SYC-43), both calling `severPerson`.

**The PR that builds this** covers steps 3 to 6 and stays behind whatever release gate is current. CI on Node 24 and Linux is the authority. Local runs on this Mac may fail on native binaries (SYC-31).

---

## 12. Adversarial review, and what changed

One Sonnet critic reviewed this plan in its own worktree, checking it against the code on `main`. The full report is in `syc-63-self-service-deletion-review.md`, next to this plan.

| Finding | Severity | What we did |
|---|---|---|
| `POST /cats`, the claim route and `PATCH /cats/:catId` write a device id without checking the secret, so the "cannot come back" promise had a hole | Blocker | **Accepted.** §4.3 now makes the secret check on all three routes a precondition, with 410 tests and mutation probes |
| On phones, "wait for the upload" was a no-op, because the lock only exists on web | High | **Accepted.** §6.2 now keeps and awaits the in-progress sync promise, with a no-lock-manager test |
| The marker check has to come before the trust-on-first-use insert | Medium | **Accepted.** It is spelled out in §4.1 and §4.3, with its own mutation probe |
| No answer for an unreadable queue | Medium | **Accepted.** The raw key and the photo stores are wiped directly, with a test |
| "Six test files" should be seven | Low | **Fixed** |
| Token-expiry contradiction cited as email-capture §5.8 instead of §8.5 | Low | **Rejected.** "Delete tokens do not expire" appears in §5.8 (line 412) *and* in §9 (line 566), so the §5.8 citation is right. The reviewer's "§8.5" is also wrong: line 566 is in §9 |

The review confirmed several things:
- the plan's exact observations update passes the 0001 trigger;
- the proposed sightings "resolve" rule matches the app's only real update;
- `sightings.device_id` has no index today;
- the table-by-table claims in §2 are right.

## 13. Model delegation

This session runs on Opus. The design and the adversarial review are done. The build splits like this:

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| §5 migration: columns, checks, index, **sightings append-only trigger** and its rollback | **Opus** | Silent-failure territory: a wrong trigger either blocks the app's only legitimate update or lets history be rewritten, and the rollback is destructive | Trigger tests mirroring `dataSpine.test.ts`; `migrate:check` in CI; **mutation probe** on each trigger branch; adversarial review by a separate Sonnet critic in its own worktree |
| Move api-server tests to a throwaway database (needed by the guard) | Sonnet | Standard test-infrastructure work with a clear target | Whole suite green in CI; one deliberate `delete from sightings` in a test proves the guard fires |
| `severPerson`, `DELETE /api/me`, the marker, 410 in `verifyDeviceSecret`, and the secret check on the three cat routes | **Opus** | Deletes people's data. The transaction order, idempotency and the resurrection race are subtle | §8.1 tests, including the whole-database scan; mutation probes listed in §8.1; curl probe against the deployed API |
| Read-path changes (§4.5 table) | Sonnet | Mechanical once the column is nullable, since TypeScript lists every site | Typecheck; §8.1 tests 5 and 9; session-model spot review of the diff |
| OpenAPI path and orval regeneration | Haiku | Mechanical, following `.agents/memory/orval-codegen.md` | Typecheck across the app and client; diff spot review |
| App: `deleteMyData.ts`, `resetIdentity`, `pauseAndClear`, the photo-store wipe, 410 handling | **Opus** | The queue's lock ordering already broke once (offline-queue review); a wrong order uploads a sighting under a deleted identity | §8.2 tests; browser-pane click-through at 390 px and desktop |
| App: the Profile row, the screen, and English and Greek strings | Sonnet | Clear copy of record, existing styles, no typography changes | Screenshot at both widths; copy diffed word for word against email-capture §6.3; native-speaker review of the Greek before release |
| Final review before merge | Sonnet critic in its own worktree | Independent adversarial pass, per `/ship` | Findings folded in before merge |

No agent in this list spawns another. Each commits after every item and keeps a `CHECKPOINT.md`.
