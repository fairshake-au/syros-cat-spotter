# Which cat is which: moving photos and merging duplicates

**Status:** Draft for Samuel's approval, 26 October 2026.
- The first draft covered moving photos only. It was adversarially reviewed (Sonnet critic: 1 blocker, 12 major, 9 minor findings) and every finding was folded in.
- On 26 October Samuel decided that the "only photo on a cat" case should be designed together with merging, and then that **all of SYC-59** belongs here. This draft adds spotting duplicates and merging. A second adversarial review (Sonnet critic: 2 blockers, 8 major, 11 minor) is folded in.
- Review notes: [`reviews/which-cat-is-which-review.md`](./reviews/which-cat-is-which-review.md).

**Linear:**
- SYC-150 (High): move a sighting. SYC-418 is folded into it.
- SYC-59: duplicate cats, both spotting them and merging them. SYC-531 is folded into it.
- SYC-410: one reader of merges.
- SYC-152: the "Matched by hand" list, which reuses these buttons.

**Amends:**
- [`cat-record-data-spine.md`](./cat-record-data-spine.md): adds §10.10, changes one sentence in §10.9, and replaces §10.3's "duplicate merge itself is still deferred".
- [`choose-a-different-cat.md`](./choose-a-different-cat.md) §8.2: the copied answers keep the spotter as author. Its §8.5 rule that a merge doesn't combine colour readings is kept (§4.2).
- [`add-details-later.md`](./add-details-later.md) §8.
- [`claiming-a-cat.md`](./claiming-a-cat.md) §16 and [`syc-709-naming-limits.md`](./syc-709-naming-limits.md): who has "met" a cat.
- [`matching-game.md`](./matching-game.md) §7.2: its "same cat" and "Re-file" buttons become real actions.

This document owns which cat a photo belongs to, duplicates, and merging. The data spine still owns statements about cats, how status is worked out, and deleting a person.

**Related:** [`team-cat-page-redesign.md`](./team-cat-page-redesign.md) §3.5 · [`report-an-issue.md`](./report-an-issue.md) · [`when-the-photo-check-fails.md`](./when-the-photo-check-fails.md) ("New cats to check") · [`find-from-a-photo-whole-island.md`](./find-from-a-photo-whole-island.md) (photo fingerprints) · [`photo-tips-and-extra-photos.md`](./photo-tips-and-extra-photos.md) · [`spotted-stamps.md`](./spotted-stamps.md) · [`roles-and-invites.md`](./roles-and-invites.md) §6.2 · the proposal, §6 "When the same cat gets counted twice".

---

## 1. The short version

The record goes wrong in two ways:

- **A photo is filed under the wrong cat.** A spotter taps a lookalike, picks the wrong cat by hand, or snaps two cats at one feeding spot. The photo, and anything the spotter said with it ("ear tip clipped"), is on the wrong cat.
- **One cat is in the app twice.** Two people photograph the same cat, the app doesn't offer a match, and each adds it under a different name. Duplicates are the biggest threat to the charity's numbers: each one inflates the island count, lowers the share of cats sterilised, and can put a cat that doesn't exist on a trapping list.

This spec gives Syros Cats one set of tools for both, on the dashboard:

| Tool | What it does |
|---|---|
| **Move** | Files a sighting under the right cat. |
| **Move just this photo** | Takes one photo out of a spot and makes it a sighting of the right cat. |
| **Move to a new cat** | Starts a new cat from the photo. Moving several sightings at once splits one record into two cats. |
| **Merge** | Makes two records of one cat into one. |
| **Undo** | Any of the above can be undone. Nothing is ever deleted. |

**It also gives everyone ways to spot a duplicate:** a spotter asked "Are these the same cat?", a quiet check whenever a new cat is added, a nightly look-alike sweep, "This might be the same cat as…" on any cat's page, the matching game's "same cat" votes, and the team's own eye. They all feed one team list, **Possible duplicates**. **Nothing is merged without a person on the team confirming it**, because wrongly joining two different cats would be worse than the duplicate was.

**Nobody loses by being honest.** Spotters keep their points and their discovery credit whenever a photo is moved or two cats are merged. Whoever first reported a duplicate earns points once the team confirms it.

---

## 2. Who does what

| Who | What they can do |
|---|---|
| **Spotters** (in the app) | Answer "Are these the same cat?" after a spot. Tap "This might be the same cat as…" on a cat's page. Play the matching game. |
| **The Syros Cats team** (on the dashboard; staff and management) | Move, split, make a new cat, merge, undo. Work through Possible duplicates. |
| **Cat guardians and vets** | Nothing new in this version (decision D5). A guardian can still report a duplicate from the app like any spotter. |

---

## 3. Spotting a duplicate

### 3.1 Six ways in

All six feed **Possible duplicates** (§3.3). None of them changes a cat.

1. **"Are these the same cat?"** (decision D8). A spotter confirms a suggested match for Agatha, and the photo check also suggested Mimi, scoring nearly as high. After the usual questions, the reward screen asks one more, optional: Agatha's and Mimi's main photos side by side, *"These two look alike. Are they the same cat?"*, with **Same cat** · **Different cats** · **Not sure**. The spotter has just seen the cat, and the question shows their own photo above the two.
   - It's asked at most once per spot.
   - It's never asked about a pair the team has already decided.
   - It's never asked about a cat recorded as having died.
2. **A quiet check when a new cat is added.** It never blocks the spotter, who may well be right. The new cat goes on the list if either of these is true:
   - the photo check had suggested an existing cat and the spotter still chose "New cat";
   - the photo check failed, so nothing was compared. Those cats are also on "New cats to check" (SYC-531).
3. **A nightly look-alike sweep** (decision D11). Each night the app compares the main photos of cats within 1.5 km of each other, using the photo fingerprints behind "Find from a photo". Pairs that look very alike join the list, at most 10 new pairs a night, closest look-alikes first. It's an on/off switch on the App switches page. It stays **off until it has been tested** against pairs the team has already decided, because fingerprints compare whole photos, and two cats at the same feeding spot share a background.
4. **"This might be the same cat as…"** on any cat's page in the app (decision D9). It opens the nearby cats list with search, the same screen as "Find the cat yourself" (`choose-a-different-cat.md` §3.2). The spotter picks the other cat, checks the two side by side, and taps **"Report it"**. They're told *"Thanks. Syros Cats will take a look."*
   - It only offers cats near this one, as hand picks do.
   - Each phone can send at most 5 reports a day, and each internet address at most 20.
   - The report is never shown publicly, and the reply is the same whether or not the team has already looked at that pair.
