# Moving a sighting to the right cat

**Status:** Draft for Samuel's approval, 26 October 2026. Not yet reviewed.
**Linear:** SYC-150 (High), with SYC-418 folded in. The "Matched by hand" list that reuses these buttons is SYC-152.
**Amends:** [`cat-record-data-spine.md`](./cat-record-data-spine.md). It adds a §10.10 that points here and changes one sentence in §10.9. This document owns moving a sighting. The data spine still owns observations, the resolver and deletion.
**Related:** [`choose-a-different-cat.md`](./choose-a-different-cat.md) §4.2, §5, §8.2 · [`team-cat-page-redesign.md`](./team-cat-page-redesign.md) §3.5 · [`report-an-issue.md`](./report-an-issue.md) (`wrong_cat`, keep the photo's id) · [`matching-game.md`](./matching-game.md) §7.2 ("Re-file") · [`photo-tips-and-extra-photos.md`](./photo-tips-and-extra-photos.md) (up to three photos a spot) · [`claiming-a-cat.md`](./claiming-a-cat.md) §16 and [`syc-709-naming-limits.md`](./syc-709-naming-limits.md) (who has "met" a cat) · [`spotted-stamps.md`](./spotted-stamps.md) · [`add-details-later.md`](./add-details-later.md) · SYC-59 (merging duplicate cats).

---

## 1. The short version

Sometimes a photo ends up filed under the wrong cat. A spotter taps "That's the one" on a lookalike, picks the wrong cat by hand, or snaps two cats at one feeding spot. Today Syros Cats can only hide the photo. That loses a real sighting, and anything the spotter said about it ("ear tip clipped") stays on the wrong cat.

With this change, **a team member can move a sighting to the right cat, or to a new cat, from the dashboard.** It takes two taps and a short reason. Afterwards:

- The photo, and everything the spotter said with it, now belongs to the right cat.
- Both cats work out their status again: sterilised, last seen, and whether they're presumed to have died.
- The spotter keeps their points. Their collection and Spotted stamps show the right cat the next time they look.
- Nothing is rewritten or lost. The move itself is a dated record saying who moved it, from which cat, to which cat, and why. Both cats' History shows it, and it can be moved back.

A spot can hold up to three photos. If just one of them shows another cat, the team can move **that one photo**, and it becomes a sighting of its own on the right cat (§5, decision D2).

---

## 2. Who uses this and when

**The Syros Cats team, on the dashboard.** It's never in the app. There are four ways in, all leading to the same move screen:

1. **A cat's History** (`team-cat-page-redesign.md` §3.5). A sighting row's ⋯ menu gains **"Move to a different cat…"** and **"Move to a new cat"**. A spot with more than one photo also has **"Move just this photo…"** on each photo except its cover photo.
2. **"Matched by hand"** (SYC-152, `choose-a-different-cat.md` §5). Its **Different cat…** and **It's a new cat** buttons open the same screen.
3. **Report an issue** (`report-an-issue.md`). A `wrong_cat` report ("That's a different cat") gains **"Move to the right cat"** next to "Hide the photo".
4. **The matching game's "Players think this sighting isn't Mikis" row** (`matching-game.md` §7.2). Its **Re-file** button stops being greyed out and opens the same screen.

**Who may move:** anyone on the team with the new permission `move_sighting`. That's staff and management (decision D5). Cat guardians and vets don't get it in this version.

---

## 3. What the team member sees

### 3.1 The move screen

- **At the top:** the photo being moved, large, with its date and published map square. Underneath is the cat it's filed under now, with that cat's main photo and two recent photos, so the team member can compare.
- **"Which cat is it?"** Search the whole island by name (any earlier name too) or SYR number. It also lists cats near the photo first, nearest first. Each result shows the cat's main photo and two recent ones. **"It's a new cat"** sits below the list.
- **"Why?"** A required short reason: *"Different markings"*, *"Two cats in the photo"*, *"Wrong cat picked"*, or *"Other…"* with a box to type in. It's shown in both cats' History.
- **"What moves"** is a plain list, written out before anything happens:
  > Moves to **Agatha**: this photo, "ear tip clipped (left)", "food and water were out", and the spotter's note.
  > **Mimi** keeps 6 sightings. Her main photo changes to the one from 12 October.
  > The spotter keeps their 15 points.
- **"Move"** button. One step, no second screen.

**Warnings shown above the button, when they apply:**

| When | What it says |
|---|---|
| The chosen cat is recorded as having died | *"Agatha is recorded as having died. Moving this photo says she was seen alive on 3 October, which will change her record back to alive."* (data spine §3.2: any later sighting clears it). |
| The photo is the cat's main photo | *"This is Mimi's main photo. Her main photo will change to [thumbnail]."* The team can pick a different one afterwards in "Update this cat". |
| The sighting said "ear tip clipped" | *"Agatha will go on the Likely list for a check."* (as for any clipped answer, data spine §4.5). |
| The photo is far from the chosen cat's map square (over 1 km) | *"This photo was taken 2.3 km from where Agatha is usually seen."* A warning only, never a block. |
| The photo is hidden | *"This photo is hidden. Moving it keeps it hidden. Show it again from the photo's own menu if the only reason was the wrong cat."* |

### 3.2 It's the cat's only sighting

If the sighting is the **only** one a cat has, moving it would leave a cat with no photos. That really means the two records are the same cat, which is a merge. Merging belongs to SYC-59. **The move screen says so and doesn't move it** (decision D1): *"This is Mimi's only sighting, so Mimi and Agatha are probably the same cat. Merging cats isn't built yet (SYC-59). For now, hide this photo or leave it."* "It's a new cat" is never offered here, because Mimi already is a cat of her own.

Vet batches create cats without a sighting (SYC-677). Those cats count as having no sightings, so moving another cat's photo *to* them works normally.

### 3.3 "It's a new cat"

The team member gives the new cat a name, or ticks **"Let spotters name it"** (decision D3). With the tick, the cat is created the way a vet-batch cat is: its name is its SYR number until someone names it (`syc-709-naming-limits.md`), and **the spotter whose photo started it may name it.** The new cat's main photo is the moved photo and its map position is where the photo was taken. The spotter is its discoverer, so they get the credit, just as if they had pressed "New cat" themselves. Colour is read from its main photo like any new cat's.

No extra points are given. The spotter got 15 points for a match and keeps exactly that. The 25 for a new cat is only earned at the moment a spotter adds one (§6).

### 3.4 What History shows afterwards

On **both** cats, the History list gets a row with the date, the team member's name, and the reason:

- On the cat it left: *"Photo moved to Agatha by Maria: 'Different markings'"*. It shows the photo's thumbnail, faded, and links to Agatha. Whatever the spotter said with it stays in this row, crossed out, with "now on Agatha".
- On the cat it joined: *"Photo moved here from Mimi by Maria: 'Different markings'"*. The sighting itself appears as a normal sighting row, on its own date, with its answers.
- The row on the cat it joined has **"Move back"** in its ⋯ menu. That is just another move, with its own row and reason. Nothing is ever undone by deleting.

The cat's summary and "Why we think so" (the evidence behind sterilised and last seen) change at once, because they are worked out from the record each time the page loads.

---

## 4. What happens to the record

This is the part the data spine owns. In plain words first, then exactly.

### 4.1 The principle

**A move is a new statement, made by a named person on a date, and nothing that was said before is lost.** That's the data spine's rule (§2) applied to "which cat is this photo of".

There are three pieces:

1. **A move record.** A new, add-only row: which sighting (and which photo, if only one photo moves), from which cat, to which cat, who moved it, when, and why. It's never edited. Moving back is another row.
2. **The sighting's "filed under" cat changes.** A sighting already records which cat it belongs to, and that field is already filled in once, when the spotter matches it. A move changes it again, **but only together with a move record in the same step.** The database refuses any other change. The full story of where a sighting has been filed is the move records, in order.
3. **What the spotter said is restated on the right cat.** Every standing statement made from that sighting (ear tip, food and water, note) is written again on the new cat. The new copy says it replaces the old one, and the old one stops counting on the old cat. The copy keeps **the spotter as its author**, with the same role, the same date, the same photo and the same sighting. The move record says who moved it.

**Why the copy keeps the spotter as author, not the team member.** The ticket said the restated statements would be "attributed to the team member who moved it". That would quietly upgrade a spotter's guess into a team statement. A spotter's "clipped" would then count with the team's authority, and a spotter's colour answer would count as the team's confirmed colour (data spine §10.2). The team member is responsible for the *move*; the spotter is still the one who said what they saw. So the move record holds the team member, and the restated statement holds the spotter.

**Why the "filed under" cat changes instead of everything reading through the move records.** Everything that should follow the right cat already reads that one field. That covers the spotter's collection and Spotted stamps, the cats-spotted badges, "last seen", sightings counts, the cat's photos, the matcher's choice of photo, "Report an issue" checking which cat a photo belongs to, and late answers on the sighting (`add-details-later.md`). The approved claiming and naming specs were written expecting exactly this (`claiming-a-cat.md` §16, `syc-709-naming-limits.md` §1). Making two dozen readers look through a separate table instead would be a larger change with more places to get it wrong, and it would give the same answer.

### 4.2 Statements made from the sighting

Today a sighting carries up to three statements, all written with the sighting's id: **ear tip**, **food and water** and **note**. The same rule applies to any kind written with a sighting's id in future.

- **The spotter's own statements** are restated on the new cat, as §4.1 says. If the spotter's data was deleted, the copy is written already unlinked: no author, the same deletion stamp, and an emptied note stays empty. Deleting your data still counts as one voice (data spine §10.2), and moving a photo never brings a deleted person back.
- **A team, guardian or vet statement made from that sighting** stops counting on the old cat and **is not restated.** Today that's the team's "agree with clip", which copies the sighting's id onto a team ear-tip statement. That person was judging the photo as if it were the old cat. The new cat goes on the Likely list if the spotter's clipped answer moves there, and the team checks it again there.
- **Statements are never moved one at a time.** A sighting's statements go with it as a group, or not at all.
- **Statements without a sighting's id never move.** That covers the name given when a cat was first added, colony, coat readings from the main photo, vet visits, welfare reports, team notes and life status. They are about the cat, not about this photo.

### 4.3 What each cat works out again

Both cats are worked out from their records the next time they're read, as always. What changes in practice:

| | The cat it left | The cat it joined |
|---|---|---|
| **Sterilised** | A clipped ear tip from this photo stops counting. Likely can go back to Unknown. | A clipped ear tip from this photo counts. Unknown can become Likely, and the cat goes on the Likely list. |
| **Last seen, presumed died** | The sighting stops counting. Last seen can go back in time, and a cat can become presumed died if this was its only sighting in three years. | The sighting counts on its own date, never the move's date. A cat recorded as having died is cleared (§3.1 warning). |
| **Main photo** | If it was this photo, it changes to the newest remaining photo that isn't hidden. If there is none, the cat shows the placeholder. The team can choose another. The colour is read again from the new main photo. | Unchanged. A moved photo never becomes the main photo automatically (`choose-a-different-cat.md` §8.4), except for a cat made by "It's a new cat". |
| **Name, discoverer, map position** | Unchanged, even if this sighting is the one that started the cat. The name is community property (data spine §8.4), and the spotter keeps the discoverer credit, the same principle as keeping points. | Unchanged. |

**News stays quiet.** A change caused by a move is a correction, not news. The nightly news check marks any change whose newest evidence is a move as `silenced`, with the reason "moved", whatever the dates. That way a move never tells a follower "Agatha was seen again" or "Agatha is sterilised" (data spine §9.3). A move never sends a push or an email.

### 4.4 Moving one photo out of a spot

A spot can hold a first photo, a face photo and a body photo (SYC-415). The spot's **cover photo** is the one it's filed by.

- **Moving the cover photo moves the whole spot**, all its photos and statements. If one of the other photos really did show the old cat, the team moves that one back on its own afterwards. Two small steps, each clear.
- **Moving any other photo** takes just that photo out of the spot and makes it a **new sighting of its own on the right cat** (decision D2). The new sighting has the same spotter, the same place and the same time. It records that it was split from the first spot. Its photo keeps the same internal id (below).
  - It **counts** for last seen, the spotter's collection and Spotted stamps, and the "seen alive" evidence.
  - It **earns no points**, and it's never part of the once-a-day points rule.
  - **The spotter's answers stay with the original spot.** They were answering about the cover photo's cat.
- **A photo is never copied.** It keeps its internal id wherever it goes, so its hidden-and-restored history stays intact. This matters because "Report an issue" uses that history to decide that a photo the team has restored can't be hidden again by a report (`report-an-issue.md`, SYC-279). Only its link to a spot changes.

### 4.5 The spotter

- **Points:** unchanged. The points record keeps the cat the points were earned on. It's a record of the award, not a statement about the cat.
- **Collection, Spotted stamps, cats-spotted badges:** follow the right cat automatically. These are worked out from sightings. Badges already awarded are kept, as every badge rule already says.
- **Following:** the spotter starts following the right cat, as a match would have done, unless they've unfollowed it before. They stay following the old cat. They may have chosen to, and unfollowing someone silently would be stranger than leaving it.
- **Claiming and naming:** a sighting the team moved to an *existing* cat still doesn't count as "meeting" that cat. That's already decided in `claiming-a-cat.md` §16 and SYC-709, and isn't reopened here. **The one exception is "It's a new cat" with "Let spotters name it":** the spotter whose photo started that cat may name it, because they found it (decision D3).
- **Telling the spotter:** no push. Their own spot shows a quiet line, *"Syros Cats filed this under Agatha"*, the next time they open it (decision D4).

### 4.6 The "Matched by hand" record

The team-only match record (data spine §10.9) keeps what the spotter chose next to what the team did. **A move from anywhere fills in the team's step** (`different_cat` or `new_cat`, the team cat, who and when), if no team step is recorded yet. This way the matching-accuracy work (SYC-56) learns about the miss whichever screen the team used. The spotter's own choice is never changed. A second move is recorded only in the move records.

### 4.7 Rules that keep it safe

- **Only a matched sighting can move.** A spot still waiting for the spotter, or waiting for "Ask Syros Cats to match it", is matched, not moved.
- **Never to the same cat.** A cat that was merged into another counts as that other cat (`cat_identity`, data spine §10.3).
- **Two people moving at once:** the screen sends the cat it expects the sighting to be on. If someone else moved it first, the second person sees *"Someone moved this photo a moment ago. It's now on Agatha."* and nothing happens.
- **All or nothing.** The move record, the sighting's new cat, the restated statements, the split sighting, the new cat and the main-photo change are written together, or none of them are.
- **Reports "as of" an earlier date** (SYC-396) read the move records, so a report for 1 October shows each sighting where it was filed on 1 October.

---

## 5. Decisions for Samuel

Each comes to Samuel one at a time, in plain English, before approval. The recommendation is what's written in the sections above.

| # | Question | Recommendation |
|---|---|---|
| D1 | A cat's only sighting is the wrong cat: move it, merge, or stop? | Stop and point to merging (SYC-59) |
| D2 | One photo out of a spot: its own sighting, just a photo, or hide only? | Its own sighting, no points |
| D3 | "It's a new cat": who names it? | Team types a name, or ticks "Let spotters name it" so the spotter who found it can |
| D4 | Tell the spotter? | A quiet line on their own spot, no push |
| D5 | Who can move sightings? | Team (staff and management) only, for now |

---

## 6. What's deliberately not here

- **Merging and splitting whole cats** is SYC-59's.
- **Moving a vet-visit photo.** A visit filed on the wrong cat is "Mark the visit wrong" and logged again, as it is today (SYC-677).
- **Moving a welfare report** to another cat already exists (re-tying, SYC-43).
- **Topping up points** to the new-cat 25 when the team makes a new cat. A spotter's points are fixed at the moment they spot.
- **Cat guardians moving photos within their own colonies** is a follow-up (D5).
- **Spotters moving their own photo** after matching it. The phone's review list is the place to get it right before matching.

---

## 7. Technical specification

### 7.1 The move record

```ts
// lib/db/src/schema/sightingMoves.ts — add-only, same guard as cat_identity
export const sightingMovesTable = pgTable("sighting_moves", {
  id: serial("id").primaryKey(),
  sightingId: integer("sighting_id").notNull(),     // the spot moved, or split from
  photoId: integer("photo_id"),                     // set only when one photo is split out
  newSightingId: integer("new_sighting_id"),        // the split-out sighting; set exactly when photoId is
  fromCatId: integer("from_cat_id").notNull(),      // ids at the time; read through cat_identity
  toCatId: integer("to_cat_id").notNull(),
  madeNewCat: boolean("made_new_cat").notNull().default(false),
  reason: text("reason").notNull(),                 // different_markings | two_cats | wrong_pick | other
  reasonText: text("reason_text"),                  // with "other"; team-only
  source: text("source").notNull(),                 // cat_page | matched_by_hand | report | game
  movedByAccountId: text("moved_by_account_id"),    // null only once redacted (§8)
  roleAtTime: text("role_at_time").notNull(),       // staff | management
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  redactedAt: timestamp("redacted_at", { withTimezone: true }),
});
// CHECKs: fromCatId <> toCatId; (photoId is null) = (newSightingId is null);
// movedByAccountId is null only when redactedAt is set; enum columns hold their values.
```

Team-only. No public route reads it. Deleting the team member's account clears `movedByAccountId` and stamps `redactedAt`, like their other team statements (data spine §10.9, "Deleting a person").

### 7.2 Database guards

- **`sightings_append_only` gains one allowed update:** `cat_id` changes on a `resolved` sighting only when a `sighting_moves` row for that sighting, with `from_cat_id = OLD.cat_id` and `to_cat_id = NEW.cat_id`, was written in the same transaction. Every other column stays as it is.
- **The same trigger allows inserting a split-out sighting** that arrives already `resolved`, already with a cat, and, if the original was redacted, already redacted. It's allowed only when a `sighting_moves` row in the same transaction names it as `new_sighting_id`.
- **`observations_append_only`** allows inserting an already-redacted restatement only when it `supersedes_id`s a redacted row and carries the move's id.
- **`sighting_photos`:** splitting a photo out removes its row from the old spot and adds it to the new one, with the same `photo_id`, in the move's transaction. A cover photo (`sightings.photo_id`) can never be split out.

### 7.3 Observations

- New column `observations.sighting_move_id` (nullable, no foreign key, like `vet_visit_photos.visit_id`). It's set on every restated row, and on nothing else.
- A restated row copies `kind`, `value`, `device_id`/`account_id`, `role_at_time`, `authority_scope`, `provenance`, `suggested_value`, `suggestion_source`, `sighting_id`, `photo_id` and `observed_at` from the row it replaces. It also copies `redacted_at` and `redaction_reason` when that row is redacted. It sets `cat_id` to the new cat, `supersedes_id` to the old row, `supersede_reason = 'moved'` and `sighting_move_id`.
- **Cross-cat supersession** is already allowed for these three kinds (`writeObservation` guards only coat, markings, the ranked kinds and retractions). The move writes through its own function, which is the only writer allowed to set `sighting_move_id`, and a source test bans any other.
- **The old cat must stop counting the replaced rows.** Today `loadCatRecords` reads cross-cat replacements only for `welfare_report`. That query is widened to every kind, and replacement by a row on another cat removes the old row from the old cat's standing rows. **Every reader that loads observations by cat goes through `loadCatRecords` or the same "standing on this cat" helper.** That includes the Likely list, guardian changes, the team cat view, ear-tip answer state, hand-pick flags and the nightly news. The plan lists each one, and each gets a test.
- A team, guardian or vet row carrying the sighting's id is retired on the old cat by a row the move writes on the **old** cat: `{ retracted: true }` superseding it, `supersede_reason = 'moved'`, the mover as author. Today a retraction is limited to coat and markings (§10.1). It is widened to "a move may retract any row that carries the moved sighting's id", and only through the move's writer.

### 7.4 The route

`POST /api/team/sightings/:sightingId/move` (capability `move_sighting`, staff and management).

```ts
{ expectedCatId: number,                  // the cat the page showed
  toCatId?: number, newCat?: { name?: string, letSpottersName: boolean },  // exactly one
  photoId?: number,                       // split this photo out; never the cover
  reason: "different_markings" | "two_cats" | "wrong_pick" | "other", reasonText?: string,
  source: "cat_page" | "matched_by_hand" | "report" | "game" }
```

In one transaction, locking the sighting and both cats in id order:

1. Check everything in §4.7, and the only-sighting rule (§3.2).
2. Make the new cat if asked. It uses the vet-batch path for a pending name, and the resolve path's name rules for a typed name. The discoverer is the sighting's device (or none, stamped redacted, if that was cleared). The position is the sighting's, and the main photo is the moved photo.
3. Write the move record.
4. For a whole spot: change the sighting's cat. For one photo: insert the split-out sighting and move its photo link.
5. Restate the spotter's statements (whole spot only), and retire the others (§4.2).
6. Fix the old cat's main photo if it was the moved one.
7. Follow the right cat for the spotter (§4.5).
8. After commit, and best effort: fill the match record's team step (§4.6) and queue the colour reading if a main photo changed.

Refusals: `NOT_RESOLVED`, `SAME_CAT`, `MOVED_ALREADY` (the `expectedCatId` is stale), `ONLY_SIGHTING`, `COVER_PHOTO`, `NAME_TAKEN` and the other name refusals.

### 7.5 Match record columns

The team step in data spine §10.9 isn't in the schema yet. This work adds `team_action`, `team_cat_id`, `team_by_account_id`, `team_at` and `redacted_at` as §10.9 specifies. SYC-152 reuses them for "Looks right" and "Hide this photo". The `sent_to_team` choice and `alive_claim` belong to "Ask Syros Cats to match it" and aren't added here.

### 7.6 "Has met this cat"

`hasMetCat` gains one case: a sighting counts for a cat when a `sighting_moves` row with `made_new_cat` and the cat's pending name moved it there (D3). Every other moved sighting still doesn't count.

### 7.7 Tests that must exist

1. A move with no move record is refused by the database. So is any change to a sighting's cat outside the move route.
2. After a move: the old cat's sterilised, last seen and presumed-died answers are what they'd be if the sighting had never been there. The new cat's are what they'd be if it had been matched there in the first place. Both are checked against a cat built directly that way.
3. A restated spotter answer keeps the spotter as author, role `public`, and never counts as team authority. Moving a coat answer never makes a confirmed colour. Moving an ear tip never makes "confirmed sterilised".
4. A moved spot from a deleted spotter stays unlinked, and still counts as one voice.
5. The spotter's points are unchanged. Their collection and stamps show the new cat and not the old one.
6. The photo keeps its internal id. A photo restored before the move still can't be hidden again by a report after it.
7. Moving a sighting whose photo is the cat's main photo gives the newest remaining visible photo, or the placeholder.
8. Moving the only sighting is refused (D1). A vet-batch cat with no sightings can receive a move.
9. Splitting a face photo makes a new sighting that counts for last seen and earns no points. The answers stay on the original. Splitting the cover photo is refused.
10. Two moves at once: exactly one succeeds, and the other gets `MOVED_ALREADY`.
11. Moving back restores both cats' answers, with four History rows and no rows deleted.
12. The nightly news marks a change caused by a move as silenced.
13. A report "as of" a date before the move shows the sighting on the old cat.
14. A redacted team member's move keeps the move and clears who made it.

---

## 8. Where the ticket was out of date (checked against `main` at `9af0532`, 26 Oct 2026)

| Ticket said | What the code and later specs show |
|---|---|
| "Sightings are rows that are added, never rewritten, apart from redaction." | A sighting's cat is already filled in once, when it's matched, under a database guard that also allows status moves and an area stamp (`migrations/0046`). The approved claiming and naming specs already expect a move to change it (`claiming-a-cat.md` §16, `syc-709-naming-limits.md` §1), and so do the code and tests (`claiming.ts` `hasMetCat`, `catHistory.ts`). |
| Restated observations are "attributed to the team member who moved it". | That would turn a spotter's answer into a team statement with team authority (§4.1). Changed: the spotter stays the author, and the move record names the team member. |
| Observations from a sighting: "ear tip, food and water, note". | Still true. The team's "agree with clip" also carries the sighting's id (§4.2). A spotter's name for a cat isn't an observation with a sighting; it's the cat's name (SYC-709). |
| `cat_identity` merges whole cats. | True, but nothing writes to it yet: merging isn't built (SYC-59). Hence D1. |
| The "Matched by hand" buttons depend on this. | The list itself isn't built yet (SYC-152), and nor are the match record's team columns (§7.5). This work builds the move and the columns; SYC-152 builds the list. |
| One photo per sighting. | Up to three since SYC-415, hence §4.4 and D2. |
| (Not in the ticket) | Vet batches make cats with no sighting (SYC-677). A vet-batch cat can receive a moved photo; vet-visit photos are never moved. |
| (Not in the ticket) | The nightly news check only watches today and sends nothing, but §4.3's "silenced" rule must still be there before it ever sends. |
