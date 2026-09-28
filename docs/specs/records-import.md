# Importing Syros Cats' existing records

**Status:** Split out of `cat-record-data-spine.md` §5 on 28 September 2026 (Samuel). **Optional, post-MVP.** Built only if Syros Cats confirm an import is operationally sensible and helpful. **Not yet reviewed for approval:** Samuel deferred its review on 28 September 2026.
**Owner:** Samuel
**Covers:** SYC-49 (records import).
**Depends on:** `cat-record-data-spine.md` (the observation model, colonies, the notification baseline) and `team-access-and-welfare-queue.md` (staff sign-in, for who uploaded and reviewed each batch).

---

## 1. Status and scope

**What actually exists (Samuel, 28 September 2026).** Syros Cats does not keep structured sterilisation records. What exists is a set of month-by-month WhatsApp groups with scant details about each cat. Jo sets up TNR records; cat guardians are authorised to arrange sterilisation with Syros Cats paying.

**Importing is conditional.** We import only if Syros Cats confirm it is operationally sensible and helpful to do so. It may be some of it, or none. Nothing in the data spine depends on it. Without an import, *Confirmed* comes from the team (and vets, once they have access) recording sterilisations as they happen and as cats are seen. The model is the same; only the source differs.

§2 onwards is the design **if the import goes ahead**, and none of it is built until Syros Cats say yes. The likely input is a WhatsApp chat export, which means messages and photos with little structure. Expect most of the fields in §2.1 to be missing, and expect each usable record to be picked out by hand before the pipeline sees it.

**What the data spine keeps so this can arrive later without rewriting history:** the `import` provenance on observations and the precedence rule for authoritative statements (data spine §4.6, §10.2); a cat's name history (data spine §10.3); colony name history (data spine §10.5); and the notification baseline for any bulk write (data spine §9.2). Nothing else in the data spine depends on this document.

## 2. The design, if the import goes ahead

### 2.1 What we ask them for

If they say yes, we ask for whatever they already have, in whatever form they already have it — a spreadsheet export is ideal, a photograph of a notebook page is acceptable and gets typed up. We do not ask them to restructure their records to suit us; that is a request a small charity should never receive from software.

| Field | Why it matters | If missing |
|---|---|---|
| **Date of the operation** | Orders the evidence; drives impact reporting by date range | Import as "date unknown"; the record still confirms sterilisation, it just cannot be counted in a period |
| **The cat's name or their reference** | The strongest matching signal we have | Falls back to colony plus description |
| **Colony or location** | Second-strongest matching signal; colonies have established names, usually the place plus the name of the person caring for the colony. Names can change, so a match checks the current name **and** every earlier one (data spine §10.5) | Matching relies on name alone |
| **Sex** | Fills an attribute we otherwise rarely learn, and is the strongest way to *rule out* a wrong match | Left unknown |
| **Vet or clinic** | Provenance; supports funder reporting | Recorded as "Syros Cats record" |
| **Ear tip clipped, and which side** | Lets us cross-check crowd observations | Assumed nothing |
| **Cat guardian's name** | Matching signal, and the route to a guardian account later | Ignored |
| **Cost** | Funder reporting against the €50–60 per cat figure | Ignored |
| **Free-text notes** | Kept verbatim; often the only thing that identifies a cat | — |

### 2.2 What a real charity's records actually look like

The pipeline below is built for the file we will actually receive, not the file we would like. Four things are near-certain and each needs an answer before the first upload, not after:

- **The same cat appears more than once.** A cat done in 2019 and treated again in 2023 is two rows and one cat. Two volunteers recording the same operation is two rows and one operation. The import cannot tell these apart by content alone, so it does not try: both rows are kept, both are matched, and the *pool count* in §2.4 is de-duplicated before publication rather than at import.
- **Spelling is inconsistent.** "Mimi", "Mimí", "MIMI", "Mimi (bakery)". Normalisation folds case and trims, but it does not invent a canonical spelling; near-matches go to review.
- **Names arrive in English.** Syros Cats operates in English (Samuel, 28 September 2026), so any names in their records will be in Latin script, and the import needs no Greek↔Latin transliteration.
- **Spotters can name cats in Greek in the app, and Greek text is harder than "case-fold" suggests.** Final sigma (ς versus σ), accents (Μιμή versus ΜΙΜΗ — Greek drops the accent when capitalised), and Unicode normalisation (the same name typed on an iPhone and pasted from a Word document can be different byte sequences). All names are normalised to **NFC on write** — in the app as well as the importer — and matching compares an accent-stripped, final-sigma-folded, case-folded form. This also means the catalogue's "names are unique, case-insensitively" guarantee needs a migration-level test asserting what it actually does with `Μιμή` (NFC), `Μιμή` (NFD) and `ΜΙΜΗ`. See data spine §10.7.