5. **The matching game.** A *"Players think Mikis and Ermis are one cat"* row (`matching-game.md` §7.2) is on the list.
6. **The team's own eye.** Any team cat page has **"Same cat as…"**, which goes straight to the merge screen (§4).

### 3.2 How sure we are

This uses the same ladder as everything else in the record:

| Level | What puts a pair there | Where it sorts |
|---|---|---|
| **Possible** | One report or one check | Lower down the list |
| **Likely** | Independent agreement: two people say "same cat" on different days; or one person says so and the nightly sweep found the pair too; or the matching game's "same cat" row | Top of the list |
| **Same cat** | A team member confirms it and merges | Off the list, merged |

A "different cats" answer from a spotter is recorded and shown to the team, but it never takes a pair off the list on its own.

**Who counts as a person here.** A new phone costs nothing to set up, so a report only counts towards *Likely*, and only earns points, from a phone with at least three matched spots on three different days. Reports from other phones still appear on the list, marked *"new phone"*.

### 3.3 The Possible duplicates list

The list sits on the dashboard in the "fixing what is wrong" area, below the welfare queue and "Report an issue". A duplicate is not an emergency.

- **Each row** shows the two cats side by side: main photo plus two recent photos each, name, SYR number, colours and pattern, colony, and how far apart their map squares are. It also says why the pair is here, in plain words: *"2 spotters said same cat · fingerprints very alike · Mimi was added while the photo check was down"*. Reports from spotters show who sent them (nickname or "a spotter"), so the team can see if one phone is sending a lot.
- **Three buttons:**
  - **Same cat, merge…** opens the merge screen (§4).
  - **Different cats** takes the pair off the list. It only comes back with new evidence after that decision: two new people saying "same cat", or the sweep finding the pair again after one of the cats has a new main photo. The pair is never asked about again in "Are these the same cat?".
  - **Not sure yet** keeps the row and lets the team note what would settle it ("needs a clear face photo of Mimi"). That note shows on both cats' team pages.
- Order: Likely first, then newest. Rows nobody decides fade from view after 60 days but are kept, like "Matched by hand".
- **"New cats to check"** (SYC-531) is the Home tile for cats added while the photo check was down. Each of its cats shows the nearby cats' photos beside it, a **"Same as…"** button that opens the merge screen, and a **"Checked, it's new"** button so the list can empty.

### 3.4 Points for finding a duplicate

**When the team merges a pair, each phone that reported it before the merge earns 10 points** (decision D10). That covers people who reported it through "Are these the same cat?" (answering Same) or through "This might be the same cat as…". Each phone earns once per pair of cats, ever, however many times it reported the pair and even if the merge is undone and made again. Only phones that count as a person (§3.2) earn.

- The points are counted the moment the merge is saved.
- The spotter sees an in-app line: *"You spotted that Mimi and Agatha are the same cat. Syros Cats agreed. +10 points."*
- **Undoing the merge doesn't take the points back.** Taking points away would punish people for the team's change of mind.
- Matching game players get the game's own rewards, not these.

---

## 4. Merging two records into one

### 4.1 The merge screen

The screen opens from Possible duplicates, "New cats to check", "Same cat as…" on a team cat page, or moving a cat's last sighting (§5.3).

- **The two cats side by side**, with every photo of each, their names, SYR numbers, colonies, sterilised and life status, owners and followers.
- **"Which record stays?"** (decision D7). The record that stays keeps its name, SYR number, main photo, map spot, colour and markings. The other record's name becomes **"also known as"**. The earlier record is chosen by default, unless its name is still waiting for a spotter (an SYR number), in which case the named one is. The team member can switch it, with two limits:
  - **A cat with an owner always stays.** An owner never moves from one record to another.
  - **A record whose name is still pending can't stay when the other has a name.** The team names it first.
- **"What happens"** is a plain list, shown before anything is saved:
  > **Mimi** becomes part of **Agatha**. Agatha will have 14 sightings (9 + 5).
  > Also known as: Mimi.
  > Sterilised: Likely, from Mimi's clipped ear (was Unknown).
  > Colony: Vaporia. Mimi was in Ano Syros; change it after merging if that's wrong.
  > Colour: Agatha's (ginger). Mimi was recorded as ginger and white; change it after merging if that's wrong.
  > Owner: Agatha keeps hers. Mimi has none.
  > 3 people follow Mimi; they'll follow Agatha.
  > Cat guardian Eleni (Ano Syros) will no longer see this cat; Maria's colony (Vaporia) keeps it.
  > 2 spotters who reported this get 10 points each.
  > The island count goes down by one.
- **"Why?"** A required short reason, for example *"Same face markings and torn left ear"*.
- **"Merge"** button.

**Warnings, only when they're true:**

| When | What it says |
|---|---|
| Their map squares are more than 2 km apart | *"These two are usually seen 3.1 km apart."* |
| They're in different colonies | *"Mimi is in Ano Syros and Agatha in Vaporia. After merging she'll show as Vaporia."* |
| One is recorded as having died, and the other has been seen since | *"Mimi is recorded as having died in May. Agatha was seen in September, so the merged record will say alive."* |
| Only the other record has a colony | *"Only Mimi is in a colony (Ano Syros). After merging, Agatha will be in Ano Syros."* |
| Both have an owner | **Blocks the merge:** *"Both cats have an owner. Remove one owner first."* Two people both claiming one cat is something for the team to sort out with them. |

### 4.2 What a merge does

In plain words: **the two records become one, and nothing either record said is lost.**

- **Every sighting of Mimi is filed under Agatha**, each recorded as a move with the reason "merged". So Agatha's photos, "last seen", sighting count and History show them. Every spotter's collection and Spotted stamps show Agatha.
- **Everything else recorded about Mimi counts for Agatha too**: vet visits and their photos, sterilisation, life status, colony, notes, welfare reports. This works through one record, "Mimi is Agatha", which every part of the app reads (§9.3). Nothing is copied or rewritten.
- **Colour and markings are the staying record's own** (`choose-a-different-cat.md` §8.5). They describe the main photo, which is Agatha's. If Mimi's said something different, the merge screen showed it, and the team corrects Agatha afterwards if needed.
- **Sterilised and life status are worked out again over both records together**, by the usual rules. A vet's statement on either record outranks a spotter's clipped ear on either. A sighting of either cat after a "died" statement on the other shows the cat alive.
- **Names:** Agatha keeps her name. "Mimi" becomes *also known as*. It still finds Agatha in search, and in the "There's already a cat called Mimi" prompt (`choose-a-different-cat.md` §3.1). Nobody can give a new cat the name Mimi while she's part of Agatha.
- **Followers:** everyone following Mimi now follows Agatha, unless they had unfollowed Agatha before. They see one in-app line: *"Mimi and Agatha turned out to be the same cat. You now follow Agatha."* (decision D4).
- **Owner:** the staying record keeps its owner, if any. The other never has one (§4.1). The waiting periods after an owner lets go of a cat or is removed (`claiming-a-cat.md`) are checked against both records.
- **Points and credit:** unchanged for everyone. Both spotters who discovered a record keep the credit for it.
- **Mimi's page:** opening Mimi in the app (an old link, a notification, a phone that hasn't refreshed yet) shows Agatha's page, with *"Mimi is now part of Agatha's record"* at the top. Mimi drops out of the cat list, the map, the photo check's candidates and the nearby list.
- **The island count** goes down by one. That's the point.
- **A merge is a correction, never news.** Followers aren't told "Agatha was sterilised" because a merge combined two records.

