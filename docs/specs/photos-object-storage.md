# Moving photos out of the database — spec

**Ticket:** SYC-46 (photos out of Postgres into object storage). Hosting itself is settled: SYC-47 closed on 24 Oct 2026 as "Replit for the app, Neon for the database; Supabase not adopted", with this move left to SYC-46 "after launch".
**Relates to:** [hosting-and-photo-storage.md](./hosting-and-photo-storage.md) §6–§7 (the earlier design; this spec supersedes its §7 and keeps its §6 rules) · [report-an-issue.md](./report-an-issue.md) · [DECISIONS.md](./DECISIONS.md) · [docs/runbooks/photo-removal.md](../runbooks/photo-removal.md) (SYC-462) · SYC-246 · SYC-276 · SYC-279 · SYC-403 · SYC-81 · SYC-677 · SYC-125
**Status:** **Draft for Samuel's approval, 25 October 2026, reviewed by an independent adversarial pass ([review](./reviews/photos-object-storage-review.md); every finding folded in).** Spec only. Nothing here is built, and nothing is built before launch (Saturday 31 October).
**Author's note on evidence:** every price below names its source page and the date it was read (25 Oct 2026). Anything I could not check is marked **unchecked**.

---

## 1. The short version

Every photo a spotter takes is stored as text inside our Neon database. That is the one cost in the app that only ever goes up, and it is the most expensive place to keep a picture. The plan is to keep the photos in a plain file store instead, and leave the database with the records only.

**What nobody will notice.** A cat's photo has the same web address before and after. The app does not change. Hidden photos stay hidden. Team-only photos stay team-only. Photos still have no location tag in them. If anything changes, photos may load a little faster.

**What it is worth.** Not a lot of money today, a lot of safety and tidiness later. At the planning volumes in §2 the saving is about **$17 a month at the 2027 season peak** (about $18 now stored against about $1 after) and under $2 a month today. The better reasons are the ones money doesn't show: a small database means quick backups, quick restores, quick copies for testing, and nothing slowing the records every time a photo is read.

**Recommended store:** **Cloudflare R2, EU jurisdiction** (§3). It is the cheapest of the realistic options, the data is guaranteed to stay in the EU, we already hold a Cloudflare account with an API token, and it costs nothing when photos are read. One step is needed from Samuel: the current token has no R2 permission (§3.5).

**The way it moves.** Eight small steps, each undoable, none needing downtime (§5). The old copy stays in the database for 30 days after the switch, so there is always a way back. The only step that is not instant is giving the space back in the database, and that one is rehearsed on a copy first.

**When.** The week after launch. The spec and approval can happen now so nothing about this is decided under pressure. There are **seven decisions** for Samuel in §8; the most important are whether to do this now at all (D0), the store (D1), the safety copy (D2) and what "Delete my data" should do with a person's photos (D5).

---

## 2. What we have today

### 2.1 Where photos live

Verified in the code on `main` at commit `61f53c42`:

| What | Where | Held as | Who can see it |
|---|---|---|---|
| Every spotter and cat photo, including vet-visit batch photos (SYC-677) | `photos.data` | base64 **text** (about a third bigger than the picture) | public, unless hidden, removed or team-only |
| Smaller copies: small (160 px), card (360 px), medium (640 px) | `photo_variants.bytes` | raw bytes | team routes only; made on first request, then kept |
| "Cat in trouble" report photos | `welfare_report_photos.bytes` | raw bytes | team only |
| Matching fingerprints (384 numbers per photo) | `photo_fingerprints.vector` | numbers, no picture | server only |

Three things that matter for the move:

- **Team-only batch photos live in the same `photos` table as public ones** (SYC-677). What keeps them private is a lookup (`teamOnlyPhotoIds`), not the table they are in. The earlier spec said restricted photos are "separate tables"; that is true for report photos, and no longer true for vet-visit photos. In a file store, the same lookup must still be what decides, because a bucket has no such rule of its own (§4.2).
- **Hiding a photo does not touch the bytes.** It is an add-only log (`photo_visibility_events`). "Deleting for good" (SYC-462) nulls `photos.data`, records who and why, deletes every smaller copy, and scans every column to prove the bytes are gone.
- **Nine files may read `photos.data`**, enforced by a test (`photoData.source.test.ts`): the photo route, the team report routes, the sightings matcher, the variant maker, the mail attachment, the coat reader, the spot-photo writer, the vet-batch search and the smoke check. **That test guards only `photos.data` and whole-row selects.** It does not guard `welfare_report_photos.bytes` (read in `teamReports.ts`, `mail/outbox.ts`, written in `reports.ts`), `photo_variants.bytes`, or raw SQL; those need the same guard (§5 step 1). The reading side is therefore the nine files *plus* those.
- **Writers of picture bytes are four, not one:** `spotPhotos.ts` (spots), `vetBatches.ts:248` (staged vet photos, also inside a transaction), `reports.ts` (report photos) and `photoVariants.ts` (smaller copies). Test helpers write them directly too.
- **Deletion has more than one path** (§4.4): `removePhoto` (SYC-462), the discard of a staged vet photo (`vetBatches.ts:339-346`, run by the daily `vet-batches-cleanup` workflow, which deletes plain rows and nulls ones that have visibility events), report photos going with their report by cascade, and the three-year report-photo retention.
- **"No picture" currently means "removed".** About eight places treat `data IS NULL` as "this photo was removed": the photo route, the matcher's `isNotNull(data)` filters in `sightings.ts`, the variant maker and its lock, the smoke check, the vet-batch search, the mail attachment and the removal tool's own search. Once a live photo can have no `data`, every one of them would wrongly treat it as removed. This is the single easiest way to break the move and §5 step 1 is mostly about it.
- **The old database and SYC-125's compare and carry-back read `photos.data`** (`switchover/fingerprint.ts`, `carryBack.ts`). From step 6, bucket-only photos would compare and carry back as empty pictures (§5 step 6).

### 2.2 How much, today