### 2.3 The pipeline

Four stages, each of which can be stopped and inspected.

1. **Land the file, untouched.** Every row is stored verbatim in a staging table alongside a hash of its content, its position in the file, and a hash of the whole file. Nothing is interpreted yet. This is what makes the import re-runnable and re-derivable — if we discover in six months that the matching was too eager, we re-run it against the original rows rather than reconstructing them.
2. **Normalise.** Dates parsed (Greek and English formats), names normalised as §2.2 describes, colonies mapped onto rows in the `colonies` table (data spine §10.5) by normalised name — never created silently, because a typo would otherwise mint a colony. Anything that will not parse is flagged, not guessed.
3. **Match to a cat in the app.** Scored, never automatic beyond a high bar. See §2.4.
4. **Apply.** Matched rows become observations with provenance `import` and source `Syros Cats records`, which resolve to *Confirmed*. Unmatched rows wait in a pool. See §2.5.

**Any photograph arriving with the records goes through the same pipeline as a photo taken in the app.** The charity's records may come with pictures — a photo of a cat on the clinic table, a snapshot attached to a spreadsheet row, a phone picture of a notebook page. Those are photographs taken on somebody's phone, which means they carry the GPS tag of where they were taken, which is a vet's premises or a colony's exact feeding spot.

The upload path strips that metadata (`hosting-and-photo-storage.md` §6.4). **The import must not have a direct-insert path into the photos table.** Every imported image is validated and re-encoded through the same `validatePhotoBase64` pipeline as a spotter's photo — same format checks, same size limits, same strip — with no shortcut for "it came from the charity so it must be fine". An import that writes photo rows directly would silently publish exact coordinates on a public, permanently-cached endpoint, defeating every control in data spine §6 for exactly the cats the charity cares most about.

This is a dependency in both directions. `hosting-and-photo-storage.md` owns the test that a JPEG uploaded with a GPS block comes back without one; today the image-validation suite has eleven tests and **not one of them asserts that GPS metadata is gone** — the only EXIF-adjacent test asserts that orientation is honoured. That test covers the upload path only. This document requires the same assertion against the import path (data spine §10.8 test 13), because a stripping guarantee that holds on one of two entrances is not a guarantee.

**Re-running the import is genuinely safe — which it was not, as previously specified.** The old design made the row identity unique on *(batch id, row hash)*, and a re-upload creates a new batch with a new id. Every row would have inserted again, matched again, and written a second observation. Re-uploading the spreadsheet because you were not sure the first one worked — the single most likely operational event in the whole feature — would have doubled the confirmed-sterilisation count that goes to funders.

The identity is now **(file content hash, row hash, row position)**, unique across the whole table:

- **The same file uploaded twice** is recognised as the same file. The second upload reports "this file is already imported, 214 rows, nothing to do" and writes nothing.
- **Genuinely identical rows within one file** — the charity recorded the same cat twice, identically — both survive, because the row's position in the file is part of its identity. Discarding one would throw away a real record.
- **A corrected file** is a different file. The rows that are unchanged are recognised as already imported and skipped. The rows that changed are new rows, and here the old design left two contradictory live observations from one real-world record with nothing linking them. Instead: a corrected row **supersedes** the observation written by the row it replaces, matched on the charity's own reference where the file has one, and on (file lineage, row position) where it does not. The superseded observation stays in the trail with the reason *"replaced by a corrected import"*. Where neither key is available the row lands in review rather than guessing.

### 2.4 Matching imported records to cats in the app

Candidates are scored, and the score decides what happens — it never decides silently.

| Signal | Weight |
|---|---|
| Cat name matches, case-insensitive and accent-insensitive, exactly | Very strong |
| Cat name is a near-match (one or two characters) | Strong |
| Colony matches | Moderate |
| Record location within 500 m of the cat's sightings | Moderate |
| Cat guardian's name matches the owner name on a cat registered from scratch in the app (claims have not asked for a name since 25 September 2026, so claimed cats never match on this) | Moderate |
| Sex contradicts a recorded sex | **Strong negative — vetoes an auto-link outright** |