### 4.3 What the team sees afterwards

- **Agatha's History** gets *"Merged with Mimi by Maria, 26 Oct: 'Same face markings and torn left ear'"*, with **Undo merge** in its ⋯ menu. Mimi's sightings and statements appear among Agatha's, each with a small "from Mimi" tag.
- **Mimi's team page** says *"Mimi was merged into Agatha on 26 Oct by Maria"*, with links to Agatha and to Undo. Team search finds her as *"Mimi (now part of Agatha)"*.

### 4.4 Undoing a merge

**Undo merge** asks for a reason, then shows what it will do:

- Every sighting the merge moved goes back to Mimi.
- Mimi's statements stop counting for Agatha.
- Followers the merge added to Agatha are removed, unless they had followed Agatha before the merge.
- **Answers a spotter added after the merge** to one of Mimi's sightings go back to Mimi with the sighting.
- **Sightings filed under Agatha since the merge**, and Mimi's sightings the team moved again after the merge, stay where they are. The undo screen lists them with their photos and a tick box each, *"Tick any that are Mimi."* Ticked ones are moved to Mimi.
- Duplicate-finder points are kept (§3.4). The pair goes back on Possible duplicates marked *"merge undone"*, so it isn't asked about blindly again.

### 4.5 Chains

If Mimi is merged into Agatha, and Agatha is later merged into Dora, Mimi's records count for Dora too. Merges are undone newest first: while Agatha is part of Dora, "Undo merge" on Mimi says *"Undo Agatha's merge into Dora first."* Undoing Agatha's merge leaves Mimi part of Agatha.

---

## 5. Moving a photo to the right cat

### 5.1 Ways in, and who

There are four ways in, all leading to the same move screen:

1. **A cat's History** (`team-cat-page-redesign.md` §3.5). A sighting row's ⋯ menu has **"Move to a different cat…"** and **"Move to a new cat"**, and tick boxes let the team move several sightings at once. A spot with more than one photo also has **"Move just this photo…"** on each photo except its cover photo.
2. **"Matched by hand"** (SYC-152): its **Different cat…** and **It's a new cat** buttons.
3. **Report an issue**: a "That's a different cat" report has **"Move to the right cat"**. Moving the photo closes the report as done.
4. **The matching game's "Players think this sighting isn't Mikis" row** (`matching-game.md` §7.2): its **Re-file** button.

Anyone on the team can move (decision D5).

### 5.2 The move screen

- **At the top:** the photo (or photos) being moved, with date and map square, beside the cat they're filed under now: its main photo and two recent ones.
- **"Which cat is it?"** Search the whole island by name (any "also known as" too) or SYR number. Cats near the photo come first. **"It's a new cat"** sits below.
- **"Why?"** A required short reason: *"Different markings"*, *"Two cats in the photo"*, *"Wrong cat picked"*, or *"Other…"*.
- **"What moves"** is a plain list:
  > Moves to **Agatha**: this photo, "ear tip clipped (left)", "food and water were out", and the spotter's note.
  > **Mimi** keeps 6 sightings.
  > The spotter keeps their 15 points.
- **If the photo is the cat's main photo**, the team member picks the cat's new main photo, or "No photo for now". The app never picks one by itself, because the newest other photo might be another wrong match (`choose-a-different-cat.md` §8.4).
- **"Move"** button.

**Warnings, only when they're true:**

| When | What it says |
|---|---|
| The chosen cat is recorded as having died, and the photo is newer than that record | *"Agatha is recorded as having died. Moving this photo says she was seen alive on 3 October, which will change her record back to alive."* A team move is a deliberate judgement, so it may do this, unlike a spotter's hand pick (`choose-a-different-cat.md` §4.3). |
| The photo said "ear tip clipped", and that will make the chosen cat *Likely* sterilised | *"Agatha will go on the Likely list for a check."* |
| The photo is over 1 km from where the chosen cat is usually seen | *"This photo was taken 2.3 km from where Agatha is usually seen."* |
| The photo is hidden | *"This photo is hidden and stays hidden after the move. If the only reason was the wrong cat, show it again from the photo's own menu."* |

### 5.3 Moving a cat's last sighting (decision D1, answered)

If moving the photos would leave a cat with **nothing at all** (no other photo, no vet visit, no report, nothing anyone has recorded), the two records are the same cat. The move screen says so and offers the merge instead: *"This is everything Mimi has, so Mimi and Agatha are the same cat. Merge Mimi into Agatha?"* The button opens the merge screen with both cats filled in. "It's a new cat" isn't offered, because Mimi already is a cat of her own.

### 5.4 When the photo that started a cat moves (decision D6)

The first sighting of a cat created it: its name, its discoverer and its map spot came from it. If that photo moves but the cat keeps other records:

- **the cat keeps its name**, and the spotter who started it keeps the credit for finding it;
- **its map spot moves to its earliest remaining sighting**, so the map shows where this cat is found, not where the other cat was.

### 5.5 "It's a new cat"

The team member types a name, or ticks **"Let spotters name it"** (decision D3). With the tick, the new cat shows its SYR number until someone names it (`syc-709-naming-limits.md`), and **the spotter whose photo started it may name it.**

- Its main photo is the moved photo, and its map spot is where the photo was taken.
- **The spotter is its discoverer.**
- **No extra points.** The spotter keeps the 15 they earned. The 25 for a new cat is only earned when a spotter adds one.

**Splitting a record into two:** tick several of a cat's sightings, then "Move to a new cat". The first ticked sighting (the oldest) starts the new cat, and the rest are moved to it, all in one step with one reason.

### 5.6 Moving one photo out of a spot (decision D2)

A spot can hold a first photo, a face photo and a body photo (SYC-415). Its cover photo is the one it's filed by.