> **Production figures: requested, not yet received (open item before approval).** I may not query production, so on 25 Oct I asked the publish coordinator session to run a read-only size query: row counts and bytes for `photos`, `photo_variants` and `welfare_report_photos`; counts of hidden, removed and team-only photos; smaller copies per size; growth over 7 and 30 days; and how Neon meters the storage. The request was queued behind its current work and had no answer when this was written. Until it arrives, the only live figure on record is SYC-121's from **29 Sep: about 18 MB in total and 38 photos**, a tester-stage database that is a month out of date. **Every cost in §3.2 therefore rests on the planning volumes in §2.3 alone, and D0 asks Samuel not to start step 1 until real numbers are in.** The size is not what decides the design (the rules in §4 are the same at 38 photos or 60,000), but it decides how much a rehearsal proves and how long step 7 takes.

### 2.3 How much, later

The only volumes on record are the planning figures in `hosting-and-photo-storage.md` §2.1, and that spec itself says they are "asserted rather than derived" and on the generous side:

| | Now → March 2027 (low season) | 2027 season (Apr–Sep) |
|---|---|---|
| Installs | ~400 | ~6,000 |
| Photos | ~6,000 | ~60,000 in the season |
| Picture bytes | ~3 GB | ~35 GB cumulative |
| The same photos held as text in the database | ~4 GB | ~47 GB |

A stored photo is at most 2048 px on the long edge as JPEG, about **0.5 MB**; the three smaller copies add roughly 0.09 MB per photo (about 18%), unverified until the query returns. Two things will shrink these numbers and neither is built yet: the 12-month shrink rule (SYC-81, §6.7 of the earlier spec) and cats with several photos each (SYC-415, SYC-163), which push them up.

---

## 3. Where to store them

### 3.1 The four candidates

I looked at every store that plausibly fits our setup: Replit app, Neon database in Frankfurt, a Cloudflare account, GDPR with Syros Cats as the controller.