| Outcome | Rule | What happens |
|---|---|---|
| **Auto-linked** | Exact name match, **and** exactly one cat in the catalogue has that name, **and** at least one corroborating signal (colony match, a record location within 500 m of the cat's sightings, or a guardian-name match), **and** no negative signal | Applied immediately, and recorded as auto-linked so the whole set can be reviewed or reversed as a group. |
| **Needs review** | Any other scoring cat, including a name-only match with nothing corroborating | Lands in the team dashboard's import queue: the record on one side, up to three candidate cats with photos on the other, and buttons for *this one* / *none of these*. |
| **Unmatched** | Nothing scores | Goes to the waiting pool. See §2.5. |

**Why name alone is no longer enough.** The previous rule auto-linked on an exact unique name, reasoning that names are unique across the catalogue "so this is unambiguous by construction". Uniqueness is real — the database enforces it — but it guarantees *at most one candidate*, not *the right one*. App cat names come from an AI suggester asked for names in the user's language, drawing on the same small pool of common Greek cat names the charity's own records use. "Ρούλα" in the charity's Ano Syros records and "Roula" the tabby a French tourist named in Kini are one exact-name auto-link that no human ever sees — and the result is a *Confirmed* sterilisation, or now under D4 a *public confirmed negative*, on the wrong cat. A few hundred rows in a review queue is one afternoon for Jo. It is the cheapest insurance in the document.

**Nothing is auto-linked on location or colony alone.** In a thirty-cat colony, "a sterilised cat near the bakery" identifies no individual.

### 2.5 Records with no cat yet

Most of Syros Cats' records will describe cats the app has never photographed.

| Option | Benefits | Risks |
|---|---|---|
| **A. Create a photo-less cat entry for every unmatched record** | Every sterilisation is immediately visible and countable. The island count jumps to something closer to reality. | The catalogue fills with cats nobody can spot, collect, or see a photo of. The collection grid — the reason tourists come back — becomes mostly locked grey squares for cats that may not exist any more. Duplicates become near-certain when the real cat is later photographed and named something else. |
| **B. Hold them in a waiting pool, attach on first sighting (recommended)** | The public catalogue stays honest: everything in it is a cat somebody has seen. Impact reporting still counts these records, from the pool, because the pool is part of the data. When a matching cat is later spotted, the team gets a suggestion and one tap links the record — turning a first sighting into a *Confirmed* sterilisation. | Two places to look when answering "is this cat done?" — handled by the resolver consulting both, so only the code sees the seam. And the two places can double-count; see below. |

**Recommendation: Option B.** The catalogue is a record of cats that have been seen; the pool is a record of operations that have been performed.

**The counting is honest about its own overlap.** A pool record is "a cat not yet photographed" only if the matching was right, and unmatched-because-hard is the common case rather than the rare one. A record that failed to match a cat already in the catalogue is counted twice. Two rows for one cat under two spellings both sit in the pool and both count. So:

- The pool figure is **de-duplicated before publication** — rows that match each other on the charity's reference, or on normalised name plus colony, count once.
- The reporting sentence names the overlap rather than implying precision it does not have: *"142 cats in the catalogue: 89 confirmed sterilised, 23 likely, 12 confirmed not sterilised, 18 not known. We hold records of a further 46 sterilisations for cats not yet photographed — some of these may be cats already listed above."*
- **The "further 46" will go down over time, and that is success, not a mistake.** Every time a pool record links to a newly-photographed cat, the pool drops by one and the confirmed count rises by one. A funder-facing number that moves downward needs its explanation written before it moves, not after.

### 2.6 A cat's names, over time

The cat's name is the strongest matching signal we have, and today nothing preserves it: renaming a cat overwrites the name in place, with no history, so an owner renaming their cat destroys the only strong key every future import run would have used.

**A cat's names are recorded append-only, like everything else** — every name it has been known by, with who gave it, when, and where the name came from (spotter, owner rename, charity record). The current name is the newest non-superseded one; the rest are matching keys. Imports match against all of them.

**Names given by a deleted user are kept.** A name becomes shared community property the moment other people use it; see data spine §8.4.

### 2.7 When the import contradicts what the app derived

| Situation | What happens | Why |
|---|---|---|
| App says *Likely* (clipped tip seen), import confirms sterilised | Becomes *Confirmed*. Both observations stay. | The crowd was right, and the record now says so with authority. |
| App says *Unknown*, import confirms sterilised | Becomes *Confirmed*. | The whole point of the import. |
| App says *Likely*, import record says the cat was **not** sterilised (e.g. a trapping that did not proceed) | The import is authoritative and it wins, because clipped-tip evidence can never outrank an authoritative statement (data spine §4.6). Publicly the cat reads *"Not sterilised"* per D4. Flagged for the team. | A clipped tip photographed after that date is genuinely interesting — but *interesting* is a flag for a human, not a reason for the resolver to override the record. |
| Import confirms sterilised, a later team entry says not sterilised | The later team entry wins, and the conflict is flagged prominently. | Almost always means the record was matched to the wrong cat. This is the signal that the matching needs correcting — and under data spine §4.6 it now actually executes. |
| Two import rows disagree with each other about the same cat | Both applied; the newer operation date wins; flagged. | Their records, their conflict — we surface it rather than silently picking. |

**No import row ever overwrites or deletes anything.** Every one of these outcomes is an addition to the trail, and every one is reversible by adding a further observation.

**Unlinking is supported.** A record linked to the wrong cat can be unlinked from the team dashboard; the unlink supersedes the observation the link wrote, the record returns to the review queue (`needs_review`), and the derived status recomputes immediately. There is one state for this transition, not two.

---

## 3. Import tables

```ts
export const importBatchesTable = pgTable("import_batches", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  fileHash: text("file_hash").notNull(),    // sha256 of the whole file
  supersedesBatchId: integer("supersedes_batch_id"),  // a corrected re-upload
  uploadedBy: text("uploaded_by").notNull(),          // staff identity, see below
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  rowCount: integer("row_count").notNull(),
  notes: text("notes"),
});

export const importRecordsTable = pgTable("import_records", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull(),
  fileHash: text("file_hash").notNull(),    // denormalised for the unique index
  rowHash: text("row_hash").notNull(),      // sha256 of the raw row
  rowOrdinal: integer("row_ordinal").notNull(),  // position in the file
  sourceKey: text("source_key"),            // the charity's own reference, if any
  raw: jsonb("raw").notNull(),              // the row, verbatim, forever
  parsed: jsonb("parsed"),                  // normalised fields, null if unparseable
  parseErrors: jsonb("parse_errors"),
  catId: integer("cat_id"),                 // null while unmatched
  matchState: text("match_state").notNull().default("unmatched"),
  // unmatched | needs_review | auto_linked | linked | rejected
  matchScore: doublePrecision("match_score"),
  matchCandidates: jsonb("match_candidates"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
}, (t) => [
  // Globally unique, NOT batch-scoped. Re-uploading the same file is a no-op;
  // identical rows within one file both survive on rowOrdinal.
  uniqueIndex("import_records_identity_unique").on(t.fileHash, t.rowHash, t.rowOrdinal),
  index("import_records_state_idx").on(t.matchState),
  index("import_records_source_key_idx").on(t.sourceKey),
]);
```

Linking an import record writes an `observations` row with `provenance: "import"` and `importRecordId` set. Unlinking supersedes that observation and returns the record to `needs_review` — one state for that transition; `unlinked` is not a separate state.

**`uploadedBy` and `reviewedBy` depend on staff identity**, which comes from `team-access-and-welfare-queue.md` and is unshipped. The import step is therefore blocked on staff sign-in existing, which the migration plan in data spine §11 states explicitly rather than leaving to be discovered.

## 4. Where it sits in the migration sequence

It runs after the data spine's migration steps 0–8 (data spine §11.2), none of which depend on it.

| Step | What happens | Risk handling |
|---|---|---|
| 9. Import the Syros Cats records | Staged, reviewed in the dashboard, applied — seeding the notification baseline as it goes. | **Depends on staff sign-in existing** (`team-access-and-welfare-queue.md`) for `uploadedBy` and the review queue. Reversible per row; raw rows kept permanently. |

## 5. Tests that must exist

1. **Import idempotency, done properly:** the same file uploaded as two separate batches produces one set of observations. A corrected file supersedes rather than duplicating. Two identical rows within one file both survive.
2. A cat whose only recent evidence is a linked import record is not presumed deceased.
3. **Notification baseline:** applying an import batch of historical records produces zero notifiable status changes (data spine §9.2).

## 6. Risks

| # | Risk | Consequence | Handling |
|---|---|---|---|
| 1 | **The records import matches rows to the wrong cats** — a wrong link makes a *Confirmed* sterilisation, or under D4 a **public** *not sterilised*, on a cat it does not describe | Worse than no import: a cat drops off the trapping list with a confident label, or is publicly labelled from someone else's record | Auto-link now requires a corroborating signal and no negative signal (§2.4). Everything else is human-reviewed with photos. data spine §4.6 makes the correction actually execute. Raw rows kept forever; unlinking is one action and recomputes immediately. |
| 2 | There is no usable import: the records are month-by-month WhatsApp groups with scant detail, and Syros Cats may decide importing them isn't worth it | The season starts with almost no *Confirmed* sterilisations; the map shows mostly *Unknown* | **Accepted.** Nothing depends on the import. *Confirmed* builds up from team entries as cats are seen, and the importer is built only if Syros Cats say it's worth it (§1). If it goes ahead it is also blocked on staff sign-in (§4). Owner: Syros Cats' decision, asked by Samuel. |

## 7. Open question

| # | Question | Owner | Why it needs a person |
|---|---|---|---|
| 1 | ~~What shape are the existing sterilisation records actually in?~~ **Answered 28 Sep:** month-by-month WhatsApp groups with scant detail. **New question: is importing any of it operationally sensible and helpful?** | Syros Cats (Jo, Susan), asked by Samuel | Decides whether §5 is built at all. Blocks nothing else. |