- **Moving the cover photo moves the whole spot.** If another of its photos really did show the old cat, the team moves that one back afterwards.
- **Moving any other photo** takes it out of the spot and makes it a **new sighting of its own on the right cat**: same spotter, same place, same time, remembering which spot it came from.
  - It counts for last seen, the spotter's collection and stamps, and as evidence the cat was alive.
  - It earns no points.
  - The spotter's answers stay with the original spot, because they were answering about the cover photo's cat.
- **A photo is never copied.** It keeps its internal id, so its hidden-and-restored history stays intact. That history is what stops a report hiding a photo the team has deliberately shown again (`report-an-issue.md`, SYC-279).

### 5.7 What happens to the record

**A move is a new record, made by a named person on a date, and nothing said before is lost.**

1. **A move record** says which sighting (or photo), from which cat, to which cat, who, when and why. It's never changed. Moving back is another move.
2. **The sighting is filed under the right cat.** The database refuses this change unless a move record is written at the same moment.
3. **What the spotter said is copied onto the right cat**: ear tip, food and water, note. The copy says it replaces the original, and the original stops counting for the old cat. Both stay in the record.

**The copy is still the spotter's answer, not the team member's.** Putting it in the team member's name would quietly turn a spotter's guess into a team statement, which counts for far more. The move record says who moved it.

**Someone else's answer about the photo** (for example, the team agreeing the photo shows a clipped ear) is withdrawn from the old cat, not copied. That person was judging the photo as if it were the old cat. If the spotter's "clipped" moves, the new cat goes on the Likely list and the team looks again.

**An answer sent after the move** (a spotter can add details for 30 days, `add-details-later.md`) goes to the cat the sighting is filed under at that moment.

### 5.8 What each cat works out again

| | The cat it left | The cat it joined |
|---|---|---|
| **Sterilised** | A clipped ear from this photo stops counting. *Likely* can go back to *Unknown*. | A clipped ear from this photo counts. *Unknown* can become *Likely*, unless the team has said this cat's ear isn't clipped. |
| **Last seen, presumed died** | The sighting stops counting. Last seen can go back in time. | The sighting counts on the day the photo was taken, never the day it was moved. |
| **Main photo** | Chosen by the team member on the move screen if it was this photo. With "No photo for now", it shows the placeholder, and a colour read from the moved photo stops counting. | Unchanged, except on a cat made by "It's a new cat". |

**A move is a correction, never news.** No push, no email, and no "seen again" for either cat.

### 5.9 The spotter

- **Points:** unchanged.
- **Collection, Spotted stamps, cats-spotted badges:** follow the right cat. Badges already awarded are kept.
- **Following:** the spotter starts following the right cat, as a match would have done, unless they unfollowed it before. They keep following the old cat.
- **Claiming and naming:** a sighting the team moved to an existing cat, or a photo split out of a spot, doesn't count as "meeting" that cat (`claiming-a-cat.md` §16, SYC-709). One exception: after "It's a new cat" with "Let spotters name it", the spotter whose photo started the cat may **name** it, but not claim it as theirs (decision D3).
- **Telling them:** no push. Their own spot shows *"Syros Cats filed this under Agatha"* next time they open it (decision D4).

---

## 6. Rules that keep it safe

- **Only a matched sighting can move.** A spot still waiting for its spotter, or for "Ask Syros Cats to match it", gets matched, not moved.
- **Never to the same cat, and never to a merged-away cat.** Mimi, once part of Agatha, means Agatha.
- **Two people at once:** the screen sends what it expects to find. If someone else changed it first, the second person sees *"Someone changed this a moment ago"* with the current state, and nothing happens.
- **All or nothing.** Everything in one move, merge or undo is saved together, or none of it is.
- **Looking back:** a report or History "as it stood on 1 October" shows each sighting where it was filed then, and each merge as it stood then.
- **Nothing is deleted**, ever. Every move, merge and undo is a dated record of who did it and why.

---

## 7. Decisions for Samuel

Each goes to Samuel one at a time, in plain English, before approval. The recommendation is what the sections above describe.

| # | Question | Recommendation |
|---|---|---|
| D1 | The photo would leave a cat with nothing: what then? | **Answered 26 Oct: design it with merging.** The move screen offers the merge (§5.3). |
| D2 | One photo out of a spot: its own sighting, a photo on the cat, or hide only? | Its own sighting, no points |
| D3 | "It's a new cat": who names it? | The team types a name, or lets the spotter who found it name it |
| D4 | Telling people (the spotter whose photo moved, followers of a merged cat) | A quiet in-app line, no push |
| D5 | Who can move and merge? | The team (staff and management) only |
| D6 | The photo that started a cat moves: name, credit and map spot? | Name and credit stay; the map spot moves to the earliest remaining sighting |
| D7 | Which record stays in a merge, and whose name? | The earlier record and its name, unless its name is still pending; the team can switch, but a cat with an owner always stays |
| D8 | Ask spotters "Are these the same cat?" after a spot? | Yes, at most once per spot, only when two suggested cats look alike |
| D9 | "This might be the same cat as…" on cat pages for everyone? | Yes, nearby cats only, 5 a day per phone, reports seen by the team only; only established phones count towards *Likely* |
| D10 | Points for reporting a duplicate the team confirms? | 10 points to each established phone that reported it before the merge, once per pair ever; kept if the merge is undone |
| D11 | A nightly look-alike sweep? | Build it, behind a switch that stays off until tested on decided pairs; at most 10 new pairs a night |

---

## 8. What this doesn't cover

- **Moving a vet-visit photo.** A visit on the wrong cat is marked wrong and logged again (SYC-677).
- **Moving a welfare report** to another cat: re-tying, SYC-43.
- **Topping up points** to 25 when the team makes a new cat.
- **Cat guardians moving or merging** in their own colonies (D5).
- **Spotters moving their own photo** after matching it.
- **The matching game itself** (SYC-402). This spec makes its "same cat" and "Re-file" buttons real.

---

## 9. Technical specification

### 9.1 The move record