| | **A. Cloudflare R2, EU jurisdiction** | **B. Neon Object Storage** | **C. Amazon S3, Frankfurt** | **D. Replit App Storage** |
|---|---|---|---|---|
| Storage price per GB-month | **$0.015** | $0.023 | $0.0245 (first 50 TB) | $0.015 per GiB |
| Reading photos out | **free** | 500 GB a month included per project, then $0.10/GB | first 100 GB a month free, then about $0.09/GB (the page shows Ireland; Frankfurt **unchecked**) | $0.05 per GiB, counting uploads and downloads |
| Requests | $4.50 / million writes, $0.36 / million reads; 1M and 10M a month free | **unchecked** | $0.0054 / 1,000 writes, $0.0043 / 10,000 reads | $0.0004 and $0.005 / 1,000 (two kinds) |
| Free allowance | 10 GB-month storage | 5 GB (free plan only) | none for storage | none |
| Data stays in the EU? | **Yes, guaranteed**, if the bucket is created with the EU jurisdiction. Cannot be changed afterwards | Frankfurt is listed as available; "support is expanding toward all regions". The only worked example is us-east-2. **Needs confirming with a real bucket** | **Yes**, it is a region | **Unknown.** The page says it runs on Google Cloud Storage and does not say where |
| Maturity | Established | **Beta** (one source; its own pages don't say, **unchecked**) | Established, the standard | Part of Replit |
| Protection of the only copy | No versioning I could confirm (**unchecked**) | Versioning stored but not enforced; lifecycle rules stored but not run | Versioning, lifecycle and cross-region copy all exist | No versioning, lifecycle or retention |
| Fits our setup | Cloudflare account exists; token needs R2 added | Same vendor and bill as the database | New vendor, new account, IAM to learn | Closest to the app, but the bucket belongs to one Replit project |

**Sources, all read 25 Oct 2026:** R2 prices — [developers.cloudflare.com/r2/pricing](https://developers.cloudflare.com/r2/pricing/); R2 jurisdictions — [developers.cloudflare.com/r2/reference/data-location](https://developers.cloudflare.com/r2/reference/data-location/); Neon — [neon.com/pricing](https://neon.com/pricing) and [neon.com/docs/storage/overview](https://neon.com/docs/storage/overview); S3 — AWS's own published price list for eu-central-1, publication date 15 Oct 2026 (`pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/eu-central-1/index.json`; the S3 pricing page itself would not render); Replit — [docs.replit.com/billing/object-storage-billing](https://docs.replit.com/billing/object-storage-billing), [docs.replit.com/billing/aug-cloud-billing-updates](https://docs.replit.com/billing/aug-cloud-billing-updates), [docs.replit.com/cloud-services/storage-and-databases/object-storage](https://docs.replit.com/cloud-services/storage-and-databases/object-storage).

### 3.2 What each costs at the planning volumes

Photos are read out of the store by our API and sent on to phones, so every phone-bound byte is also billed as Replit outbound data at **$0.05 per GiB** ([Replit, from 1 Aug 2026](https://docs.replit.com/billing/aug-cloud-billing-updates)), under every option. That is the same bill as today, and the table below leaves it out.

**But the store's own read price is not irrelevant, and an earlier draft of this spec was wrong to say so** (found in review). Phones are only part of the reads. The matcher fetches up to ten candidate photos for every spot, and the coat reader, the fingerprint filler, the smaller-copy maker and the shadow week in §5 all read photos too. At 60,000 spots a season that could be a few hundred GB, **which I have not estimated** (it depends on cache hits and on the production figures in §2.2). R2 charges nothing for it and Neon includes 500 GB, so A and B are unaffected. S3 includes 100 GB a month and then charges per GB, and Replit App Storage charges $0.05/GiB on every download. That strengthens the case for R2.

| Per month, storage only (pictures plus the 18% for smaller copies) | Now (~3.5 GB) | 2027 season peak (~41 GB) |
|---|---|---|
| **Today: base64 in Neon** at $0.35/GB-month, ×1.33 for the text inflation on the originals | ~$1.65 | **~$18** (plus Neon's instant-restore charge, below) |
| A. R2 | ~$0 (inside the 10 GB free) | ~$0.47 |
| B. Neon Object Storage | ~$0.08 | ~$0.95 |
| C. S3 Frankfurt | ~$0.09 | ~$1.00 |
| D. Replit App Storage | ~$0.05 | ~$0.62, plus download charges |

The 10 GB free allowance on R2 is per account, so a second bucket for the safety copy (§5.8) costs the full ~$0.62 at peak, not a saving on top of it.

Three honest qualifiers:

1. **The price gap between "in the database" and "in a file store" is about 15–30×, not the "65×" on the ticket.** That figure predates Neon's $0.35/GB-month. Per [neon.com/pricing](https://neon.com/pricing), database storage is $0.35 against $0.023 for Neon's own file storage (15×), and against R2's $0.015 it is 23×, or 31× once the text inflation is counted.
2. **Neon also charges $0.20/GB-month for "instant restore" history** (up to 7 days on Launch; [neon.com/pricing](https://neon.com/pricing)). I could not tell from the page how much of a 47 GB table would be counted, so I have not added it. It matters in one place: nulling out every old photo is a very large change and will briefly raise the history charge (§5, step 7).
3. **The money is the weakest reason to do this.** At the low-volume end it is a rounding error. The reasons that hold at any volume are in §1: a small database restores and copies quickly (the 7-day restore, rehearsal branches and SYC-125's final fingerprint all get cheaper), reading a photo no longer pulls a 33%-bigger text blob through the database, and the cost can't quietly grow.

### 3.3 Why not the others

- **D. Replit App Storage.** The EU question is a stopper: the page does not say where the data is held, and a charity's photos with Syros Cats as controller can't sit somewhere we cannot name. It also can't use versioning, lifecycle or retention, and a bucket belongs to one Replit project, which sits badly with SYC-125 retiring the old project and with development and production sharing it. If Replit says in writing that the bucket is in the EU, D becomes a realistic fallback; until then it is out.
- **B. Neon Object Storage.** Attractive on paper: same vendor, same bill, Frankfurt listed. Three things hold it back: it appears to be in **beta** (not stated on its own pages: **unchecked**); its public address in every example is `us-east-2`, so the Frankfurt claim needs proving with a real bucket; and **buckets are scoped to a database branch, and a new branch inherits the parent's objects**. We create branches all the time (development, rehearsal, test copies), so every test copy would inherit every production photo. That is a privacy leak by design, not a bug, and it is the deciding point against B for now.
- **C. S3, Frankfurt.** The safest and most mature choice, and the one with real protection for the only copy (versioning, lifecycle, cross-region copy). It costs about $0.45 a month more than R2 at peak, and needs a new AWS account, billing and permissions that Claude can't currently manage with the Cloudflare token. It is the right answer if D2 (§8) comes out as "we want the provider to keep old versions for us".
- **A. R2.** Cheapest, the EU guarantee is a setting on the bucket, and the Cloudflare account and API route already exist. Its gap is the one in the table: no object versioning I could confirm, so protecting the only copy is something we build (§5.8) rather than something we switch on.

### 3.4 Recommendation

**A. Cloudflare R2 with the EU jurisdiction: one private bucket for cat photos and a separate one for report photos, with a safety copy at a different provider (§5.8, D2), all served only through our API.** Reason in one line: it is the cheapest, the EU guarantee is explicit, it is the account we already have, and the one thing it lacks (versioning) is cheap to build around. If Samuel would rather pay about $0.45 a month more to have versioning from the provider, C is the alternative and the spec works unchanged, because the storage code is written against the S3 interface that both speak.

### 3.5 Checks I made on our Cloudflare account (read-only, 25 Oct 2026)

- The token at `~/.cloudflare/api-token` is **valid and active**.
- It **cannot list R2 buckets**: Cloudflare answers "Authentication error" (code 10000). So the token has no R2 permission today, or R2 is not turned on for the account. **Unchecked which.** Either way the first step of the build is Samuel running `~/.cloudflare/store-api-token.sh` to add R2 (and, on the Cloudflare dashboard, accepting R2 if it is off — it needs a payment method on file, even though the first 10 GB is free).
- Zone `catspotters.com` is on the **Free** plan and active. `www`, `admin` and the apex are proxied by Cloudflare; **`apptest.catspotters.com`, the API host as of today, and `team.catspotters.com` are "DNS only", not proxied**. So no Cloudflare cache or CDN sits in front of the API today, which matches what SYC-276 assumes. (I saw no `api.` record in the zone; the launch address is **unchecked**.)

---

## 4. Rules that must survive the move

These are the promises the app makes today. Each one is listed with where it is enforced now, how that changes, and the test that pins it.

### 4.1 Photos are served by our API, never straight from the bucket

The bucket is **private**. There are no public links to it, no `r2.dev` address, no custom domain on it, and no signed expiring links. Every photo, public or not, is read by our API and streamed to the phone.

Why this is not negotiable: *every* privacy rule below (hidden, team-only, removed) is checked by the API at the moment of the request. A bucket address that bypassed the API would bypass all of them. Signed links were also rejected earlier (DECISIONS.md F7a) because they expire exactly when a spotter is out of signal.

What it costs: all photo traffic keeps going through Replit and is billed at Replit's $0.05 per GiB. At the busiest planned month (~120 GB) that is about $6, which is the same cost as today. A shared cache or CDN in front of photos is **not** part of this work, because it would break the hide rule (SYC-276 option 3 is the plan if one is ever added).

### 4.2 Hidden photos are never public. Team-only photos stay team-only.

- **Enforced today** by `hiddenPhotoIds`, which already counts removed photos *and* team-only photos as hidden, so every public reader is covered with no reader of its own. The public photo route answers a hidden, removed, team-only or unknown photo with the **same** 404 and `no-store`, so the answer never says a photo exists.
- **After the move:** unchanged. The rule runs on the database record **before** the bucket is touched. The route order is fixed: look up the row, ask `hiddenPhotoIds`, and only then fetch the object. A photo that is hidden never causes a bucket read, which also means a hidden photo cannot be detected by how long the reply takes (a timing probe in §7).
- **The bucket knows nothing about hidden or team-only for cat photos.** Object names are random and carry no meaning (§4.3). There is no `public/` and `private/` folder split to get wrong, because a split would invite someone to read the folder instead of asking the API.
- **Report photos (`welfare_report_photos`) go in their own bucket with their own token,** read only by the team report route behind the dashboard session. They are the most sensitive images we hold, and a leaked token for the cat-photo bucket must not reach them.
- **Test:** the existing hide, restore and team-only tests run against the in-memory store *and* against a real bucket in the rehearsal (§7). New: a team-only photo and a hidden photo are each requested through the public route in both read modes and must return the same 404 as an unknown id.

### 4.3 Photos have no location tag, and nothing identifies who took them

- **Today:** `validatePhotoBase64` re-encodes every upload with `sharp`, which drops all metadata including GPS (tests: `imageValidation.exif.test.ts`, `photoVariants.exif.test.ts`). Report photos and vet-batch photos go through the same helper.
- **After the move:** the storage code accepts only bytes that came out of that helper (its type says so), so nothing can be stored that skipped the strip. Objects are written with **no extra metadata** beyond the content type: no original filename, no device id, no person id, no sighting id. Object names are a random UUID (`photos/<uuid>.jpg`), generated by us, and are not the public id, so neither can be derived from the other.
- **The backfill adds a check, not just a copy:** every moved photo is read back and run through `sharp(...).metadata()`; a photo that still carries an EXIF block or GPS tags is **not** marked moved, and is listed for a decision instead. (Old photos should all be clean; this proves it.)
- **Test:** the existing two EXIF tests, plus a new one that stores a photo with GPS in the in-memory store and in the real bucket and downloads it directly, asserting no GPS tags in what comes back.

### 4.4 Deleting a photo for good deletes its object (SYC-246, SYC-462)

This is the rule that gets harder, and the review found the first draft of it was not enough.

- **Today:** SYC-462's `removePhoto` is one database transaction: null the bytes, record who and why, delete the smaller copies, repoint cats, then scan every column to prove the picture is gone. Either all of it happens or none of it.
- **The problem:** a file in a bucket can't be part of a database transaction. Delete the file first and a failed database step leaves a record with no picture and no way back. Delete it after and a failed delete leaves the photo on disk after the team was told it was gone.
- **The rule after the move: record first, delete second, verify third.** In the same transaction that removes the photo, write a row to a new table, `photo_object_deletions`: every key to delete (the main object *and* the smaller copies *and* the safety copy), when it was asked for, and when each was confirmed gone. After the commit the objects are deleted, each is asked for again to prove "not found", and the row is stamped. A **sweeper** retries unconfirmed rows every few minutes and alerts after an hour. Keys are written to the row at removal time because the photo row's own `storage_key` is cleared when it is removed.
- **Every deletion path uses that one routine,** not just `removePhoto`. There are four today and the first draft knew of one:
  1. `removePhoto` and the coming "Delete for good" button (SYC-246);
  2. the discard of a staged vet photo (`vetBatches.ts:339-346`, run daily by `vet-batches-cleanup`), which deletes a plain row or nulls one that has visibility events, today with no removal record at all;
  3. a report photo going with its report by database cascade (`welfare_report_photos` → `welfare_reports`, plus SYC-478 and the three-year retention rule): a cascade can't write a deletion row, so the cascade is replaced by an explicit delete in the same module;
  4. the 12-month shrink (SYC-81, not built), which replaces an object with a smaller one.
  A **source test** bans `delete(photosTable)`, `delete(welfareReportPhotosTable)`, `delete(photoVariantsTable)` and setting `data` or `bytes` to null anywhere except that module, the way `photoData.source.test.ts` bans stray readers today.
- **A removal must beat a backfill or a new upload.** Backfill and dual-write take `FOR KEY SHARE` on the photo row before they write an object and re-check `removed_at` after the write, exactly as `variantFor` and `saveFingerprint` already do. If the photo was removed in between, the writer deletes the object it just made. The same lock guards the smaller copies, so a copy being made while a removal runs does not survive it.
- **A scheduled reconciliation, not a one-off.** Daily, a job lists every object in each bucket, finds the ones no row points at and no deletion row covers, waits 24 hours (so an in-flight upload isn't deleted), and then reports and deletes them. It also finds rows whose object is missing. Both counts are alerts. Orphans are expected at a low rate (a sighting that rolled back after its object was written); a rising count is the signal.
- **The removal tool needs new inputs.** SYC-462's tool runs in GitHub Actions (`db-ops.yml`) with only database credentials. It reads `data` to fingerprint the picture (it would fail on a bucket-only photo) and its `GONE` verdict, and the runbook's curl check, come from the database row alone and can't see a surviving object. After the move it must: read the picture from the bucket for the fingerprint; hold the bucket credential in the `production` GitHub environment (a narrow token, §5 preface); and issue **`GONE-PENDING-OBJECT`** until every key in the deletion row is confirmed "not found", with `GONE` only after. Runbook steps 6, 7, 10 and 12 change to match. Removal is "removed, deletion confirmed" or "removed, waiting to confirm", never just "removed".
- **What we cannot reach:** Neon keeps up to 7 days of restore history, so a removed photo's bytes can sit in an old restore point for a week. That is already true today and is a line for the privacy policy. And any **restore of a database snapshot taken before a removal brings the bytes back and un-hides the photo**; the runbook's "After any restore" step (re-run the removals) applies to every rollback in §5 that restores a snapshot.
- **Test:** removal with the bucket failing (row removed, deletion pending, sweeper finishes it); database step failing (object untouched); a run twice (no change); removal racing a backfill and racing a smaller-copy maker (no surviving object); each of the four paths above leaves a deletion row; and the source test.

### 4.5 "Delete my data" — what actually happens to photos, and what must not change

The brief for this spec listed "Delete my data removes a person's photos" as a rule to preserve. **That is not what the code does today, and it is a decision on purpose.** `severPerson.ts` (verified 25 Oct) separates the person from their records: their sightings stay "with the photo", cats they discovered credit "a spotter", and their reports stay "with the photo, as the cat's history" (decided 30 Sep, `cat-record-data-spine.md` §8). A person's photos of a cat are part of the island's record of that cat.

So the rule that must survive the move is the one that exists: **the photo's picture carries nothing that identifies the person (§4.3), so cutting the link to them leaves nothing in the file store to cut.** The move adds no copy of anyone's identity to the bucket and changes nothing about this flow.

What *is* possible, and not built: a person whose face or doorway is in a photo can already ask for removal, and since 24 Oct that request goes to Samuel through the by-hand route or SYC-246's button. Whether "Delete my data" should also offer "and remove my photos" is a real choice, listed as **D5**.

### 4.6 Caches (SYC-279, SYC-276)

- **Today:** public photos go out with `Cache-Control: private, max-age=31536000, immutable` (SYC-279 closed, Decision 1: shared caches never keep photos). A phone that has loaded a photo may keep it for a year. Hiding cannot recall that copy and the privacy policy is meant to say so (SYC-276, open).
- **After the move:** identical headers, set by our route, not by the bucket. The bucket sends nothing a browser ever sees, because browsers never talk to it.
- **Things that interact:** the 12-month shrink rule (SYC-81) writes a *new* object for a photo; the public id stays, so a phone's old cached copy is simply the larger one until it expires. Photos can be replaced under the same address, which is what `immutable` lies about; this is already true in the database today and is accepted.
- **Not to be done as part of this:** a CDN or a custom photo domain (SYC-276 option 3). R2 makes it technically easy, which is the reason to write the ban down.
- **Test:** the header test on the photo route runs in both read modes and asserts the exact header; a probe checks the bucket's own address from outside returns "denied".

### 4.7 Smaller copies and the matcher keep working

- Small, card and medium copies are regenerable from the original, so they are not backfilled one by one. After the switch their database rows are dropped and the next request re-makes them and stores them as objects named from the photo's own key (`photos/<uuid>/<size>.jpg`). They are made under the same `FOR KEY SHARE` lock as today (§4.4), and every removal lists the main key **and all three copy keys** in its deletion row, whether or not a copy exists yet. The "do not retry a photo that cannot be decoded on every request" point from SYC-404/403 is handled in the same place.
- The AI matcher, the coat reader, the fingerprint filler and the vet-batch search currently read photos straight from the database. Everything moves behind `loadPhotoBytes(photoId)`, with fetches in parallel and a small in-memory cache, because ported naively ten candidate photos in series would mean ten round trips on a request a spotter is waiting for. **Target:** at most +300 ms at the 95th percentile on the match request. That number is carried over from the earlier spec, not measured; the rehearsal measures it (§5 step 0). `loadPhotoBytes(0)` stays "no photo", the existing sentinel, and it distinguishes **removed**, **missing** and **error** instead of returning null for all three.
- The photo route today reads the whole picture and sends it with Express's automatic validator. A route that streams from the bucket loses that, so it sends an `ETag` made from the stored SHA-256 and answers `If-None-Match` with 304, and a test pins it (`photos.etag.test.ts` exists today).

---

## 5. How we move them

**Principles.** One step at a time. Each step can be undone and says how. Nothing is deleted until the step after it has run clean for 30 days. Nothing needs the app to go down, with one stated exception (step 7). All database changes go through the normal `db-ops` migration workflow (DEPLOYMENT.md §C), migrate first, then "don't republish yet" until the code is ready.

**The switches, and how each one is flipped.** Two settings, both rows in `app_settings` changed by `db-ops set-setting`, **not** environment variables, so flipping one needs no republish: `photo_write` (`db`, `dual`, `object`) and `photo_read` (`db`, `shadow`, `object`). Each server re-reads settings every 60 seconds (`SETTINGS_CACHE_MS`), so a flip takes up to a minute to reach every server; the spec says "within a minute", not "next request".

**Before anything (Samuel, ~15 minutes):** add R2 to the Cloudflare token (§3.5); decide D0–D6; put Cloudflare in the privacy policy as a processor (§6.1).

**Credentials.** Three narrow bucket tokens, nothing wider: the **app token** (read and write the cat-photo bucket), the **report token** (read and write the report-photo bucket), and the **copy token** (§5.8). The removal tool, the backfill, the smoke check and the fingerprint-accuracy command run in GitHub Actions with database credentials only today; the ones that read or write photos get the app and report tokens in the `production` GitHub environment. **Rehearsal, development and any reset copy must never hold a production bucket token** and use their own test buckets: a database branch copies `storage_key` values and pending deletion rows, and a sweeper running on a copy with a production token could delete production objects.

### Step 0 — Rehearse on a copy
Use the existing `rehearsal` Neon branch (or a point-in-time restore to a new branch), not a child of production: Neon snapshots and restores only work on a root branch (`docs/runbooks/neon-database.md`), so a plain child branch can't run the restore this step has to prove. Create test buckets in the EU. Run steps 1–7 end to end, including the space reclaim in step 7, the `rehydrate` script and a snapshot restore **followed by the runbook's re-removal step**. **Exit:** the sequence has run once, the reclaim time and the photo latencies are measured, and each rollback below has been exercised. **Rollback:** delete the test buckets and reset the branch.

### Step 1 — Prepare (invisible to users)
One migration, then the code, with `photo_write=db` and `photo_read=db` so behaviour is exactly as before:
- Adds, all nullable: `photos.storage_key`, `photos.size_bytes`, `photos.sha256`, `photos.moved_at`; `storage_key`, `size_bytes`, `sha256`, `moved_at` on `welfare_report_photos` and `photo_variants`; and the `photo_object_deletions` table. (**Not** `bytes`: `welfare_report_photos.bytes` and `photo_variants.bytes` already exist and hold the picture.)
- **Drops NOT NULL** on `welfare_report_photos.bytes` and `photo_variants.bytes`, each with a check that a row has bytes **or** a key.
- **Replaces `photos_removed_ck`** so that a live photo needs *either* `data` *or* `storage_key`, and a removed photo has neither. It is added `NOT VALID` and then validated, so the table scan doesn't hold a heavy lock (the migrate runner gives up after 5 seconds rather than queueing behind live requests).
- **Moves every "is it removed?" decision from `data IS NULL` to `removed_at IS NOT NULL`** in all eight places listed in §2.1, with a source test that bans `data IS NULL` and `isNotNull(...data)` as a removal test. Without this, the first bucket-only photo looks removed and 404s.
- Adds `loadPhotoBytes(photoId)` and a storage module with an in-memory version (tests and every laptop; no one needs a Cloudflare key to run the suite), moves the nine readers and the report and variant readers behind it, extends `photoData.source.test.ts` to cover `welfare_report_photos.bytes`, `photo_variants.bytes` and raw SQL, and routes all four writers and all four deletion paths (§4.4) through the storage module.
- **Rollback:** `migrate-rollback` removes the new columns and table, after the code is reverted first (new code on the old schema 500s; DEPLOYMENT.md §C). **From step 6 onward the app cannot be rolled back to a build older than this step's**: an older build would treat every bucket-only photo as removed.
- **Exit:** the whole existing suite passes in memory mode; the new source tests pass.

### Step 2 — Dual write
- A **new** photo is written to the bucket first, with the row locked `FOR KEY SHARE` and `removed_at` re-checked after the write (§4.4), then one insert carries `data` *and* `storage_key`, `size_bytes` and `sha256`. The key is chosen by us before the row exists, so a crash can't leave a row with neither bytes nor key. **The bucket write is done before the database transaction opens**, never inside it, so a slow bucket doesn't hold a connection; an upload whose transaction then rolls back leaves an orphan, which the daily reconciliation (§4.4) removes.
- Bucket down: write `data` only, log loudly (never log a photo id), and a retry job pushes it later. A spotter never loses a sighting because of a bad minute at the provider.
- Reads still come from the database. **Rollback:** `photo_write=db`.

### Step 3 — Backfill, in batches
- A script, safe to stop and re-run at any moment: oldest first, 100 photos per batch, a pause between, in the Athens night, through `db-ops`.
- Per photo and per report photo: lock `FOR KEY SHARE`, decode, compute SHA-256, write the object, **read it back and compare**, run the metadata check (§4.3), re-check `removed_at`, record `storage_key`, `size_bytes`, `sha256`, `moved_at` with a conditional update. **Nothing is deleted.** If the photo was removed meanwhile, delete the object just written.
- Hidden, team-only and report photos are moved like the rest, protected by the route, not by being left behind (§4.2). Removed photos have no bytes and are skipped. Smaller copies are not copied (§4.7).
- **Rollback:** stop the script. The database copy was never touched; stray objects are found by the reconciliation.

### Step 4 — Verify, before switching
A report that a human signs off:
- every live photo has a key; row counts, and counts by state (public, hidden, team-only, removed), are equal before and after;
- zero checksum mismatches; zero photos with metadata;
- a fresh random 5% re-downloaded and compared, plus every photo over 1 MB;
- stored totals match the byte count Postgres reports for the same rows.
**Rollback:** none needed; nothing has switched.

### Step 5 — Switch reads, carefully
1. **Shadow week** (`photo_read=shadow`): every request is answered from the database as today while a second read from the bucket runs in the background and is compared. A difference is an alert. It costs a little compute and finds problems at no risk to anyone.
2. **Read from the bucket** (`photo_read=object`), falling back to `data` and alerting if an object is missing. **Rollback:** `photo_read=db`, within a minute, no deploy, because `data` is still there.

### Step 6 — Switch writes
New photos go to the bucket only. Only after reads have been clean for 7 days **and the safety copy (§5.8) is running**, because from here the bucket is the only copy of newer photos.
- **Rollback:** `photo_write=dual`. Photos written meanwhile exist only in the bucket, which is why this is a later step than reading.
- **Side effects to deal with first:** SYC-125's compare and carry-back read `photos.data` (`switchover/fingerprint.ts`, `carryBack.ts`) and the old database is kept 30 days after the Neon cutover; bucket-only photos would show there as empty pictures. If the old database is still around at this point, SYC-125's carry-back is told to skip pictures with a key, or the old database is retired first. The smoke check and `fingerprint-accuracy` get the app token (or read through `loadPhotoBytes`).

### Step 7 — Give the space back (the one step that is not instant)
Only after **30 days clean** on step 6 and a Neon snapshot that has been restored once as a test:
1. Null `photos.data` and the report and smaller-copy bytes in batches, **with `WHERE storage_key IS NOT NULL AND sha256 IS NOT NULL`**, so a row that fell back to `data` during an outage is skipped, not an abort. Expect Neon's restore-history charge to rise for up to 7 days (§3.2).
2. **Nulling does not make the database smaller.** The space comes back only by rewriting the table. **`VACUUM FULL` is not the plan:** it takes the heaviest lock on `photos`, and everything touches `photos` (the hidden-photo check, every cat list, new sightings, the fingerprint lock, the mail drain), so the whole app would stall, and a queued request for that lock blocks every later query behind it, which can exhaust the connection pool. **The plan is a slim table built beside it** (same rows without the picture columns, kept in step during a catch-up, then swapped in a moment), rehearsed in step 0. `VACUUM FULL` is used only if the rehearsal shows it takes seconds, in a stated maintenance window with the app in maintenance mode. `pg_repack` would avoid the lock but is probably not available on Neon (**unchecked**). **This is the one step where "zero downtime" is not guaranteed.**
3. Check the bill moves, not just the table: record sizes before and after, and the next invoice.
- **Rollback:** `rehydrate`, a script that copies bucket objects back into `data` for every row (built and tested in step 0). Slower than a switch, and exercised before it is needed. A snapshot restore also works but brings back the `data` of photos removed since and un-hides them, so the runbook's re-removal step follows it.

### Step 8 — Drop the columns
After a further 30 days, a migration removes `photos.data` and the byte columns. Dropping `data` also drops the multi-column check that ties "removed" to "no bytes", so the same migration **adds a replacement**: a removed photo has no `storage_key`, and a live one has one. The "bucket down, write `data` only" fallback from step 2 **no longer exists**, so an upload during an outage fails with the app's normal retry message; the offline queue already retries, and that is accepted. The down-migration re-adds nullable columns with the relaxed check from step 1; getting the pictures back after this point is `rehydrate`.

### 5.1 Calendar (proposal, subject to D0 and D6)
Launch Sat 31 Oct → one week with no photo changes → **Mon 9 Nov**: step 0 and 1 → step 2 live by ~13 Nov → backfill and verify the week after → shadow week → reads switch in early December → writes a week later → space reclaimed about mid-January 2027, well before the April season. SYC-46 sits in "Phase 2b (mid-November)" in Linear; the real finish line is January.

### 5.8 Protecting the only copy

After step 6 a lost bucket means lost photos. The Cloudflare account could be suspended, a token leaked or revoked, or a bucket deleted by mistake. A second bucket **in the same Cloudflare account does not protect against the first two**, so the first draft was wrong to claim it did.

The **safety copy (D2)** therefore lives **at a different provider or in a different account**: the natural choice is a small **Amazon S3 Frankfurt** bucket (about $1 a month at peak, §3.2), which also gives us real versioning. Details:
- A nightly job copies new objects; it uses the **copy token**, which can read the main bucket and write the copy.
- **Deletions are the sweeper's job, not the copier's.** The same sweeper that deletes a main object (§4.4) deletes the safety copy in the same pass, and "confirmed" means *every* location returns not-found. The copier skips any key that has a deletion row. The daily reconciliation covers the copy too. (R2 tokens, as far as I know, cannot be granted "write but not delete"; whether the S3 side can is a point to settle in the build and it does not change the design: the sweeper, not the copier, is the only thing allowed to delete.)
- **If the copy has versioning on, old versions must also be removed on a deletion**, or "deleted for good" would not be; the sweeper deletes every version.
- It backs a rule for the privacy policy: removed photos leave backups within a day.

---

## 6. What changes for people

| Who | What changes |
|---|---|
| Spotters (tourists, locals, guardians) | **Nothing visible.** Same addresses, same pictures, same offline behaviour (the offline queue holds files on the phone and uploads through the same route). Photos should load about as fast and may be slightly faster for large cat pages: the database no longer has to read and unpack a text copy of each. This is a hope, to be measured (§7), not a promise. |
| Syros Cats team | Nothing, except two things worth knowing: **"Delete for good" will say "deleted, waiting to confirm" for a few seconds to minutes** before it says confirmed (§4.4), and the dashboard's queue thumbnails may load a little faster once report photos have smaller copies (SYC-403). |
| Cat guardians | Nothing. |
| The person asking for a removal | Same promise as today, with a confirmed deletion rather than a database edit. |
| Fair Shake (us) | A new account to look after (Cloudflare R2 plus a second bucket), a new background job (safety copy), a new sweeper, and a much smaller database. |

### 6.1 Legal and policy work this needs (owned elsewhere, but it blocks step 2)
- **Cloudflare as a processor** named in the privacy policy (`privacy-policy.md`) and in the Syros Cats ↔ Fair Shake data agreement, before any real photo goes in the bucket. We already use Cloudflare for the website, so this may already be in place: **unchecked** — the privacy-policy page I read does not name any processors.
- The Play data-safety form and the Apple privacy labels must still match where photos are kept.
- The line about caches (SYC-276) and the 7-day restore window (§4.4) go in the policy at the same time.
- **Photos remain in the EU** at every step, including the rehearsal bucket and the safety copy. The jurisdiction can't be changed after a bucket exists, so each bucket is created with it, never later.

---

## 7. Tests and probes

**Automated tests (written first, run in memory, in CI):**
1. Storage module: put/get/delete/exists, rejects bytes that did not come from the strip helper, writes no extra metadata.
2. Route: hidden / removed / team-only / unknown ids give the identical 404 and `no-store` in `db`, `dual`, `shadow` and `object` modes; header exactly `private, max-age=31536000, immutable`; a hidden photo never triggers a bucket read.
3. `photoData.source.test.ts` tightened: only the storage module reads bytes.
4. Removal (§4.4): pending → swept → confirmed; DB failure leaves the object alone; idempotent re-run; every copy listed.
5. Write order: a crash between the bucket write and the insert leaves an orphan object, never a row without a picture; bucket down falls back to `data`.
6. EXIF: GPS-bearing upload comes back clean from the store, for every size and for report photos.
7. Backfill: re-runnable, resumes, skips removed photos, refuses to mark a mismatch.
8. Matcher parallel fetch: same results as before the change, with a latency check.
9. Schema: the relaxed `photos_removed_ck` still forbids a removed photo that has bytes or a key; a live photo with neither is refused.
10. Races: a removal during a backfill, during a dual-write and during a smaller-copy maker each leave no surviving object (hooks like the existing T15 ones).
11. Source tests: no `delete(photosTable)`, `delete(welfareReportPhotosTable)`, `delete(photoVariantsTable)` or null-ing of picture columns outside the storage module; no `data IS NULL` or `isNotNull(...data)` used as a removal test; no reader of `welfare_report_photos.bytes` or `photo_variants.bytes` outside the storage module.
12. Every one of the four deletion paths (§4.4) writes a deletion row; the sweeper deletes both locations and the copier skips a key with a deletion row.
13. The photo route sends an ETag from the stored checksum and answers 304 to `If-None-Match`.
14. The removal tool: `GONE-PENDING-OBJECT` until every key is confirmed absent.

**Probes against the real thing (rehearsal first, then production), each a few requests only (the port rule: no high-volume loops):**
- the bucket's own address from outside returns "denied"; no `r2.dev` address is enabled;
- a hidden photo and a team-only photo through the public route: same 404, and reply times indistinguishable from an unknown id (20 requests each);
- a deleted photo's key returns "not found" on the bucket directly;
- download one photo from the bucket by key and read its metadata: none;
- photo list latency before and after, for a cat page and a match request;
- the reconciliation report: objects with no row, rows with no object, both must be empty.

**Failure drills (rehearsal):** revoke the token mid-backfill (backfill stops, nothing breaks); take the bucket "offline" in shadow mode (alerts, still serving from the database); run `rehydrate` on the whole rehearsal set; restore the Neon snapshot.

**Things I would watch for after each step:** photo route error rate and 95th percentile; bucket reads and writes against the free tier; Neon storage and history; the pending-deletions count; and Replit outbound data.

---

## 8. Open decisions for Samuel

Presented in plain English with a recommendation each. I need D0–D4 to plan; D5 and D6 can follow.

### D0 — Do this at all yet?
The approved earlier decision (`hosting-and-photo-storage.md` §4.2, DECISIONS.md Part 2e) said: decide on 15 Nov 2026 with two months of invoices, real photo volume and a dated restore test; if nobody decides, **photos stay in Postgres through the 2027 season**. On 24 Oct SYC-47 closed and said moving photos "stays with SYC-46, after launch", which settles the hosting half of that trigger. It does not settle whether the move is worth doing now. Of §4.2's inputs: the invoices and the real volume are **not yet in** (§2.2), and the dated restore is not recorded here (**unchecked**).
- **Go: build from 9 Nov, as in §5** *(recommended)*. A spec like this one makes the work routine; it is much safer done at a few thousand photos than at 60,000, the saving arrives with the season, and the privacy rules (§4) are easier to get right with a small corpus. **Risk:** launch-month attention goes to a change that saves about $1 a month today.
- **Wait for the 15 Nov review as planned, then decide** with the real numbers. **Risk:** the build starts about a week later.
- **Stay in Postgres through 2027** (the original default). Costs about $18 a month at the season peak and a slower, larger database. **Risk:** the move, when it comes, is bigger and happens mid-season.
**Recommendation: go, but let the production figures in §2.2 and the 15 Nov review confirm it before step 1 starts.**

### D1 — Which store?
- **A. Cloudflare R2, EU** *(recommended)*. Cheapest (~$0.40 a month at peak), the EU guarantee is explicit and permanent, the account exists. **Risk:** no built-in way to keep old versions, so we build the safety copy ourselves; and the token needs R2 added (a 3-minute job for you).
- **B. Neon Object Storage.** Same bill as the database. **Risk:** looks like a beta; Frankfurt must be proven; and test copies of the database would inherit every production photo.
- **C. Amazon S3, Frankfurt.** The most proven, with versioning built in. **Risk:** about $0.45 a month more at peak, a new account and permissions to set up.
- **D. Replit App Storage.** The easiest to wire in. **Risk:** nobody has said where the data is held, and no versioning.
**Recommendation: A.** C if you would rather pay the small extra for provider-side versioning.

### D2 — A second copy for safety?
- **Yes, a nightly copy at a different provider: a small Amazon S3 Frankfurt bucket** *(recommended)*. About $1 a month at peak. Protects against a suspended Cloudflare account, a leaked token or a mistaken delete (a second Cloudflare bucket would protect against only the last). **Risk:** a second place holding every photo, so every deletion must reach it too (§4.4, §5.8), the privacy policy names a second processor, and it is one more account for the charity to own.
- **A second R2 bucket in the same account.** About $0.62 at peak. **Risk:** it does not survive the account being suspended or a token leaking, which are the likely failures.
- **No second copy; rely on the 30 days with `data` still in Neon, then nothing.** Free. **Risk:** from step 6 the bucket is the only copy of newer photos; one bad day loses volunteers' photos for good.
**Recommendation: yes, S3 Frankfurt, with deletions done by the sweeper (§5.8). It must be running before step 6.**

### D3 — Serve through our API only, or put a cache/CDN in front?
- **API only** *(recommended)*. Keeps every privacy rule in one place; costs roughly what we pay now (~$6 a month at the busiest month). **Risk:** photo traffic keeps loading our app server.
- **Cloudflare cache in front of photos.** Faster and cheaper bandwidth. **Risk:** a hidden photo stays served from the cache until someone purges it (SYC-276), and a purge is a new thing that has to be built and probed.
**Recommendation: API only. Revisit after the 2027 season with real numbers.**

### D4 — What moves, and in what order?
- **Everything, in one project, cat photos first** *(recommended)*: cat and sighting photos, vet-batch photos (they are in `photos`), then report photos, then the smaller copies (regenerated rather than copied). One storage module, one set of rules, one rehearsal.
- **Cat photos only; leave report photos and copies for later.** Smaller job. **Risk:** two storage systems for photos forever, and the report photos (the most sensitive images we hold) stay in the database.
**Recommendation: everything, cat photos first.**

### D5 — Should "Delete my data" also remove a person's photos?
Today it does not (§4.5). The photo has no link to the person afterwards.
- **Keep as is, and tell people plainly** that photos of cats stay as the island's record but carry nothing about them; anyone in a photo can ask for it to be removed *(recommended)*. **Risk:** someone expects "delete my data" to mean "delete my photos" and is surprised.
- **Offer "also remove my photos" as a request** that goes to the team through the SYC-246 button. **Risk:** more requests for the team; removes cat history; needs a way to find all a person's photos, which severing deliberately destroys.
- **Always remove their photos.** **Risk:** breaks the cat records and the points history, and it reverses the 30 Sep decision.
**Recommendation: keep as is, plus a plain sentence in the privacy policy and the delete screen. This is a product question more than a storage one and can follow D1–D4.**

### D6 — When?
- **Start Monday 9 Nov, one week after launch, reclaim in January** *(recommended, if D0 is "go")*. Launch week is clear of every photo change. The expensive step lands in the low season.
- **Wait until after the New Year.** Less to juggle. **Risk:** the photo table keeps growing, and the data is moved later and bigger.
**Recommendation: 9 Nov.** The only hard deadline is "before the April 2027 season".

### Smaller points, no decision needed unless you disagree
- The deploy order for any migration here is the one in DEPLOYMENT.md §C: migrate first, then say "don't republish yet" until the code is ready.
- The relationship with **SYC-81** (shrink old photos): build the storage move first; the shrink then writes a new object and deletes the old through the same routine. Doing them the other way round would shrink in the database and then copy the shrunken files, which is also fine but wastes the saving.
- Whether other in-flight work adds photo storage: see §9.

---

## 9. Other work that touches photos, as of 25 Oct 2026

Checked from session metadata and PR file lists, not from their specs, so treat as a starting point:
- **"Extra badges design"** (SYC-706, [PR #342](https://github.com/fairshake-au/syros-cat-spotter/pull/342), open): touches badges, points and area history; **no photo code** in the file list.
- **"Decide and build naming limits"** (SYC-709, SYC-714) and **"Spec: guardians request paid sterilisation"** (SYC-284), both children of the planner session and running: I did not read their work. A sterilisation request could plausibly attach a photo; **unchecked**. Anything that adds a new photo table or a new reader after approval must go through the storage module or be added to this move.
- **Approved but not built, and another table of picture bytes:** `field_check_photos` (DECISIONS.md, field checks, "served only by a team route"). It would be a ninth place bytes live and must use the storage module from its first line.
- **Already merged and relevant:** SYC-677 (vet-visit batches, #333–#339) put team-only photos into `photos`; SYC-403 (smaller copies for report photos) is still open and is absorbed by D4.
- Siblings running now: **SYC-532/531** (matcher alert), **SYC-199/307** (database indexes). The indexes work touches `photos` indexes and should land before step 1's migration.

## 10. Not in this spec
Direct-to-bucket uploads from the phone (rejected earlier: it changes offline retry), a photo CDN (D3), the 12-month shrink job (SYC-81), changing what photos are shown where, and any code. This document is the whole deliverable until it is approved; then, and only then, a plan.
