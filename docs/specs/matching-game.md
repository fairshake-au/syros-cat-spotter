# Tell the cats apart: a game that makes matching better

**Status:** Draft 2 for Samuel's approval, 15 October 2026. **All eight brainstorm decisions answered by Samuel on 15 October 2026** (§13): 1, 3, 4, 5, 6 and 7 as recommended; **2 changed** to two formats from the start (pairs and line-up); **8 changed** to full offline play, narrowed in §9 for a reason given there and put back to him in §15. An independent adversarial review (Sonnet) of draft 1 found 4 blockers, 9 majors, 8 minors and 2 nits; the review is in [`reviews/matching-game-review.md`](./reviews/matching-game-review.md) and how each finding was handled is in §16. The four blockers changed the design: the photo source rule, the reveal, how a line-up is stored, and the trust rule. **Design only.** Nothing here is built, and the implementation plan comes only after approval.
**Owner:** Samuel
**Covers:** SYC-402 (design a game in the app that helps improve cat matching).
**Related:** SYC-56 (measure matching accuracy) · SYC-57 (visual memory: embeddings, then on-device matching) · SYC-151 (the team-only match record, Done) · SYC-161 (coat colour read from the photo) · SYC-303 and SYC-246 (hidden photos, privacy removal) · SYC-36 and SYC-48 (the match-wait screen, PR #195) · SYC-2 (coat and markings, PR #191) · SYC-53 (roles and invites) · SYC-43 (team dashboard) · SYC-59 (duplicate cats and human-confirmed merge) · SYC-150 (team moves a sighting to another cat) · SYC-44 (report an issue) · SYC-195 (new-device limit) · SYC-63 (deletion) · [`choose-a-different-cat.md`](./choose-a-different-cat.md) §4.6 · [`cat-record-data-spine.md`](./cat-record-data-spine.md) §6.2, §6.3, §6.5, §10.3, §10.9 · [`coat-markings-and-health.md`](./coat-markings-and-health.md) §3, §4.2, §8 · [`roles-and-invites.md`](./roles-and-invites.md) §2.2, §6.1, §6.2 · [`report-an-issue.md`](./report-an-issue.md) · [`offline-queue-on-web.md`](./offline-queue-on-web.md) · `docs/superpowers/specs/2026-07-28-engagement-and-donations-design.md` §4.3, §6.7.
**Timing:** **after the MVP.** The launch plan (PR #172) freezes MVP scope for 31 October, and nothing in this spec is on it. The earliest sensible home is the "Phase 4 · Intelligence and income" milestone, next to SYC-57 and SYC-59, because the game's first job is to feed SYC-56's baseline. §12 says what has to exist first.

**What this document owns:** what the game looks like and feels like; which photos it may show and which pairs it builds; when an answer counts; what the answers are used for and who may act on them; what is shown and what is never shown; the rewards; what works without signal.

**What it borrows, and does not own:** the roles and the capability names (`roles-and-invites.md` §6.2 is the single list; the two rows this spec needs are written in §10.3 as additions to that list, to be approved with this spec); the observation model, `cat_identity` and the resolver (data spine); the hide/restore log and `hiddenPhotoIds` / `catDisplayPhotos` (`photoVisibility.ts`, the only place a public photo address is built); the match record (`sighting_matches`, SYC-151; §10.2 asks for two fields to be added to it); the queue store (`queueStore.ts`); the badge list (`badges.ts`, computed on read, never stored); the in-app inbox (`notifications.ts`).

**Decision numbering.** This spec's decisions are SYC402-D1 to SYC402-D8, so they can't be confused with `DECISIONS.md`.

**Words used in this document.** A **pair** is two photos. A **judgement** is one player's answer about one pair: Same, Different or Can't tell. A pair is **decided** when enough people agree (§6), **contested** when they don't, and **retired** when it leaves the game for good. The **deck** is the small set of pairs a phone holds. A **close call** is a pair the photo-matching tool was unsure about. The **test set** is the list of decided pairs SYC-56 uses to measure the tool. A device's **counted** or **not counted** state is whether its answers are allowed to decide pairs (§6.2).

---

## 1. The short version

A spotter opens Cat Spotters on a day with no cat in sight, on the ferry, in a café. On Home there's a small card: **Help tell cats apart.** They tap it and see two photos of cats, and three buttons: **Same cat**, **Different cats**, **Can't tell**. They answer. The screen turns over: the cats' names, and sometimes one line: *"Our photo-matching tool found these two hard."* Next pair. Five of these make a round. Two minutes.

Every fifth round is a **line-up** instead: one photo at the top, three cats below, "Which of these is this cat?", with a **None of them** button. That's the harder one, and it's what the matching tool does for every spot.

Nobody is timed. Nobody is ranked. What a player sees grow is one number: **cats you've helped tell apart**, which goes up when a pair they answered is *decided* (three people agreeing), not when they tap. Two badges mark the way. The spotting leaderboard is untouched.

Underneath, every decided pair is a human-checked label the matching tool can be tested against (SYC-56), and the ones that disagree with the records go to the Syros Cats team on the dashboard, who alone can say two cats are one, or one is two. Nothing a player does changes a cat.

The deck is built so that most of what players see is the tool's **close calls**, not obvious pairs. Only photos the public can already see, from sightings the public can already see, never a hidden one, never a place, and never a pair that would tell a player two cats are closer together than the public map already shows.

Without signal: the phone plays the deck it already holds and shows the reveal; answers wait in the queue and are sent when signal returns. A new deck, the decided count and the badges need signal.

---

## 2. Why a game, and why now

### 2.1 How matching works today

A spot is a photo and a position. The server takes the **ten nearest** cats whose first-spotted position is within 500 m (`candidateSelection.ts`, `MAX_CANDIDATES`), sends their main photos together with the new photo to a vision model in one request, and asks for a likelihood (0–1) that each is the same cat (`lib/matching.ts`). Those likelihoods are relative to the other photos in the same request, not a probability about one pair on its own. Candidates below 0.1 are dropped; of the rest, the **top three** are remembered; those at or above **0.4** are suggested to the spotter (`routes/sightings.ts`, `CONFIDENCE_THRESHOLD`); one between 0.1 and 0.4 is remembered in the top three but never named to the spotter. The spotter confirms a suggestion, hand-picks a different cat, or names a new one. Since SYC-151 the server keeps a team-only record per sighting (`sighting_matches`): the cats compared, the top three with their scores, the choice and how it was made, and for a hand pick whether it was a *matcher miss* (compared, scored low or outside the top three) or a *distance miss* (never compared).

### 2.2 What's missing

Nobody knows how good the matching tool is. SYC-56 says, correctly, that nothing about recognition changes until a baseline exists, and a baseline needs **human-checked same-cat labels**. Today those come only from confirmed sightings, which are labels the tool itself proposed and a spotter accepted in three seconds, so they overstate its accuracy. The hard cases, where it was unsure, or a spotter overrode it, are exactly the ones nobody has checked twice.

The 0.4 threshold "isn't named by the spec" (the code says so) and was kept on 3 October because there was nothing to tune it against. The embeddings plan (SYC-57) needs the same labels. And the same mistakes are on the map now: two records that are one cat (SYC-59), a sighting filed under the wrong cat.

### 2.3 Why a game, specifically

The app has an audience with time and attention and no cat in front of them: tourists on a slow afternoon, locals who know the cats and enjoy being right about them. Asking them to "review matches" is work. Asking "same cat?" with a reveal is a game people already play on their own phones. The two audiences bring complementary things: a tourist brings fresh eyes and volume; a cat guardian brings certainty about her own cats, and the design gives her a place where that certainty is used as a decision, not a vote (§5, §7.2).

### 2.4 What the game is not

- Not a way to change a cat. Only the team merges, splits or re-files, and only on the dashboard (§7.2); the merge itself is SYC-59's.
- Not a points source. Nothing in it moves the leaderboard (§8).
- Not a matching service. The game never runs the vision model; it only knows what the model already thought.
- Not proof against a determined person with several phones (§6.4 says plainly what it resists and what it doesn't).
- Not an MVP feature (§ Timing above).

---

## 3. What a spotter experiences

### 3.1 Finding it

**The Home card** (`app/(tabs)/index.tsx`), below "cats near you": a small card, **Help tell cats apart**, with the player's count under it once they have one ("You've helped tell 12 cats apart"). It's a card, not a banner; it never pushes nearby cats down more than one row.

**After a spot**: on the **reward screen** (`review.tsx`, the screen after a sighting is resolved, which carries the ear-tip and details questions and the badge banner), one line at the bottom: *"Two minutes to spare? Help us tell cats apart."* The feeding nudge is **not** on this screen: it sits on the first result screen, the candidate list (`feeding-nudge.md` §1), so the two never compete. The line doesn't show on a queued sighting reviewed later.

**Not on the match-wait screen.** The wait is a few seconds, it was given to the feeding nudge and the facts on 15 October (PR #195), and a round interrupted by the result arriving is worse than no round. (SYC402-D6.)

### 3.2 A pairs round

Five pairs. For each: two photos side by side (stacked on a narrow phone), the same size, no name, no date, no map, no words about where. Three buttons, equal weight: **Same cat** · **Different cats** · **Can't tell**. Under the photos, small: **Something wrong with this photo?** (§3.7). Tapping an answer turns the card over:

- the public name of each cat (or "the same cat: Mikis" when the records say they're one);
- for a close call (§4.1 pool 1), one line: *"Our photo-matching tool found these two hard."* No percentage, ever: the tool's number isn't a probability about this pair (§2.1), and a number shown in round one would steer every answer after it;
- for a line-up, what the spotter did (§3.3);
- and, if this answer settled the pair, *"That settles it. Three of you agree."*

No "correct" or "wrong". On most pairs nobody knows yet; that's why we're asking. On a check pair (§4.1 pool 3) the reveal shows the names and nothing more: the team's answer is never shown, so it can't be copied.

**Can't tell** is a real answer, not a skip. Three people who can't tell two photos apart tell the team that at least one of the cats needs a clearer main photo (§7.2). It never counts toward a decision (§6.1) and it never counts against the player (§6.2).

A round ends with the player's count and, if it moved, by how much. Then **Another round** or **Done**.

### 3.3 A line-up round

Every fifth round is a line-up round: three line-ups. Each: one photo at the top ("Which of these is this cat?"), three cats below in a **random order**, each as one photo, and a fourth button, **None of them**. One tap. The reveal names all four cats and says what the spotter who took the photo did: *"The spotter chose Mikis."* / *"The spotter said it was a new cat."* It does not say whether the spotter was right; that's what we're asking.

A line-up is a real match the app once made, replayed: the target is a sighting's photo; the three cats are the three the tool scored highest (§4.4).

**How a line-up is stored (changed after review).** One record: *from these three, this player chose X* (or *none*). From it the game derives **one** pair judgement, target-vs-X = Same. It derives **no** "Different" for the two cats the player didn't pick: picking the best of three isn't ruling the others out, and if two of the three are secretly one cat (the duplicates this game exists to find), a derived "Different" would be a confident wrong label. **None of them** is the one case where the player has ruled all three out, and it derives Different against each. So both formats fill the same judgement table, and nothing a player didn't actually say gets into it.

### 3.4 The count and the badges

Under the Home card and on the profile: **Cats you've helped tell apart: 12.** It counts **decided** pairs the player answered on the deciding side, from pools 1 and 2 only (check pairs and easy pairs never count, §4.1). It goes up when the third agreeing answer arrives, which may be days after the player's own. It **never goes down**: if the team later decides a pair the other way, the label changes and the count doesn't (§8). The profile line says: *"Counted when three people agree."*

Two badges, in the existing list (`badges.ts`, computed on read): **Sharp eyes** at 10 and **Cat detective** at 50. The numbers are set against the deck's size (a few hundred live pairs, three players each): 25 and 100 would have been most of the supply for one player. A badge earned here can't use the "New badge unlocked!" banner, which is computed only around a sighting being resolved (`sightings.ts`, `badgesBefore` / `newBadges`); instead the server writes an **in-app inbox** item (`notifications.ts`): *"New badge: Sharp eyes."*

### 3.5 When the deck runs out

The deck is finite and at launch volumes it will be thin. When there's nothing left that this phone hasn't seen, the card says *"You've seen every pair we have. New ones appear as cats are spotted."* and doesn't offer a round. It never repeats a pair to the same device (§4.5). This is better than padding with obvious pairs, which teach the tool nothing and teach the player the game is pointless.

### 3.6 Three languages

Every string here ships in English, Greek and French through the normal route (SYC-4 native review for Greek and French). The buttons are the only text a player must read to play; the reveal is one or two lines.

### 3.7 Something wrong with this photo?

Each card carries a small link to the existing **report an issue** flow (SYC-44, "something wrong with this photo"): a person, a house number, a feeding site, not a cat. The report is about the photo, not the pair. While a report on a photo is open, every pair and line-up using it is **paused** (taken out of decks, answers still accepted on sync); if the team hides the photo, those pairs retire (§4.2).

---

## 4. The deck: which pairs we show

**SYC402-D3: a mixed deck, weighted to close calls.** The whole value of the game is in this section. A pair of a black cat and a ginger cat is a wasted tap.

### 4.1 Four pools, and what a round is made of

A pairs round is five pairs: **three close calls, one neighbour pair, and one check-or-easy pair** (check and easy alternate). A line-up round is three line-ups. A deck is four pairs rounds and one line-up round: 20 pairs and 3 line-ups. These numbers are settings (§10.4), and the mix is a starting point to be tuned once there is data.

| Pool | What it is | Where it comes from | Why it's in | Counts toward a player's number? |
|---|---|---|---|---|
| **1. Close calls** (three per round) | A sighting's photo against **the cat photo the tool actually compared it with**, where the tool scored that cat between **0.25 and 0.6**, or where the spotter hand-picked a cat after a *matcher miss* (scored under 0.25, or outside the top three, so no score is stored) | `sighting_matches`: `suggested[].score`, `choice = 'hand_pick'`, `miss_kind = 'matcher_miss'`, and the compared-photo ids §10.2 adds | These are the tool's errors and near-errors. A label here changes what we know. | Yes |
| **2. Neighbours** (one per round) | Two cats' display photos, where the **published** positions of the two cats are within 1 km of each other and both have the same **confirmed or likely** coat colour (`resolveCoat`, `coat-markings-and-health.md` §4.2) | `cats` published positions (the 250 m grid, data spine §6.2); the `coat` observation | The lookalikes the tool is most likely to confuse, and the pairs most likely to be one cat with two records. | Yes |
| **3. Check pairs** (one every other round) | A pair the team has decided **and marked "use as a check"** on the dashboard: a clear-cut pair, not one of the game's own hard contested ones | Seeded by the team deciding 20–30 pairs by hand before the game opens; grows only when the team ticks the box on a decision | A quiet check that the player is looking (§6.2), and a pair per round that can be got right, so a round feels winnable. Check pairs **stay in rotation**: they are the one exception to "a decided pair leaves the deck". | No |
| **4. Easy pairs** (one every other round) | Two cats' display photos with different confirmed colours, published positions more than 2 km apart | `cats`, `coat` | A quick win. Its answer is stored, weighted zero in the test set. | No |

Pools 1 and 2 are the data. Pools 3 and 4 are the game.

### 4.2 Photos and pairs the deck never contains

The rule is applied **twice**: when the deck is built, and again when a phone asks for its deck, against `hiddenPhotoIds` at that moment.

- **Any photo that is hidden** (`photo_visibility_events`, latest action `hide`), for any reason; **deleted** under SYC-246 (`remove_photo`); or sent privately with a welfare report or by a guardian (`roles-and-invites.md` §2.2). A cat's photo in the deck is its **display photo** (`catDisplayPhotos`, what the public cat page shows). A sighting's photo is in the deck **only if the sighting is resolved** with a choice of `suggested`, `hand_pick` or `new_cat`, is visible on the public cat page, and its photo isn't hidden. Rows with `matcherFailed`, `unlabelled`, or a sighting sent to the team for matching, never qualify.
- **A close-call pair whose compared photo has changed.** The tool's score belongs to the exact cat photo it was sent, which today is the cat's main photo read raw (`sightings.ts`, the `candidateInputs` loop; SYC-303 is about this). If that photo is now hidden or is no longer the cat's display photo, the pair is dropped, not swapped: a label on a photo the tool never scored is worthless to SYC-56. §10.2 asks the match record to store the compared photo ids so this check is exact; until it does, the deck job compares against the cat's current main photo and drops any pair older than the last main-photo change.
- **A pair involving a cat the public can't see.**
- **A pair that would reveal closeness the public map doesn't show.** A pair or line-up is built only where the **published** (grid-snapped) positions of everything in it are already within 1 km of each other, or, for easy pairs, obviously far apart. A close-call pair always passes this (the tool compares only within 500 m, and the public sighting and cat positions sit on the same 250 m grid); the rule exists so that it stays true if the matcher's radius or the grid ever changes, and so that nobody has to reason about it again. §7.5 says what the game does reveal.
- **A pair the team has retired** (§7.2: decided, merged, marked "don't ask"), unless it's a check pair.
- **A pair whose two cats resolve to one cat** through `cat_identity` (data spine §10.3): retired by the deck job after a merge.
- **A pair this device has already answered** (§4.5).
- Two photos of the same sighting; a photo with an open report (§3.7).

### 4.3 How the deck is built and fetched

A server job (nightly, and after each team decision, hide, restore or removal) refreshes a `game_pairs` table (§10.1) from the four pools, scoring each live pair by how useful an answer would be: unanswered close calls first, then pairs with one or two counted judgements that need a third, then neighbours. It caps the deck at a few hundred live pairs so the job is cheap.

A phone asks for **the next 20 pairs and 3 line-ups it hasn't seen**, with the device secret (`deviceAuth.ts`) and under a per-device rate limit (`rateLimit.ts`, one deck an hour, SYC-195's new-device limit applies as it does elsewhere). The response carries, per photo, a **public photo address built by `photoVisibility.ts`** with a size parameter (`GET /photos/:id?w=720`, a new option on the existing route, not a new route), the cats' public names, and the reveal lines. The phone downloads the photos while it has signal into the deck store (§9). At 720 px and about 60 photos a deck is **2–4 MB**; on the web that lives in the Cache API, not `localStorage` (`offline-queue-on-web.md` sets the pattern).

### 4.4 Line-ups

A line-up is built from one qualifying `sighting_matches` row (§4.2) with **three stored suggestions**: the target is the sighting's photo; the three candidates are those three cats, with the photo the tool compared (§10.2), shown in a **random order** that never follows score or distance. The spotter's choice is carried for the reveal: a suggested cat, a hand pick (then the hand-picked cat replaces the lowest-scoring candidate so the chosen cat is in the line-up), or `new_cat`. A row with `new_cat` makes a line-up whose spotter answer is "None of them", carried as **weak**, since naming a new cat is "weak but useful evidence" (`choose-a-different-cat.md` §4.6) and the new cat may itself be a duplicate; the game's label from it is the player's, not the spotter's, so it's no weaker than any other. The deck aims for about one line-up in four with "None" as the spotter's answer; if the pool can't supply that, fewer line-ups, never padded. If any of the four photos fails §4.2 the whole line-up is dropped.

### 4.5 One answer per device per pair

A device answers a pair once. The server **accepts and ignores** a second answer from the same device for the same pair (first wins) and any answer for a retired or paused pair, answering `200 { accepted: false, reason }` so the phone's queue treats it as done rather than failed (§9). The same device can't be two of the three agreeing voices. A person with two phones can; §6.4 says so.

---

## 5. Both audiences

Tourists and cat guardians need complementary things from this, and the design gives each what they bring:

| | A tourist with a few minutes | A cat guardian who knows the cats |
|---|---|---|
| **What they bring** | Fresh eyes, volume, no stake in the answer | Certainty about her own cats; she knows Mikis has one torn ear |
| **What the game gives them** | Five quick pairs, a reveal that names the cats and sometimes says the tool found them hard, a count that grows while they're on the island | The same game in the app, as anyone (the app has no sign-in and never will, data spine §6.5), **and** on her own dashboard page a short list of the game's questions about her colony's cats, which she **decides** rather than votes on (§7.2). Her word there is recorded with who said it, like her other statements |
| **What the game must not do** | Make them feel tested, or wrong | Waste her time on a ginger-vs-black pair, or let her certainty be averaged away: her decision on the dashboard settles the pair, and three tourists' votes don't reopen it |

Neither audience is asked to type anything, and neither is told where a cat lives. There is no "guardian weight" inside the app's game, because the app can't know who she is (review finding 4); her weight is that she decides, in the one place that knows her.

---

## 6. When an answer counts

**SYC402-D4: agreement of three, with a track-record check.** The rule is written once, in heads, with every state.

### 6.1 The decision rule, as a table

A judgement is **counted** if its device was in the counted state when it was made (§6.2). *Can't tell* judgements are stored but never counted. Let S be counted Same, D counted Different, C Can't tell, each from distinct devices.

| State of a live pair | What happens |
|---|---|
| S ≥ 3 and D = 0 | **Decided Same.** Leaves the deck. Players on the Same side get credit (§8). |
| D ≥ 3 and S = 0 | **Decided Different.** Same as above. |
| S ≥ 1 and D ≥ 1 | **Contested.** Stays in the deck until S + D = 5. Then: 4–1 or 5–0 decides; 3–2 goes to the team's queue (§7.2) as *"Players disagree"*. At most **ten** contested pairs reach the queue per day; the rest wait, newest last. |
| C ≥ 3 and S + D ≤ 1 | **Nobody can tell.** Leaves the deck; a queue row *"Nobody can tell these apart from these photos"*. Not a label. |
| S + D = 2, same side, plus any C | Still live: needs a third counted voice. Nothing else happens. |
| Any pair live for **90 days** without a decision | **Retired as undecided.** Not a label, not in the queue, not counted for anyone. |
| A team or guardian decision on the dashboard, at any point | **Decided by the team / guardian.** Overrides any player decision for the label; credit already given stays (§8). Leaves the deck unless marked "use as a check". |
| An uncounted judgement, any kind | Stored with the device's state at the time; never moves the pair. |

### 6.2 The track-record check (counted or not counted)

Each device carries a hidden **care score**: on the check pairs it has answered (§4.1 pool 3), what share matched the team's answer. *Can't tell* on a check pair doesn't count either way. Until a device has answered **five** check pairs its judgements are counted. From then on, below **60 %** its judgements are stored but **not counted**, until the score climbs back above 60 %. The score is never shown and never named; a player sees nothing different. When a device drops below the line, its earlier counted judgements on **still-live** pairs are re-marked uncounted (decided pairs are left alone, with the drop recorded on the label, §7.1).

Check pairs are clear-cut pairs the team chose for this (§4.1), not the game's own hard cases, so an honest player who finds hard pairs hard isn't punished for it. The team's answer is never shown in the reveal, so the check can't be copied by playing once and remembering.

### 6.3 Who decides, rather than votes

- **The Syros Cats team**, on the dashboard: decides any pair at once, island-wide (`review_photo_pairs`, §10.3).
- **A cat guardian**, on her own dashboard page: decides a pair when **both cats are in her colonies** (`decide_photo_pair`, placed, §10.3). A pair with one cat in her colony and one outside is shown to her for information and decided by the team. A pair with a cat in no colony is the team's.
- **Nobody else** carries extra weight. Points, streaks, badges and claimed cats change nothing here; a claimer isn't a guardian (`roles-and-invites.md` §2.2).

### 6.4 What this resists, and what it doesn't

It resists **one careless or joking person**: one device is one voice, a wrong-headed device is caught by the check pairs, and a single dissenter can only delay a pair, not decide it. It does **not** resist a person with three phones, or three friends who agree to answer the same way: they can decide pairs. What that buys them is a wrong label in a test set the team can audit (§7.1 records the distinct devices, their ages and their care scores on every label; a decision where every device is **under seven days old** is marked *fresh devices* and kept out of the test set until the team looks), a drained deck for honest players, and nothing else: no cat changes, no points, no rank. The device secret and the per-device rate limit (§4.3) make a phone farm cost effort; `newDeviceLimit.ts` caps new devices per address and says itself it is not a defence against many addresses. "Delete my data" gives a fresh identity; the old judgements stay, unlinked (§9), so a person who deletes and replays can be two voices on a pair. Accepted, and written down.

---

## 7. What the answers are used for

**SYC402-D1: staged.** Each stage is useful on its own and none changes a cat without the team.

### 7.1 Stage 1: the test set (SYC-56)

Every **decided** pair from pools 1 and 2 is a label: two photo ids, Same or Different, who decided it (players, team or guardian), the number of distinct devices, their ages and care scores at the time, and, for a close call, the model version and score band from the match record (§10.2 adds the model version; until then, the date). Labels are **per photo pair**, never per cat.

What the labels can and can't measure, stated plainly:
- Close calls are chosen **by the tool's own score band**, so they measure the tool **in that band**: that is what tuning the 0.4 threshold needs, and it is not an overall accuracy figure. Confirmed sightings give the other half of the picture; SYC-56 keeps the two sources apart (`source = 'game'` / `'sighting'`).
- The hardest pairs never become labels (contested, or nobody can tell), which makes the tool look **better** than it is; the concentration on close calls makes it look **worse**. Neither effect is quantified here; SYC-56's report says which pairs it counted.
- A label is a **human judgement from two photos**, not the charity's knowledge of the cat. A guardian's dashboard decision is the nearest the game gets to the truth.
- Neighbour pairs (pool 2) have no tool score; they are labels for SYC-57 and the duplicate hunt, not for the threshold.

**The target.** SYC-56 can say something about the 0.4 threshold once there are **200 decided close-call pairs** with a stored score, roughly 100 either side of 0.4. Its first report is one table: for pairs the tool scored in each band (0.25–0.4, 0.4–0.6), how often people said Same. At about 100 resolved sightings today the pool is a few dozen pairs; the target is weeks of spotting after launch, which is why §12 says December at the earliest.

### 7.2 Stage 2: "Matching to check" on the dashboard

A new team page, **Matching to check**, in the style of the existing "Matched by hand" list (`DECISIONS.md` Part 2i: a list, not the SYC-53 confirmation queue), read under `review_photo_pairs` (§10.3). Each row is a decided or stuck pair with its two photos, its public cat names, what the players said and how many, and three buttons.

| The players say | The records say | The row | Only the team (or the guardian, §6.3) can… |
|---|---|---|---|
| Same, on **two or more photo pairs** of the same two cats, or one pair plus the team's own look | Two different cats | *"Players think Mikis and Ermis are one cat."* | Mark **same cat** (a note for SYC-59 until the merge exists; the pair retires), **keep separate** (the pair becomes a check pair if ticked), or **ask for a better photo** |
| Different, on a sighting photo vs. the cat it's filed under, on **two or more** photo pairs | One cat | *"Players think this sighting isn't Mikis."* | **Re-file** the sighting to another cat or to a new one (**SYC-150**, a team action that does not exist today; §12 lists it), **keep**, or **ask for a better photo** |
| 3–2 contested | Anything | *"Players disagree about Mikis and Ermis."* | Decide it; tick "use as a check" if it's clear-cut |
| Can't tell × 3 | Anything | *"Nobody can tell these apart from these photos."* | Note that a cat needs a clearer main photo (the colony view, SYC-54, is where the team asks a guardian for one) |

One photo pair saying Different does **not** say the sighting isn't Mikis (angle, light, kitten against adult), which is why a cat-level row needs two pairs or the team's look. A guardian's page shows only rows where both cats are in her colonies; for a row with a cat outside her colony she sees exactly what the public sees of that cat. **Merging and splitting stays with SYC-59**, which owns the merge, its reversibility and the aliasing of names; this spec owns the row that tells the team a merge may be needed and nothing after that.

### 7.3 Stage 3: training input (SYC-57)

When SYC-57 starts, the same labelled pairs are its training and validation material, with the source and the decision trail intact so that a bad label can be traced and withdrawn. Nothing extra is collected for this; the stage is just a reader.

### 7.4 What's never done with an answer

- Changing a cat, a sighting, a photo or a colour from a game answer alone.
- Showing a player's answers to anyone but the team.
- Using the care score anywhere outside §6.

### 7.5 What the game does reveal, honestly

- The public names and public photos of cats, after an answer.
- That two named cats were **compared by the tool** or are **near each other**, at no finer a grain than the public map already shows (§4.2's closeness rule). The data spine's rule that "a candidate set never reveals its own geography" (§6.3) protects the spotter standing at an exact position from learning which cats are near *that point*; a player of the game never has a position, exact or published, for anything on the card.
- That the spotter of a sighting chose a particular cat, or named a new one: already visible on the public cat page where the sighting is filed.
- Never: a score, a position, an area word, a date, a hidden photo, a private photo, or anything about a colony or a feeding site.

---

## 8. Rewards

**SYC402-D5: care over speed.** Pulled from the engagement design's "standing, separate from points" (§4.3) and "money must never buy points" (§6.7): here, **taps must never buy standing**.

- **One number**: cats you've helped tell apart, from pools 1 and 2 only, counted on the deciding side, from counted judgements only (an uncounted device earns nothing while uncounted). It never goes down: a later team decision the other way changes the label, not the number.
- **Two badges**: Sharp eyes (10) and Cat detective (50), as derived badges in `badges.ts`; announced through the in-app inbox (§3.4).
- **No points.** No leaderboard movement. No timer. No streak. No daily puzzle at launch.
- **A soft cap**: **5 rounds a day** per device (25 pairs, or 20 pairs and 3 line-ups). The card says *"That's plenty for today. Thank you."* Reason: the deck is a few hundred pairs and each needs three different people; one device doing a hundred pairs a day would see the whole supply in days and leave nothing for the third voices. Three devices colluding can still drain it; §6.4.
- **Nothing for being fast, nothing for being first.**

---

## 9. Offline

**SYC402-D8: full offline, narrowed, and put back to Samuel (§15).** Samuel chose "deck plus local scoring". Play and the reveal are fully offline. "Local scoring" is narrowed to what a phone can know: the count is defined as *decided* pairs (§3.4) and a phone can't know other players' answers; and badges are computed on the server from live stats and never stored (`SPEC.md` §5.6), so a badge awarded by the phone would be the first stored one.

**What works without signal, precisely:**

| Works offline | Needs signal |
|---|---|
| Playing every pair and line-up in the **deck the phone already holds** (20 pairs, 3 line-ups, fetched whenever the app opens with signal and the deck is under half full) | Fetching a new deck |
| The **reveal**, in full: names and the one line are carried in the deck | — |
| A **provisional tally** for the round and the day: "5 answered · 5 waiting to send" | The **decided count** and the **badges** (they catch up on sync; the badge arrives in the inbox) |
| Answers **queued** in a new queue item type, `game_answer`, in the existing store (`queueStore.ts`), with its own storage key and its own small sync driver: send in order when signal returns; a server reply of `accepted: false` counts as done; a network failure retries; a queued answer older than 30 days is dropped | — |

**Honest edges, stated:**
- **A photo hidden or removed after the deck was fetched** can be shown offline **for as long as the phone is without signal**, and no longer: on every launch with signal the app asks the server which of its deck's photos are now hidden or removed (`GET /game/deck/check`) and deletes them before showing a card; a deck older than 24 hours is replaced. Deck photos are copies on the phone, so a SYC-246 `remove_photo` reaches the server at once and the phone at its next launch with signal; the server answers `410` for a removed photo's address and the app deletes the copy. The data spine already accepts a stale cat-alogue outliving a deploy by weeks (§6.5); this is tighter.
- The deck holds thumbnails and public names of public cats, nothing about positions. It is **not** in the cat-alogue cache and doesn't touch its key (`coat-markings-and-health.md` §8: a retired key empties offline catalogues).
- **"Delete my data"** (SYC-63): the deck, the queue (`queueStore.wipe()`), and the daily tally are wiped on the phone. On the server the device's judgements are **unlinked** (device id cleared), not deleted, exactly as sightings survive unlinked: decided pairs, labels and other players' counts don't change. The person's own count and badges go with their profile.

---

## 10. Tables, fields and capability rows

### 10.1 Tables (team-only; none in any public payload)

| Table | Holds | Notes |
|---|---|---|
| `game_pairs` | pair id, photo A, photo B, cat A, cat B, pool (1–4), source sighting (pool 1), score band and model version (pool 1), status (`live` / `paused` / `decided` / `contested` / `undecided` / `retired`), use-as-check flag, decided answer, decided by (`players` / `team` / `guardian` with person), decided at, counted-device summary (count, youngest age, lowest care score, fresh-devices flag) | Built by the deck job (§4.3). |
| `game_lineups` | line-up id, source sighting, target photo, three candidate cats with the compared photo ids, spotter's answer (cat id or `none`) and whether weak, status | §4.4 |
| `game_judgements` | judgement id, device id (nullable: unlinked on deletion), pair id, answer, counted (yes/no, and re-marked on drop), from line-up (nullable), created at | One per device per pair (unique index). |
| `game_lineup_answers` | id, device id (nullable), line-up id, chosen cat or `none`, created at | The one record a line-up tap makes (§3.3). |
| `game_devices` | device id, check pairs seen, check pairs right, rounds today, last deck fetched at | The care score is derived, never stored as a number shown anywhere. |

Profile payload gains one integer, `pairsDecided`, which means one more query in `getProfileStats` (`catHelpers.ts`), run on every resolve and profile read; it must be a single indexed count. The two badges are two lines in `badges.ts`.

### 10.2 Two fields asked of the match record (SYC-151 amendment, for approval with this spec)

| Field on `sighting_matches` | Why |
|---|---|
| `compared_photo_ids` (jsonb: cat id → photo id) | The tool's score belongs to the exact photo it was sent. Without this the deck can only guess (§4.2), and a main-photo change silently breaks the pair. |
| `model_version` (text, from `visionModel.ts`) | A label scored by one model isn't comparable with the next. SYC-56 needs this regardless of the game. |

Both are additive and team-only, in the same table, filtered in the same query.

### 10.3 Two capability rows asked of the roles catalogue (`roles-and-invites.md` §6.2, for approval with this spec)

| Capability | What it allows | Kind | Team | Management | Guardian |
|---|---|---|---|---|---|
| `review_photo_pairs` | Read "Matching to check" and decide any pair; mark a pair "use as a check"; retire a pair | Island-only | ✓ | ✓ | — |
| `decide_photo_pair` | Decide a pair where **both** cats are in her colonies, from her own page; recorded with who said it | Placed | All | All | Own |

The spec adds nothing else to that list. The team's "same cat" mark produces a note for SYC-59, never a merge.

### 10.4 Settings (in `app_settings`, the table the match-wait plan adds in PR 1)

Round mix, deck size, daily cap, line-up frequency, the 0.25–0.6 band, the 90-day retirement, the ten-a-day queue cap, the "fresh device" age. All change without a release.

---

## 11. Costs

- **Model calls: none.** The game never calls the vision model.
- **Storage:** a few hundred `game_pairs` rows; thumbnails are produced by the photo route on request with a size parameter and cached like any photo.
- **Team time:** seeding 20–30 check pairs (an hour), then "Matching to check", capped at ten contested rows a day plus whatever players surface. The daily cap and the deck cap bound it.

---

## 12. What has to exist first, and when this could ship

1. **SYC-151's match record** with the two fields in §10.2. Pool 1 also needs weeks of real spotting after launch to be more than a handful of pairs.
2. **Coat colour** on cats (SYC-161, SYC-2) for pools 2 and 4: landing before launch.
3. **A size parameter on `GET /photos/:id`** built through `photoVisibility.ts`: new, small.
4. **`app_settings`** (match-wait plan, PR 1, 23 October) for §10.4.
5. **A team action that re-files a sighting under another cat** (§7.2 row 2): **SYC-150** (filed, Backlog); data spine §10.9 describes it; no route in `routes/team*.ts` today. The queue ships with that button greyed and a note until it does.
6. **The two capability rows** (§10.3) in the roles catalogue, and the guardian page from SYC-53 / SYC-54 for `decide_photo_pair` to live on. Not needed to ship the app side; without it the team decides everything.
7. **SYC-59's merge** for the "same cat" row to become an action. Out of scope here.

Realistic earliest: **four to six weeks after launch** (early December 2026). Suggested milestone: Phase 4.

---

## 13. Decisions

All eight answered by Samuel on 15 October 2026 through question prompts in this session. His answer is at the top of each; the options stay as the record of what he chose between. Where the review changed how an answer is carried out, the change is noted under the answer.

### SYC402-D1: What the answers are for

> **Decided: staged — test set first, then review queue, then training (recommended).**

| Option | Good | Bad |
|---|---|---|
| **A. Staged** *(recommended)* | Useful from day one with zero risk to cat records; trust can start loose and tighten; each later stage reads the same labels | Players don't see answers "do" anything until stage 2 |
| B. Test set only | Simplest; no merge or privacy risk | Wrong matches on the map stay wrong when ten players flagged them |
| C. Review queue first | Fixes real data soonest | Two staff can't keep up with a popular game; needs the dashboard plumbing first |
| D. Direct training input | ML gets data fastest | SYC-57 doesn't exist; SYC-56 forbids recognition work before a baseline |

### SYC402-D2: Game format

> **Decided: both formats from the start — pairs as the quick round, line-up as the challenge round.** The recommendation was pairs only. The cost accepted: two screens and two sets of copy in three languages. **After review:** a line-up tap is stored as one choice and yields one Same label, never a "Different" the player didn't say (§3.3).

| Option | Good | Bad |
|---|---|---|
| A. Same cat or not? pairs with Can't tell *(recommended)* | Maps exactly to the label SYC-56 needs; Can't tell is itself data; fastest to learn in three languages | Least "gamey" on its own |
| B. Line-up | Mirrors what the tool and the spotter do | Needs a plausible lookalike; players under-pick "None"; small photos |
| C. Odd one out | Satisfying | Needs three confirmed photos of one cat (few cats have that); a wrong pick doesn't say which pair the player confused |
| **D. Pairs plus line-up** | Variety | Double the UI and copy; could split the data (prevented, §3.3) |

### SYC402-D3: Which pairs

> **Decided: mixed deck, weighted to close calls (recommended).** §4. **After review:** check pairs are a separate, team-marked list that stays in rotation; neighbour pairs use published positions and confirmed-or-likely colour; the round mix is fixed per round rather than by percentage.

| Option | Good | Bad |
|---|---|---|
| **A. Mixed deck** *(recommended)* | Most answers land where the tool is weakest; check pairs give a trust signal free | Pool 1 thin until spotting volume grows; the deck job is the most engineering in the spec |
| B. Close calls only | Every answer maximally useful | Runs dry in days on 28 cats; all hard; no attention check |
| C. Random public pairs | Trivial; never dry | Almost all obvious; says nothing the tool doesn't know |
| D. A cat against itself | Finds wrong matches on the map | Only finds splits; an always-"Same" player looks perfect |

### SYC402-D4: Trust

> **Decided: agreement of three, weighted by track record; guardians count for more; the team decides at once (recommended).** §6. **After review, two changes to how it's carried out:** (1) the "guardian counts double in the app" half is dropped, because the app has no way to know who a guardian is (data spine §6.5); her weight becomes a **decision on her own dashboard page** for her colony's cats (§6.3), which is stronger, not weaker. (2) "Weighted" becomes a plain counted / not-counted state, and the rule is written as one table (§6.1) with every mixed state. Samuel may prefer the original; §15.

| Option | Good | Bad |
|---|---|---|
| **A. Three agree, with a track-record check** *(recommended)* | Simple to explain; robust to one joker; uses signals the app has | Some pairs wait weeks for three answers at launch volume; not proof against several phones (§6.4) |
| B. Two agree, unweighted | Twice as fast | Two tourists making the same lookalike mistake is common |
| C. Team decides everything | No wrong label ever | The game makes a queue, not data |
| D. Majority of five | Statistically strongest | Most pairs never reach five at launch scale |

### SYC402-D5: Rewards

> **Decided: care over speed — the decided count and two badges; no points, no leaderboard, soft daily cap (recommended).** §8. **After review:** check and easy pairs don't count; uncounted devices earn nothing; the count never goes down; badges at 10 and 50 (not 25 and 100); the cap is 5 rounds a day (not 20); badges arrive through the inbox.

| Option | Good | Bad |
|---|---|---|
| **A. Decided count + badges** *(recommended)* | Rewards agreement with eventual truth; can't be gamed for rank | Moves slowly at launch volume; colluders can still credit each other (§6.4) |
| B. Points on the leaderboard | Strongest pull | A tap farm; a tourist out-ranks a guardian without seeing a cat; contaminates the 25/15 balance |
| C. A game streak | Brings people back on cat-less days | Competes with the spotting streak; rewards turning up, not accuracy |
| D. No rewards | Purest data | Most people stop after one go |

### SYC402-D6: Where it lives

> **Decided: a Home card plus a one-line nudge after a result; not the match-wait screen (recommended).** §3.1. **After review:** the line is on the reward screen; the feeding nudge is on the candidate list, a different screen.

| Option | Good | Bad |
|---|---|---|
| **A. Home card + after-result line** *(recommended)* | Findable on a cat-less day; no collision with PR #195; nothing to interrupt | One more thing on the first screen |
| B. Replace the facts on the wait screen | A captive moment | The wait is seconds; the slot was just given away; the result kills the round |
| C. A fifth tab | Most discoverable | Promotes a side activity before anyone knows if people play |
| D. On the cat's page | People who care about a cat judge it best | Only reachable from a cat page; runs dry in one sitting |

### SYC402-D7: Privacy

> **Decided: photos only; names after the answer; never a place (recommended).** §3.2, §4.2, §7.5. **After review:** no score is ever shown; the "never compared" line is gone; a pair is built only where the public map already shows its cats near each other; line-ups are in random order; colony-area personalisation is dropped; a report link is on every card. §7.5 lists what the game does reveal.

| Option | Good | Bad |
|---|---|---|
| **A. Photos only, names after** *(recommended)* | Nothing learnable about place that the public map doesn't show; names before the answer would bias the label | Locals can't use names as a clue (the point) |
| B. Plus a rough area | Easier for locals | An area word plus a recognisable background can find a feeding site; SYC-39 redacts positions for this reason |
| C. Names up front | Friendlier | Players answer from the names, which is the record error we're hunting |

### SYC402-D8: Offline

> **Decided: full offline — deck plus local scoring.** The recommendation was a prefetched deck with answers queued and the count on sync. Samuel's choice is kept for play and the reveal, and **narrowed** for the count and badges (§9), because a phone can't know whether three people agreed and the app never stores a badge. **This narrowing is put to him explicitly in §15.**

| Option | Good | Bad |
|---|---|---|
| A. Prefetched deck; answers queue; count on sync *(recommended)* | Fits the island; small; reuses the queue pattern | A hidden photo lingers while the phone is offline; the server must ignore retired pairs on sync |
| B. Nothing offline | Simplest; no lag | The person with time to spare is the one with no signal |
| **C. Full offline, deck plus local scoring** | Feels instant | The phone can't know other players' answers; a locally awarded badge would be the first stored one |

---

## 14. Out of scope, and follow-ups

- **Merging two cats into one**, and splitting one into two: **SYC-59** (filed, Phase 4). The "same cat" row here is one of its three triggers, delivered from the game; SYC-59 owns the merge. No new ticket.
- **Re-filing a sighting under another cat as a team action**: **SYC-150** (filed). Needed by §7.2 row 2. No new ticket.
- **Tuning the 0.4 threshold** using the test set: SYC-56's job once it has 200 labels (§7.1).
- **Retiring or widening the 500 m radius**: SYC-80 and SYC-151's distance-miss evidence.
- **A daily puzzle** or a timed mode: not at launch (D5).
- **Showing a player which cats they helped decide**: a later profile addition; needs no new data.

---

## 15. Open questions for Samuel at approval

1. **D8 narrowing (§9):** play and the reveal are offline; the decided count and badges arrive on sync. Do you accept that, or do you want a provisional "likely" count on the phone (which can go down on sync)?
2. **D4 carried out differently (§6.3):** guardians decide on the dashboard rather than counting double in the app. Accept, or do you want a device-marking mechanism (for example a one-time code from the dashboard that marks a guardian's phone) specified instead?
3. **The numbers** (§10.4): 5 rounds a day, 20 pairs + 3 line-ups per deck, 0.25–0.6 band, badges at 10 and 50, 90-day retirement, ten contested rows a day, 200 labels as SYC-56's first target. All settings; are these the starting values?
4. **Seeding the check pairs**: 20–30 by hand on the dashboard before the game opens. You, or Syros Cats?
5. **The milestone**: Phase 4, as proposed, or earlier?

---

## 16. Review outcome

Independent adversarial review by a Sonnet subagent of draft 1 (`reviews/matching-game-review.md`). 4 blockers, 9 majors, 8 minors, 2 nits. All addressed in this draft as follows.

| # | Finding | Severity | What changed |
|---|---|---|---|
| 1 | `catDisplayPhotos` can't cover sighting photos; compared photo may differ from the display photo | Blocker | §4.2 rewritten: sighting photos qualify only if resolved, chosen, visible, not hidden; checked at build and at fetch; close-call pairs use the compared photo, else dropped; §10.2 asks SYC-151 for `compared_photo_ids`. The false "never show more than the public page" sentence is gone. |
| 2 | Reveal and pairs leak withheld candidates, scores and closeness; "never compared" line; colony personalisation | Blocker | No score ever shown (§3.2); "never compared" removed; closeness rule (§4.2: built only where published positions are already within 1 km); random line-up order (§4.4); colony personalisation dropped (§5); §7.5 states what is revealed; D7 updated. |
| 3 | Line-up derives wrong "Different" labels | Blocker | §3.3: one choice record; one Same label; Different only on "None"; `new_cat` carried as weak; "chosen" disambiguated (spotter's vs player's). |
| 4 | Trust rule unimplementable (no guardian identity), self-contradictory, invents a capability | Blocker | Guardian in-app weight dropped; she decides on the dashboard (§5, §6.3); single rule in heads as a state table (§6.1); two capability rows proposed in §10.3; D4 and §15 record the change for Samuel. |
| 5 | Check pairs always empty by the spec's own rules; circular; copyable; credit | Major | Check pairs are a separate team-marked list that stays in rotation (§4.1); team's answer never shown (§3.2); no credit (§4.1, §8). |
| 6 | Fresh devices beat the care score and the three-device rule | Major | §6.4 states exactly what it resists and doesn't; device secret and rate limit (§4.3); re-marking on drop (§6.2); label carries device count, ages, scores, fresh-devices flag (§7.1, §10.1); deletion → unlinked (§9). |
| 7 | Mixed and stuck states undefined | Major | §6.1 state table; 90-day retirement; ten-a-day queue cap; the "matcher shouldn't be expected to either" claim removed. |
| 8 | Test set bias half-handled; no model version; no target; no copy for sub-0.1 misses | Major | §7.1 rewritten: what labels can and can't measure, both biases named, target of 200 labels and the first report; `model_version` in §10.2; one reveal line covers all close calls (§3.2). |
| 9 | 24 h stale-deck claim wrong; thumbnail copies survive removal | Major | §9: worst case is "as long as the phone is without signal"; deck check on every launch with signal; `410` on removed photos; hide/restore/remove trigger the deck job (§4.3). |
| 10 | Queue, badges, ProfileStats, Delete-my-data don't work as written; D8 narrowing | Major | §9: own queue item type and sync driver, `accepted: false` as done; badges via inbox (§3.4); `getProfileStats` cost noted (§10.1); judgements unlinked not deleted; D8 narrowing is §15 item 1. |
| 11 | Dashboard queue and guardian actions under-specified; re-file route unverified; merge retirement | Major | §7.2 names the page and its capability; re-file action listed as not existing (§12 item 5, §14 follow-up); `cat_identity` retirement (§4.2); guardian sees public data for outside cats; SYC-59 ownership stated (§7.2, §14). |
| 12 | Count farmable; override lowers count; easy pairs inflate; badge numbers; cap mismatch | Major | §8: uncounted earns nothing; count never goes down; pools 3 and 4 don't count; badges 10 and 50; cap 5 rounds with the reason restated; collusion acknowledged. |
| 13 | No way to flag a photo | Major | §3.7: report link on every card; pairs paused while a report is open. |
| 14 | "Exists today" claims: 10 nearest, top-3, `app_settings`, cache warning | Minor | §2.1 corrected (ten nearest, top three); `app_settings` named as the match-wait plan's table (§10.4, §12); cache warning cited to `coat-markings-and-health.md` §8. |
| 15 | Reveal jargon and false precision | Minor | "Our photo-matching tool found these two hard."; no percentage. |
| 16 | Pool 2 not lookalikes; stale positions | Minor | Same confirmed-or-likely colour only; published positions (§4.1). |
| 17 | Composition numbers disagree | Minor | Fixed per-round mix; deck = 4 pairs rounds + 1 line-up round (§4.1). |
| 18 | Pair identity: photos or cats | Minor | Labels per photo pair; cat-level rows need two pairs or the team's look (§7.1, §7.2). |
| 19 | Thumbnail size and route | Minor | 720 px via a size parameter on the existing route through `photoVisibility.ts`; 2–4 MB; Cache API on web (§4.3). |
| 20 | Placement conflicts with the nudge | Minor | §3.1: reward screen; nudge is on the candidate list. |
| 21 | Jargon in the spec body | Minor | A "words used" paragraph at the top. |
| 22 | Over-splitting built vs proposed | Nit | §10 retitled; launch-state remarks moved to §12. |
| 23 | §1 offline wording | Nit | §1 now uses §9's precise wording. |