```ts
// lib/db/src/schema/sightingMoves.ts — add-only; its own guard trigger (9.4)
export const sightingMovesTable = pgTable("sighting_moves", {
  id: serial("id").primaryKey(),
  sightingId: integer("sighting_id").notNull(),     // the spot moved, or split from
  photoId: integer("photo_id"),                     // set only when one photo is split out
  newSightingId: integer("new_sighting_id"),        // the split-out sighting; set exactly when photoId is
  fromCatId: integer("from_cat_id").notNull(),      // canonical ids at the time
  toCatId: integer("to_cat_id").notNull(),
  madeNewCat: boolean("made_new_cat").notNull().default(false),
  letSpottersName: boolean("let_spotters_name").notNull().default(false),
  mergeId: integer("merge_id"),                     // set when a merge or its undo made this move
  batchId: uuid("batch_id").notNull(),              // the moves saved together (a multi-select, a merge)
  reason: text("reason").notNull(),                 // different_markings | two_cats | wrong_pick | other | merged | merge_undone
  reasonText: text("reason_text"),
  source: text("source").notNull(),                 // cat_page | matched_by_hand | report | game | merge | undo
  movedByAccountId: text("moved_by_account_id"),    // null only once redacted
  roleAtTime: text("role_at_time").notNull(),       // staff | management
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  txid: bigint("txid", { mode: "number" }).notNull().default(sql`txid_current()`), // 9.4
  redactedAt: timestamp("redacted_at", { withTimezone: true }),
}, (t) => [
  index("sighting_moves_sighting_idx").on(t.sightingId, t.id),
  index("sighting_moves_new_sighting_idx").on(t.newSightingId),
  index("sighting_moves_merge_idx").on(t.mergeId),
]);
// CHECKs: fromCatId <> toCatId; (photoId is null) = (newSightingId is null);
// letSpottersName only with madeNewCat; reason merged|merge_undone exactly when mergeId is set;
// movedByAccountId null only when redactedAt is set.
```

### 9.2 Merges: `cat_identity`, extended

`cat_identity` (data spine §10.3) is the merge record. It is add-only, and an undo is a new row, as today. It gains these columns:

```ts
  reasonText: text("reason_text"),
  byAccountId: text("by_account_id"),            // replaces the untyped created_by for new rows; null only once redacted
  roleAtTime: text("role_at_time"),
  survivorChosen: text("survivor_chosen"),       // default | switched
  txid: bigint("txid", { mode: "number" }).notNull().default(sql`txid_current()`), // 9.4
  redactedAt: timestamp("redacted_at", { withTimezone: true }),
```

- A **merge** is `(cat_id = Mimi, canonical_cat_id = Agatha)`.
- An **undo** is `(cat_id = Mimi, canonical_cat_id = Mimi, supersedes_id = <the merge>)`. That's the shape existing code and tests already expect (`asOf.test.ts`, `claiming.test.ts`).
- `cat_identity_append_only` is replaced by a trigger that allows only redaction (clear `by_account_id`, stamp `redacted_at`).
- **Undo newest first (§4.5):** an undo is refused while the merge's survivor is itself merged away by a standing merge (`UNDO_LATER_MERGE_FIRST`).
- **No resolved sighting is ever filed under a merged-away cat.** The sightings trigger refuses setting `cat_id` to a cat with a standing merge-away row. A constraint trigger on `cat_identity`, deferred to commit, refuses a merge while any resolved sighting still names the merged-away cat. Resolve re-reads the canonical cat after taking its cat lock, and files under the survivor.

### 9.3 One reader of merges (SYC-410)

`canonicalCatOf` and `catsFeeding` live in one module, `lib/catIdentity.ts`, extending `capabilityTargets.ts`'s `canonicalCats`:

- It follows chains, at most 8 hops, with a loop guard.
- A merge row stops counting once an undo supersedes it.
- Where several rows stand for one cat, the newest wins.
- `asOf` is honoured.

**Every reader of `cat_identity` uses it**: `loadCatRecords`, `claiming.ts` (the merged-away refusal and `hasMetCat`), `capabilityTargets.ts` and `teamCatList.ts`, plus `coatReading/due.ts`. A source test bans any other query on `cat_identity`.

**Two more source tests close the gap the review found**, where readers never touch `cat_identity` at all:
- **Live cats.** One helper, `liveCats` (a cat with no standing merge-away row), is the only way to list or count cats. A source test bans `from(catsTable)` outside an allowlist of single-cat loads by id. That covers `totalCatCount` (the "12 of 142" total), `listCatsWithStats`, `trappingPlan.ts`, `colonyCats.ts`, `reports/progress.ts`, the nightly news walker and the matcher candidate pool.
- **Statements by cat.** Any read of `observations` by cat id goes through `catsFeeding(cat)`, so it covers every cat merged in. A source test bans `eq(observationsTable.catId, …)` and `inArray(observationsTable.catId, …)` outside an allowlist. The plan lists every current reader. Known ones are `vetVisits.ts` `visitsFor` and its photos, `reports/vetCosts.ts`, `teamColonies.ts`, `colonyMembership.ts`, `movedAway.ts`, `guardianChanges.ts`, `dashboard/colonyFigures.ts`, `routes/cats.ts` (care timeline), `teamCorrections.ts` and `welfareTie.ts`. The same goes for cat-keyed tables: `vet_visit_photos`, `vet_batch_cats` and `teamOnlyPhotos.ts`.
- **Kept to the staying record by design:** `coat` and `markings` (§4.2). `catsFeeding` takes an `exclude: ["coat", "markings"]` option, and `resolveCoat`/`resolveMarkings` read only the survivor's own rows. This fixes today's bugs:
- `loadCatRecords` still folds in an undone merge.
- `due.ts` mistreats an undone merge.
- Every reader except `canonicalCats` goes one level only.

**Readers that must stop showing a merged-away cat, or show its survivor:**

| Reader | Change |
|---|---|
| `GET /cats` (`listCatsWithStats`), public map data | Leave out merged-away cats |
| `GET /cats/:id` | For a merged-away id, return the survivor's page with `mergedFrom: { id, name }`. The phone shows "Mimi is now part of Agatha's record" |
| Matcher candidate pool (`routes/sightings.ts`), `findFromPhoto.ts`, the nearby list | Leave out merged-away cats (`liveCats`) |
| `matcherHealth.ts` miss scoring, the matching game's judgements and deck retirement (`matching-game.md` §4.2) | Compare canonical cats |
| Nightly news walker (`lib/news/nightly.ts`) | Skip merged-away cats. Re-baseline the survivor at merge time, so the combined timeline can't produce a false "seen again" |
| `POST /sightings/:id/resolve` with a `catId`, follow, `POST /cats/:id/name`, let-go, `PATCH /cats/:id`, and team correction routes | Act on the survivor (`canonicalCatOf`). Name and claim actions on a merged-away id are refused with `MERGED`, plus the survivor's id |
| `writeObservation` same-cat checks (the two `TODO(SYC-59)`s) | Compare canonical cats |
| `agreeWithClip` | Resolve the canonical cat and lock it |
| Claim waits (`letGoWithinDays`, `removedByTeamWithinDays`) | Check every cat feeding the survivor |
| `welfare_reports` readers on a cat page, `cat_updates`/notifications list | Show under the survivor (by `catsFeeding`) |
| `searchTeamCats`, the move and merge search | Match current names and every name of a merged-in cat ("also known as"). A merged-away cat shows as "Mimi (now part of Agatha)" |
| Name-taken prompt (`catNames.ts` NAME_TAKEN holder) | Names the survivor |
| `newCatsAfterFailedCheck` (New cats to check) | Leave out merged-away cats and cats in `new_cat_checks` |
| Phone cache | No change needed. The next `GET /cats` drops Mimi, and an old link opens Agatha through `GET /cats/:id` |

### 9.4 Database guards

All guards prove "in this move" or "in this merge" through a **transaction-local setting**, never by finding an older row. The writer calls `set_config('app.sighting_move_id', …, true)` or `('app.cat_merge_id', …, true)` after inserting its row. Each trigger below checks that the row with that id has `txid = txid_current()` (the column defaults to it at insert; `xmin` is not used, because it is a different type and differs inside a savepoint) and matches.

- **`sighting_moves_append_only`:** refuses DELETE and TRUNCATE, and refuses every UPDATE except redaction.
- **`sightings_append_only`** gains its own branch:
  - **Move:** on a `resolved` sighting whose old `cat_id` is not null, `cat_id` changes from the current move row's `from_cat_id` to its `to_cat_id`. Every other column must be unchanged.
  - **Split:** an INSERT that arrives `resolved` with a cat, and arrives redacted if its source was, is allowed only when the current move row names its id as `new_sighting_id`. The id is taken first with `nextval`.
  - **A merge moves many sightings**, so the setting holds the merge's id. Each sighting's change needs a move row in this transaction with that `merge_id` and that sighting.
- **`observations_append_only`:** an INSERT that arrives redacted, or that sets `sighting_move_id`, is allowed only with the current move.
- **`sighting_photos`:** a split removes the photo's row from the old spot and adds it to the new one as `role = 'first'`, `position = 1`, with the same `photo_id`. The cover photo can never be split out.
- **A split-out sighting copies** `device_id`, `lat`, `lng`, `created_at`, `area_key`, `on_island` and the redaction stamp, with `photo_id` set to the moved photo.

### 9.5 Statements when a sighting moves

- New column `observations.sighting_move_id`, nullable, no foreign key.
- **The spotter's rows (copied):** the copy takes every column of the original except `cat_id` (the new cat), `supersedes_id` (the original), `supersede_reason = 'moved'` and `sighting_move_id`. `ear_tip` is a ranked kind, so `writeObservation` refuses cross-cat supersession. The move's own writer, `writeMovedObservation`, is the only code allowed to set `sighting_move_id`, and a source test bans every other writer.
- **Everyone else's rows on the sighting (withdrawn):** a `{ retracted: true }` row on **the original row's own cat id** (after a merge that may be the merged-away cat, never a cross-cat write), of the same kind, superseding the original. It carries the mover as author, `supersede_reason = 'moved'`, `sighting_move_id`, **the sighting's id and the original row's `observed_at`**, so it is never evidence of life. Only `writeMovedObservation` may write it, and only for a row carrying the moved sighting's id.
- **How the old cat stops counting a copied row:** `loadCatRecords` adds, for each cat it loads, rows on cats outside that cat's group that replace one of its rows and carry a `sighting_move_id`. These are marked `elsewhere: true`. Existing supersession checks (`isActive`, `supersedeChains`) then work unchanged, History can show "now on Agatha", and no fold counts an `elsewhere` row. The `welfare_report`-only cross-cat query becomes the same mechanism.
- **A merge's moves copy nothing.** The merged-away cat's statements already count for the survivor through §9.3. On undo they stop counting the same way, so copying would count them twice.
- **Undo copies one thing:** a statement written on the survivor after the merge that carries the id of a sighting the undo moves back (a late answer). It's copied to the merged-away cat with ordinary move semantics, and listed on the undo screen.

**Readers that load statements without `loadCatRecords`**, each changed and tested:

| Reader | Change |
|---|---|
| `earTipStateFor`, `hasAnsweredEarTip` | Ignore rows replaced by a move. Read through the canonical cat |
| `agreeWithClip` | Refuse a row replaced by a move (`MOVED`) |
| `capabilityTargets.ts` `catsOfPhoto` | A photo belongs to the cat its sighting is filed under now |
| `likelyReview.ts`, `handPick.ts` | Hand-picked only when `chosen_cat_id` is the statement's own canonical cat |
| `matcherHealth.ts` | Use the match record's chosen cat |
| `sightingRoundUp.ts` | Join on `s.cat_id = cu.cat_id` |

### 9.6 Duplicate reports and decisions

```ts
// lib/db/src/schema/duplicates.ts
export const duplicateReportsTable = pgTable("duplicate_reports", {
  id: serial("id").primaryKey(),
  catLow: integer("cat_low").notNull(),          // canonical ids at the time, low < high
  catHigh: integer("cat_high").notNull(),
  source: text("source").notNull(),              // spotter_question | cat_page | new_cat_check | sweep | game | team
  says: text("says").notNull(),                  // same | different | not_sure
  deviceId: text("device_id"),                   // spotter sources; null once redacted
  sightingId: integer("sighting_id"),            // spotter_question, new_cat_check
  score: real("score"),                          // sweep, new_cat_check: fingerprint likeness
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  redactedAt: timestamp("redacted_at", { withTimezone: true }),
});
export const duplicateDecisionsTable = pgTable("duplicate_decisions", {
  id: serial("id").primaryKey(),
  catLow: integer("cat_low").notNull(),
  catHigh: integer("cat_high").notNull(),
  decision: text("decision").notNull(),          // merged | different | not_sure | merge_undone
  mergeId: integer("merge_id"),                  // with merged, merge_undone
  note: text("note"),
  byAccountId: text("by_account_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  redactedAt: timestamp("redacted_at", { withTimezone: true }),
});
```

- **"Checked, it's new"** is about one cat, so it has its own add-only table, `new_cat_checks (cat_id, by_account_id, created_at, redacted_at)`.
- **Both are add-only.** A pair's state is its newest decision. A "different" pair reopens only with two `same` reports from counting phones dated after the decision, or a `sweep` report made after one of the two cats' main photo changed after the decision. The sweep skips a decided pair otherwise.
- **A counting phone** has at least three resolved sightings on three different Syros days. The ladder and the points use only counting phones' reports.
- **Reports from a deleted spotter** are severed like sightings (§8 of the data spine): the device is cleared and `redacted_at` stamped. Each cleared report still counts as evidence, and all of one person's cleared reports count as one voice.
- **Ladder (§3.2), worked out on read:**
  - *Likely* = two `same` reports from different counting phones on different Syros days; or one `same` plus a `sweep` report; or a `game` report.
  - The photo check's near-tie (below) only decides whether to **ask**. Two look-alikes scoring close is exactly what two different cats produce, so it's never evidence on its own.
  - *Possible* = anything else open.
- **"Are these the same cat?"** is offered in the resolve response (`duplicateQuestion: { catId, otherCatId }`) when both cats are in the sighting's stored suggestions at or above 0.4, within 0.15 of each other, neither is deceased, and the pair has no decision. One answer per sighting, sent with the other answers (`POST /sightings/:id/answers`, `duplicate: "same" | "different" | "not_sure"`).
- **"This might be the same cat as…":** `POST /cats/:id/duplicate-report { otherCatId }`. The other cat must be in the reporting phone's nearby set for this cat (§3.1 point 4). The limits are 5 a day per device and 20 per address (`lib/limits.ts`). The response is the same `202` whatever the pair's state, so the route never reveals a team decision.
- **New cat check:** at resolve with `new_cat`, a `new_cat_check` report is written for each stored suggestion at or above 0.4 that the spotter passed over (`sighting_matches.suggested`). A cat added with `matcher_failed` is on "New cats to check" instead. No fingerprint is needed at this point.
- **Nightly sweep:** behind the app switch `duplicate_sweep`, off by default. It compares pairs of live cats whose map squares are within 1.5 km, by main-photo fingerprint, skipping cats with no fingerprint. It writes `sweep` reports for the 10 highest-scoring pairs above `SWEEP_THRESHOLD` that have no decision (or qualify under the reopen rule) and no `sweep` report in the last 90 days.
- **The threshold is calibrated, not guessed.** Fingerprints are whole-photo comparisons, checked so far only for "the right cat is in the top 20", and backgrounds sway them. Before the switch is turned on, `SWEEP_THRESHOLD` is set from pairs the team has decided (merged or "different"). The acceptance test: on those pairs, at least 3 in 4 of the sweep's top 10 would have been "same cat".
- **Capabilities:** `review_duplicates` (island, TEAM) for the list, and `merge_cats` (island, TEAM) for merging and undoing. Both are added to `roles-and-invites.md` §6.2.
- **Names shown as "also known as"** are only ever the merged-away cat's current name, which has already passed the name checks. A name the team replaced is never shown.

### 9.7 The routes

**Move:** `POST /api/team/sightings/move`, capability `move_sighting` (island, TEAM).

```ts
{ sightingIds: number[], expectedCatId: number,     // one or more sightings, all on expectedCatId
  toCatId?: number, newCat?: { name?: string, letSpottersName: boolean },
  photoId?: number,                                  // split this photo out; needs exactly one sightingId
  newMainPhotoId?: number | 0,
  reason, reasonText?, source, reportId? }
```

**Merge:** `POST /api/team/cats/merge`, capability `merge_cats`.

```ts
{ survivorId: number, mergedId: number, expectedSightingCounts: [number, number],
  reasonText: string, survivorChosen: "default" | "switched" }
```

**Undo:** `POST /api/team/cats/merge/:id/undo { reasonText, alsoMoveSightingIds: number[] }`.

**Locks, in this order**, the same order as deleting a person, so they never deadlock:
1. For each spotter involved, `pg_advisory_xact_lock('badges:' || device)` and the `device_credentials` row `FOR SHARE`.
2. `sighting-answers:{device}`.
3. The sightings, `FOR UPDATE`, in id order. Then re-read `device_id`, `cat_id` and `status`.
4. The cats, `FOR UPDATE`, in id order.
5. The statements carrying those sightings' ids, `FOR UPDATE`.

A merge locks every sighting of the merged-away cat. The answers route re-reads the sighting's `cat_id` under `FOR SHARE` inside its own transaction.

**Move steps:**
1. Resolve cats canonically and check §6. "Nothing left" means no other sighting, vet visit, vet-visit photo, welfare report or statement apart from the name and the coat reading of the main photo. In that case refuse with `MERGE_INSTEAD`, so the screen offers the merge.
2. Make the new cat, if asked:
   - name rules as at resolve, or the SYR number plus `name_pending` (as `vetVisits.ts`);
   - a typed name's `name` statement is the mover's;
   - the discoverer is the sighting's device, or none with the cat stamped redacted;
   - the position is the sighting's;
   - the main photo is the moved one, or `0` if removed.
3. Insert the move rows (one per sighting, one `batch_id`) and set the setting.
4. Change `cat_id`, or split (`nextval`, insert, move the `sighting_photos` row, and a match record `choice = 'unlabelled'`, `chosen_cat_id` = the old cat).
5. Copy and withdraw statements (§9.5). This is for whole spots only, and never for a merge's moves.
6. Old cat: set the main photo to `newMainPhotoId`. With `0`, retract the machine colour reading of the moved photo. If the first sighting moved, set `lat`/`lng` to the earliest remaining resolved sighting.
7. Follow the right cat (skipping a cleared device and the team desk). With `source: "report"`, close the report as done.
8. After commit, best effort: fill the match record's team step.

**Merge steps:**
1. Resolve both canonically. Refuse `SAME_CAT`, `ALREADY_MERGED`, `TWO_OWNERS`, `OWNER_MUST_STAY` (the merged-away cat has an owner) and `NAME_PENDING_MUST_GO` (§4.1). After taking the cat locks, re-read the merged-away cat's resolved sightings and refuse `STALE` if the counts changed.
2. Insert the `cat_identity` row and set the setting.
3. For every resolved sighting filed under the merged-away cat, insert a move row (`reason = 'merged'`, `merge_id`) and change its `cat_id`. No statements are copied.
4. Copy follows: insert `cat_subscriptions (device, survivor)` for each follower of the merged-away cat, `ON CONFLICT DO NOTHING`, skipping devices in `cat_unfollows` for the survivor and `deleted:` devices. Copy unfollows the same way. Record each row actually inserted in `merge_follow_changes (merge_id, device_id, kind: "follow" | "unfollow", row_created_at)`. That table is in the deletion sweep (§9.11).
5. Owners are never copied (§4.1).
6. Write a `duplicate_decisions` row `merged`. Award 10 points to each counting phone with a `same` report from `spotter_question` or `cat_page` on this pair dated before the merge, once per device per pair ever, as `points_ledger` rows with `source = 'duplicate'` (§9.8).
7. Reset both cats' news baselines without sending anything.
8. Write the in-app lines (D4, D10).

**Undo steps:** the reverse.
- Refuse `UNDO_LATER_MERGE_FIRST` (§9.2).
- Insert the undo `cat_identity` row.
- Move back every sighting whose newest move row is this merge's `merged` move (`reason = 'merge_undone'`). Copy late answers (§9.5). Move `alsoMoveSightingIds` (post-merge sightings and ones moved again since) with ordinary move semantics.
- Remove the follow and unfollow rows in `merge_follow_changes` that still exist **with the same `created_at`**. A row someone removed and made again after the merge is theirs, and stays.
- Write a `duplicate_decisions` row `merge_undone`.

### 9.8 Points

`points_ledger.sighting_id` becomes nullable. New columns `duplicate_cat_low` and `duplicate_cat_high` are added, with a CHECK that either `sighting_id` or both of them are set, and a unique index on `(device_id, duplicate_cat_low, duplicate_cat_high)`. So undoing and re-making a merge never pays twice. The once-a-day index stays scoped to sighting rows (`where sighting_id is not null and points > 0`). `profiles.points` goes up in the same transaction, under the badges lock. Undo never removes these rows.

### 9.9 "Has met this cat"

`hasMetCat(exec, catId, deviceId, purpose: "name" | "claim")`:
- **Compares canonical cats on both sides.** A sighting the spotter matched to Mimi still counts for Agatha after the merge, because it was filed by a merge move and Mimi is Agatha.
- **The "no match record" case** leaves out sightings that have a move row other than `merged` or `merge_undone`. Those two only follow a merge, so they count like the sighting's original filing.
- **One exception, for `purpose: "name"`:** while the cat's name is pending, a sighting counts when its newest move row has `made_new_cat`, `let_spotters_name` and `to_cat_id` equal to its current cat.

### 9.10 Reading the past

`loadCatRecords(…, { asOf })`, `withHistory` and `resolveAt`:
- **Each sighting's cat as of a moment** is the `to_cat_id` of its newest move row created by then. Without one, it's the original cat (the first move row's `from_cat_id`, else the current cat). A split-out sighting doesn't exist before its move.
- **Merges as of a moment** come from `canonicalCatOf(…, { asOf })`.

### 9.11 Deleting a person

- **A spotter:** the existing sweep by device id finds copied statements, split-out sightings, `duplicate_reports` and `merge_follow_changes`. The §9.7 locks mean a move or merge can't write a copy after the sweep.
- **A team member:** clears `sighting_moves.moved_by_account_id`, `cat_identity.by_account_id` and `duplicate_decisions.by_account_id`, and stamps `redacted_at`. The same change adds clearing `observations.account_id` for a deleted team member, which isn't written yet for any statement.

### 9.12 News

The nightly check marks a change `silenced` (reason `moved` or `merged`) when the newest evidence behind it is a copied statement, a sighting moved since the cat's last baseline, or a merge since then. Moves and merges also reset the affected cats' baselines.

### 9.13 Upload retries

The repeat-upload check in `POST /sightings` orders by `id` and leaves out split-out sightings.

### 9.14 Tests that must exist

**Moves**
1. The database refuses a sighting's cat changing with no move or merge in this transaction (including when an older row with the same cats exists), any other column changing in a move, and any update to a move or merge row except redaction.
2. After a move, the old cat's answers equal those of a cat that never had the sighting, and the new cat's equal those of a cat it was matched to in the first place.
3. A copied spotter answer keeps the spotter as author, with role `public`. It never gives team authority or "confirmed sterilised".
4. A team "agree with clip" on the moved photo is withdrawn, not copied, and the withdrawal isn't evidence of life.
5. Ear-tip state after a move is right on both cats.
6. A deleted spotter's sighting moves with no name on it. A deletion and a move running at once leave no device id anywhere.
7. Points are unchanged. The collection and stamps show the new cat.
8. The photo keeps its internal id. A photo restored before the move still can't be hidden again by a report.
9. A main photo moving needs `newMainPhotoId`; `0` gives the placeholder and retracts that photo's colour reading.
10. When the first sighting moves, the map spot moves and the name and discoverer stay. "Nothing left" gives `MERGE_INSTEAD`.
11. A split gives a sighting at position 1. It counts for last seen, earns no points, leaves the answers behind and doesn't count as "met". Splitting the cover photo is refused. An upload retry finds the original.
12. Moving several sightings to a new cat starts the cat from the oldest one.
13. Two moves at once give exactly one success. A move and a late answer at once: the answer lands on the cat the sighting is filed under when it commits.

**Merges**

14. After a merge, the survivor's sterilised, life status, last seen and sighting count equal those of one cat holding both records. Mimi is gone from `GET /cats`, the matcher pool and the nearby list. `GET /cats/Mimi` returns Agatha with `mergedFrom`.
15. **Merge then undo, for every reader in §9.3, including `visitsFor`, vet-visit photos, `totalCatCount` and the colony readers:** each one agrees with the state before the merge. This is the SYC-410 test. The two source tests in §9.3 fail on a new reader that bypasses `liveCats` or `catsFeeding`.
16. Chains: Mimi→Agatha→Dora counts for Dora. Undoing Mimi→Agatha first is refused. Undoing Agatha→Dora leaves Mimi in Agatha. A loop is refused.
16a. A resolve racing a merge never leaves a resolved sighting on the merged-away cat. The deferred check refuses the merge, or the resolve files under the survivor.
16b. A late answer added after the merge goes back with its sighting on undo.
17. Followers move without duplicates, unfollows win, and `deleted:` devices are skipped. Undo removes only rows the merge added that are unchanged since.
18. The record with an owner must stay, and two owners are refused. The claim waits are checked across both records. Colour and markings after a merge are the survivor's own.
19. Duplicate-finder points: 10 once per phone per pair, ever, only from counting phones and reports dated before the merge, kept after an undo, and not paid again on a re-merge.
20. A spotter who matched Mimi has "met" Agatha after the merge, for naming and claiming.
21. "Also known as": search and the name-taken prompt find Agatha by "Mimi". A new cat can't be named Mimi.
22. Undo moves back only the merge's own moves. Ticked post-merge sightings move to Mimi.

**Spotting duplicates**

23. "Are these the same cat?" is offered only under §9.6's rule, at most once per sighting, and never for a decided pair.
24. The "This might be the same cat as…" limit and the nearby rule. Reports are never in a public payload.
25. The ladder: one "Are these the same cat?" answer stays *Possible*. New phones never make *Likely*. A "different" decision is reopened only by the rule in §9.6.
26. The sweep does nothing while its switch is off, writes at most 10 pairs, skips decided pairs and cats with no fingerprint, and never writes about a merged-away cat. The calibration acceptance test runs before it is switched on.
27. "As of" a date before a move or merge shows the record as it stood then.
28. A deleted team member's moves, merges and decisions are kept, with who made them cleared.
