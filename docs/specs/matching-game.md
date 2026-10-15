# Tell the cats apart: a game that makes matching better

**Status:** Draft for Samuel's approval, 15 October 2026. **All eight brainstorm decisions answered by Samuel on 15 October 2026** (§13): 1, 3, 4, 5, 6 and 7 as recommended; **2 changed** to two formats from the start (pairs and line-up); **8 changed** to full offline play, narrowed in §9 for a reason given there. An independent adversarial review (Sonnet) ran on this draft; the review and how each finding was handled are in [`reviews/matching-game-review.md`](./reviews/matching-game-review.md). **Design only.** Nothing here is built, and the implementation plan comes only after approval.
**Owner:** Samuel
**Covers:** SYC-402 (design a game in the app that helps improve cat matching).
**Related:** SYC-56 (measure matching accuracy) · SYC-57 (visual memory: embeddings, then on-device matching) · SYC-151 (the team-only match record, Done) · SYC-161 (coat colour read from the photo) · SYC-303 and SYC-246 (hidden photos, privacy removal) · SYC-36 and SYC-48 (the match-wait screen, PR #195) · SYC-2 (coat and markings, PR #191) · SYC-53 (roles and invites) · SYC-43 (team dashboard) · [`choose-a-different-cat.md`](./choose-a-different-cat.md) §4.6 · [`cat-record-data-spine.md`](./cat-record-data-spine.md) §6.5, §10 · [`coat-markings-and-health.md`](./coat-markings-and-health.md) §3 · [`roles-and-invites.md`](./roles-and-invites.md) §2.2, §6.2 · [`offline-queue-on-web.md`](./offline-queue-on-web.md) · `docs/superpowers/specs/2026-07-28-engagement-and-donations-design.md` §4.3 ("standing, separate from points"), §6.7.
**Timing:** **after the MVP.** The launch plan (PR #172) freezes MVP scope for 31 October, and nothing in this spec is on it. The earliest sensible home is the "Phase 4 · Intelligence and income" milestone, next to SYC-57, because the game's first job is to feed SYC-56's baseline, which that milestone depends on. §12 says what has to exist first.

**What this document owns:** what the game looks like and feels like; where the pairs come from; when an answer counts; what the answers are used for and who may act on them; what is shown and what is never shown; the rewards; what works without signal.

**What it borrows, and does not own:** the roles and capability names (`roles-and-invites.md` §6.2); the observation model and resolver (data spine); the hide/restore log and `hiddenPhotoIds` (`photoVisibility.ts`); the offline queue pattern (`offlineQueue.ts`, `queueStore.ts`); the badge list (`badges.ts`, computed on read, never stored). Where this spec needs a new table or a new badge, §10 writes it as a proposal, not a change.

**Decision numbering.** This spec's decisions are SYC402-D1 to SYC402-D8, so they can't be confused with `DECISIONS.md`.

---

## 1. The short version

A spotter opens Cat Spotters on a day with no cat in sight, on the ferry, in a café. On Home there's a small card: **Help tell cats apart.** They tap it and see two photos of cats, and three buttons: **Same cat**, **Different cats**, **Can't tell**. They answer. The screen turns over: the cats' names, and one line about what the app's matcher thought ("The matcher wasn't sure either: 58%"). Next pair. Five of these make a round. Two minutes.

Every now and then a round is a **line-up** instead: one photo at the top, three cats below, "Which of these is this cat?", with a **None of them** button. That's the harder one, and it's what the matcher does for every spot.

Nobody is timed. Nobody is ranked. What a player sees grow is one number: **cats you've helped tell apart**, which goes up when a pair they answered is *decided* (three people agreeing), not when they tap. Two badges mark the way. The spotting leaderboard is untouched.

Underneath, every decided pair is a human-checked label the matcher can be tested against (SYC-56), and the ones that disagree with the records go to the Syros Cats team on the dashboard, who alone can say two cats are one, or one is two. Nothing a player does changes a cat.

The deck is built so that most of what players see is the matcher's **close calls**, not obvious pairs. Only photos the public can already see, never a hidden one, never a place.

It works without signal: the phone keeps a small deck, answers wait in the queue, and the decided count and badges catch up when the signal does.

---

## 2. Why a game, and why now

### 2.1 How matching works today

A spot is a photo and a position. The server takes every cat whose first-spotted position is within 500 m, sends their main photos together with the new photo to a vision model, and asks for a likelihood (0–1) that each is the same cat (`lib/matching.ts`). Candidates below 0.1 are dropped; the top three at or above **0.4** are suggested to the spotter (`routes/sightings.ts`, `CONFIDENCE_THRESHOLD`); a candidate between 0.1 and 0.4 is remembered but not named. The spotter confirms a suggestion, hand-picks a different cat, or names a new one. Since SYC-151, the server keeps a team-only record per sighting of what was compared, what was suggested with its score, what was chosen and how (`sighting_matches`), including whether a hand pick was a *matcher miss* (compared, scored low) or a *distance miss* (never compared).

### 2.2 What's missing

Nobody knows how good the matcher is. SYC-56 says, correctly, that nothing about recognition changes until a baseline exists, and a baseline needs **human-checked same-cat labels**. Today those come only from confirmed sightings, which are labels the matcher itself proposed and a spotter accepted in three seconds, so they overstate its accuracy. The hard cases, where it was unsure, or a spotter overrode it, are exactly the ones nobody has checked twice.

The 0.4 threshold "isn't named by the spec" (the code says so) and was kept on 3 October because there was nothing to tune it against. The embeddings plan (SYC-57) needs the same labels. And the same mistakes are on the map now: two records that are one cat, a sighting filed under the wrong cat.

### 2.3 Why a game, specifically

The app has an audience with time and attention and no cat in front of them: tourists on a slow afternoon, locals who know the cats and enjoy being right about them. Asking them to "review matches" is work. Asking "same cat?" with a reveal is a game people already play on their own phones. The two audiences' needs are complementary: a tourist brings fresh eyes and volume; a cat guardian brings certainty about her own cats, and her answers are weighted to match (§6.3).

### 2.4 What the game is not

- Not a way to change a cat. Only the team merges, splits or re-files, and only on the dashboard (§7.2).
- Not a points source. Nothing in it moves the leaderboard (§8).
- Not a matching service. The game never runs the vision model; it only shows what the model already thought.
- Not an MVP feature (§ Timing above).

---

## 3. What a spotter experiences

### 3.1 Finding it

**The Home card** (`app/(tabs)/index.tsx`), below "cats near you": a small card, **Help tell cats apart**, with the player's count under it once they have one ("You've helped tell 12 cats apart"). It's a card, not a banner; it never pushes nearby cats down more than one row.

**After a spot**: on the first result screen after a resolved spot (`review.tsx`, the reward screen), one line under everything else: *"Two minutes to spare? Help us tell cats apart."* It sits below the feeding nudge and the matches, never above them (the nudge's own rule, `feeding-nudge.md` §1). It doesn't show on a queued sighting reviewed later.

**Not on the match-wait screen.** The wait is a few seconds, it was given to the feeding nudge and the facts on 15 October (PR #195), and a round interrupted by the result arriving is worse than no round. (SYC402-D6.)

### 3.2 A pairs round

Five pairs. For each: two photos side by side (stacked on a narrow phone), the same size, no name, no date, no map, no words about where. Three buttons, equal weight: **Same cat** · **Different cats** · **Can't tell**. Tapping one turns the card over:

- the public name of each cat (or "the same cat: Mikis" when the records say they're one);
- one line from the matcher, in plain words: *"The matcher thought 58% likely the same."* / *"The matcher never compared these two."* / *"Syros Cats have confirmed these are different cats."* (only on a known pair, §4.2);
- and, if this answer settled the pair, *"That settles it. Three of you agree."*

No "correct" or "wrong". On most pairs nobody knows yet; that's why we're asking. On a known pair the reveal says what the team said, and the player can see for themselves whether they agreed.

**Can't tell** is a real answer, not a skip. A pair that three people can't tell apart is a pair the matcher shouldn't be expected to either, and the team may want a better photo of one of the cats. It never counts toward a decision (§6.1) and it never counts against the player (§6.2).

A round ends with the player's count and, if it moved, by how much. Then **Another round** or **Done**.

### 3.3 A line-up round

Every fourth round, when the deck has one (§4.4), is a line-up: one photo at the top ("Which of these is this cat?"), three cats below, each as one photo, and a fourth button, **None of them**. One tap. The reveal names all four cats and says what the matcher did with this exact sighting: *"The matcher suggested Mikis (71%); the spotter chose Mikis."* / *"The matcher suggested nobody; the spotter named a new cat."*

A line-up is a real match the app once made, replayed. The target is a sighting's photo; the three cats are what the matcher compared, with the chosen cat and the strongest runners-up (§4.4). **None of them** is right when the spotter named a new cat, so the deck must carry enough of those for "None" to be a live option, not a trick.

One line-up answer is stored as **up to three pair judgements**: *target vs. chosen* = Same, *target vs. each other candidate* = Different; **None of them** = Different against all three (§6.1). So both formats fill the same table and nothing is split.

### 3.4 The count and the badges

Under the Home card and on the profile: **Cats you've helped tell apart: 12.** It counts **decided** pairs the player answered on the winning side (§6.1). It goes up when the third agreeing answer arrives, which may be days after the player's own. The profile line says so: *"Counted when three people agree."*

Two badges, in the existing list (`badges.ts`, computed on read): **Sharp eyes** at 25 and **Cat detective** at 100. Both show on the profile with the others and arrive the same way ("New badge unlocked!").

### 3.5 When the deck runs out

The deck is finite and at launch volumes it will be thin. When there's nothing left that this phone hasn't seen, the card says *"You've seen every pair we have. New ones appear as cats are spotted."* and doesn't offer a round. It never repeats a pair to the same phone (§4.5). This is better than padding with obvious pairs, which teach the matcher nothing and teach the player the game is pointless.

### 3.6 Three languages

Every string here ships in English, Greek and French through the normal route (SYC-4 native review for Greek and French). The buttons are the only text a player must read to play; the reveal is one line.

---

## 4. The deck: which pairs we show

**SYC402-D3: a mixed deck, weighted to close calls.** The whole value of the game is in this section. A pair of a black cat and a ginger cat is a wasted tap.

### 4.1 Four pools

| Pool | What it is | Where it comes from | Why it's in |
|---|---|---|---|
| **1. Close calls** (about half of every round) | A sighting photo against a cat the matcher scored between **0.25 and 0.6**; and every **hand pick after a matcher miss** (the spotter chose a cat the matcher scored low) | `sighting_matches` (SYC-151): `suggested[].score`, `choice = 'hand_pick'`, `miss_kind = 'matcher_miss'` | These are the matcher's errors and near-errors. A label here changes what we know. |
| **2. Neighbours** (about a quarter) | Two cats whose positions are within 500 m of each other and share a resolved coat colour (SYC-161 / SYC-2 `coat`), or both have no colour yet | `cats` positions; the `coat` observation (`resolveCoat`) | The lookalikes the matcher is most likely to confuse, and the pairs most likely to be one cat with two records. |
| **3. Known pairs** (about one in six) | A pair the team has already decided on the dashboard, Same or Different | The game's own decisions, once the team has made some; seeded at the start by the team deciding 20–30 pairs by hand | A quiet check that the player is paying attention (§6.2), and a few pairs per round that *can* be got right, so a round feels winnable. |
| **4. One easy pair** (one per round) | Two cats with different resolved colours, far apart | `cats`, `coat` | A quick win at the start of a round. Its answer is stored but weighted zero in the test set. |

The weights (50/25/15/10) are a starting point to be tuned once there is data; they're a setting, not code.

### 4.2 Pairs the deck never contains

- Any photo that is **hidden** (`photo_visibility_events`, latest action `hide`), for any reason, or **deleted** under SYC-246, or any photo sent privately with a report or by a guardian (`roles-and-invites.md` §2.2). The deck is built only from `catDisplayPhotos`, the same helper the public cat page uses, so the game can never show more than the public page does. (SYC-303 is about the matcher; the game doesn't have that gap because it starts from the public rule.)
- A pair involving a cat the public can't see.
- A pair the team has **retired** (§7.2: decided, merged, or marked "don't ask").
- A pair this phone has already answered (§4.5).
- Two photos of the **same sighting**.

### 4.3 How the deck is built

A server job (nightly, and after each team decision) refreshes a `game_pairs` table (§10) from the four pools, scoring each pair by how useful an answer would be: unanswered close calls first, then pairs with one or two answers that need a third, then neighbours. It caps the deck at a few hundred live pairs so the job is cheap. A phone asks for **the next 20 pairs and 5 line-ups it hasn't seen**, as thumbnail-sized photos (longest side 480 px, under 1 MB for the whole deck). The deck is the only thing the phone ever holds (§9).

### 4.4 Line-ups

A line-up is built from one `sighting_matches` row with at least three compared cats: the target is the sighting's photo; the three candidates are the chosen cat plus the two highest-scoring others, or, when the choice was `new_cat`, the three highest-scoring compared cats (then **None of them** is the record's answer). Line-ups are drawn so that roughly **one in four has "None" as the record's answer**; if the pool can't supply that, fewer line-ups, never padded. A line-up never includes a hidden photo or a cat the public can't see; if any of its four photos fails §4.2 the whole line-up is dropped.

### 4.5 One answer per phone per pair

A phone answers a pair once. The server rejects a second answer from the same device for the same pair (first wins), so a player can't vote twice by replaying an old deck, and the same person can't be two of the three agreeing voices. Two devices in one pocket are a known hole; the trust rule (§6.2) is what limits the damage.

---

## 5. Both audiences

Tourists and cat guardians need complementary things from this, and the design gives each what they bring:

| | A tourist with a few minutes | A cat guardian who knows the cats |
|---|---|---|
| **What they bring** | Fresh eyes, volume, no stake in the answer | Certainty about her own cats; she knows Mikis has one torn ear |
| **What the game gives them** | Five quick pairs, a reveal that teaches what to look for (ear tips, tail kinks, coat breaks), a count that grows while they're on the island | The line-up rounds; pairs from her own colony's area surface first for her (§6.3); her answer counts double there |
| **What the game must not do** | Make them feel tested, or wrong | Waste her time on a ginger-vs-black pair, or let three tourists outvote her on her own cat (they can't: her two votes plus any one agreeing tourist decides; three tourists against her leaves the pair **contested**, which goes to the team, §7.2) |

Neither audience is asked to type anything, and neither is told where a cat lives.

---

## 6. When an answer counts

**SYC402-D4: agreement of three, weighted by track record.**

### 6.1 The decision rule

The unit is a **pair judgement**: device, pair, answer (Same / Different / Can't tell), time. A line-up round writes up to three (§3.3).

A pair is **decided** when judgements from **three different devices**, counted by weight (§6.3), agree on Same or Different and no counted judgement disagrees. *Can't tell* never counts for or against. The first disagreement makes the pair **contested**: it stays in the deck until it has five counted judgements, then the majority decides if it's at least 4–1; anything closer stays contested and goes to the team (§7.2). A decided pair leaves the deck. A team answer on the dashboard decides at once and overrides any player decision.

### 6.2 Track record

Each device carries a hidden **care score**: on the known pairs it has answered (§4.1 pool 3), what share matched the team's answer. *Can't tell* on a known pair doesn't count either way. Until a device has answered five known pairs, its judgements count at weight 1. Below **60 %** on five or more known pairs, its judgements still save (the player sees nothing different) but count at weight 0 until the score recovers above 60 %. The score is never shown and never named; it's not a rank, and a player can't see or compare it. A careless tapper earns a count that doesn't move (because their answers rarely land on the winning side) and nothing else. That is the whole penalty, on purpose.

### 6.3 Who counts for more

- **A cat guardian**, signed in as one (SYC-53), answering a pair where **at least one cat is in her own colony**: weight 2. Elsewhere, weight 1 like anyone. Her weight-2 judgement can never decide alone (it takes a third counted vote).
- **The Syros Cats team**, on the dashboard only (§7.2): decides at once. The team doesn't play in the app as the team; a team member's phone is a phone.
- **Nobody else** carries extra weight. Points, streaks and badges change nothing here.

At launch there is no sign-in in the app (`match-wait-screen.md` C4), so everyone is weight 1 until SYC-53's app work lands. The rule is written now so that lands cleanly.

---

## 7. What the answers are used for

**SYC402-D1: staged.** Each stage is useful on its own and none changes a cat without the team.

### 7.1 Stage 1: the test set (SYC-56)

Every **decided** pair is a label: two photos, Same or Different, with the trail of how it was decided. SYC-56's evaluation set is built from these plus confirmed sightings, and the two are kept distinguishable (a game label is marked `source = 'game'`), because the game's labels are concentrated on close calls and would make an accuracy figure look worse than the real-world mix; both numbers matter. Pool-4 easy pairs are weighted zero. Known pairs (pool 3) are already team labels and aren't double-counted. The first thing this buys is a number for the 0.4 threshold.

### 7.2 Stage 2: the review queue (dashboard)

Three things a decided or contested pair can say about the records, each becoming a row in a **"Matching to check"** queue on the team dashboard (SYC-43's queue pattern), visible to the team only:

| The players say | The records say | The queue row | Only the team can… |
|---|---|---|---|
| Same | Two different cats | *"Players think Mikis and Ermis are one cat (3 of 3)."* | Merge, keep separate (and retire the pair), or ask for a better photo |
| Different | One cat (a sighting filed under it) | *"Players think this sighting isn't Mikis (3 of 3)."* | Re-file the sighting (the existing choose-a-different-cat path, as the team), keep, or retire |
| Contested (see §6.1) | Anything | *"Players disagree about Mikis and Ermis (3–2)."* | Decide it, which makes it a known pair |
| Can't tell × 3 | Anything | *"Nobody can tell these apart from these photos."* | Note the cat needs a clearer main photo |

A guardian sees rows about her own colony's cats on her own page (`roles-and-invites.md` §2.2) and can decide those with her `confirm`-class capability for her colony, recorded with who said it, exactly as her other statements are. **Merging and splitting cats stays with the team**, because a merge reaches every sighting, every spotter's collection and every subscription on both cats, and there is no merge today (SYC-63 is the deletion family; merge needs its own spec and is **out of scope here**, §14). Until merge exists, "Merge" in the queue is a note for Samuel, not a button.

### 7.3 Stage 3: training input (SYC-57)

When SYC-57 starts, the same labelled pairs are its training and validation material, with the `source` and the decision trail intact so that a bad label can be traced and withdrawn. Nothing extra is collected for this; the stage is just a reader.

### 7.4 What's never done with an answer

- Changing a cat, a sighting, a photo or a colour from a game answer alone.
- Showing a player's answers to anyone but the team.
- Using the care score anywhere outside §6.

---

## 8. Rewards

**SYC402-D5: care over speed.** Pulled from the engagement design's "standing, separate from points" (§4.3) and "money must never buy points" (§6.7): here, **taps must never buy standing**.

- **One number**: cats you've helped tell apart. It moves when a pair you answered is decided on your side. Honest about its lag (§3.4).
- **Two badges**: Sharp eyes (25) and Cat detective (100). Added to `badges.ts` as derived from live stats like the others.
- **No points.** No leaderboard movement. No timer. No streak. No daily puzzle at launch (it's a one-line addition later if people ask).
- **A soft cap**: 20 rounds a day per device. The card says *"That's plenty for today. Thank you."* Reason: at launch the deck is small and a grinder would exhaust it in an hour; and a person doing their 21st round is rarely still looking carefully.
- **Nothing for being fast, nothing for being first.**

---

## 9. Offline

**SYC402-D8: full offline, narrowed.** Samuel chose "deck plus local scoring". The deck and the play are fully offline. "Local scoring" is narrowed to what a phone can know, for two reasons written down so they can be overruled: the count is defined as *decided* pairs (§3.4) and a phone can't know other players' answers; and the app's rule is that badges are computed on the server from live stats and never stored (`SPEC.md` §5.6), so a badge awarded by the phone would be the first stored one.

**What works without signal, precisely:**

| Works offline | Needs signal |
|---|---|
| Playing every pair and line-up in the **prefetched deck** (20 pairs, 5 line-ups, fetched whenever the app opens with signal and the deck is under half full) | Getting a new deck |
| The **reveal**, in full: names and the matcher's line are carried in the deck | — |
| A **provisional tally** for the round and the day: "5 answered · 5 waiting to send" | The **decided count** and the **badges** (they catch up on sync, with the normal "New badge unlocked!") |
| Answers **queued** in the existing queue store (`queueStore.ts`), sent in order when signal returns, with the same retry rules as a queued spot | — |

**Honest edges, stated:**
- A photo hidden by the team after the deck was fetched can be shown offline until the deck is replaced: **up to 24 hours**, because a deck expires 24 hours after fetch and the card then says "Needs signal for new pairs". The server drops any queued answer for a retired pair on sync, silently to the player.
- The deck is the only cat data the game keeps on the phone: thumbnails and names of public cats, nothing about positions. It's deleted with the app's other local data by "Delete my data" (SYC-63).
- The deck is **not** in the offline cat-alogue cache and doesn't change its version (SYC-161's warning: a retired key empties offline catalogues).

---

## 10. Proposed tables and fields (team-only; none in any public payload)

| Table | Holds | Notes |
|---|---|---|
| `game_pairs` | pair id, photo A, photo B, cat A, cat B, pool (1–4), source sighting (pool 1), status (`live` / `decided` / `contested` / `retired`), decided answer, decided by (`players` / `team` / `guardian`), decided at | Built by the deck job (§4.3). Retired pairs never return. |
| `game_lineups` | line-up id, source sighting, target photo, three candidate cats with photo ids, record's answer (cat id or `none`), status | §4.4 |
| `game_judgements` | judgement id, device id, pair id, answer, weight at the time, from line-up (nullable), created at | One per device per pair (unique index). Linked to the device like a sighting is, so "Delete my data" removes them (§9). |
| `game_devices` | device id, known pairs seen, known pairs right, rounds today, last deck fetched at | The care score is derived, never stored as a number shown anywhere. |
| New settings rows | pool weights, daily cap, deck size, line-up frequency | In `app_settings` (match-wait plan Decision 1) so they change without a release. |

Profile payload gains one integer, `pairsDecided`. Nothing else public changes. The two badges are two lines in `badges.ts`.

---

## 11. Costs

- **Model calls: none.** The game never calls the vision model. The matcher's line in the reveal comes from `sighting_matches`.
- **Storage:** thumbnails are generated once per photo into the deck response, not stored separately; a few hundred live pairs is a few hundred rows.
- **Team time:** seeding the known pairs (20–30 decisions, an hour), then the queue, whose size the players set. The daily cap and the deck cap bound it.

---

## 12. What has to exist first, and when this could ship

1. **SYC-151's match record** has rows: it does, since 3 October, but pool 1 needs weeks of real spotting after launch to be more than a handful of pairs.
2. **SYC-161 / SYC-2 coat colour** on cats, for pool 2 and pool 4: in progress, landing before launch.
3. **The dashboard queue pattern** (SYC-43 part 2) for §7.2: exists for welfare; this adds a queue.
4. **`app_settings`** (match-wait plan, PR 1, 23 October) for the weights and caps.
5. **SYC-53 app sign-in** for guardian weighting (§6.3): not needed to ship; the rule degrades to weight 1.
6. **A merge-cats action** for the queue's "Merge": **does not exist**, and is out of scope (§14). Ship with "Merge" as a note.

Realistic earliest: **four to six weeks after launch** (early December 2026), once pool 1 has content and the launch work is settled. Suggested milestone: Phase 4.

---

## 13. Decisions

All eight answered by Samuel on 15 October 2026 through question prompts in this session. His answer is at the top of each; the options stay as the record of what he chose between.

### SYC402-D1: What the answers are for

> **Decided: staged — test set first, then review queue, then training (recommended).**

| Option | Good | Bad |
|---|---|---|
| **A. Staged** *(recommended)* | Useful from day one with zero risk to cat records; trust can start loose and tighten; each later stage is a reader of the same labels | Players don't see answers "do" anything until stage 2 |
| B. Test set only | Simplest; no merge or privacy risk | Wrong matches on the map stay wrong when ten players flagged them |
| C. Review queue first | Fixes real data soonest | Two staff can't keep up with a popular game; needs the dashboard plumbing first |
| D. Direct training input | ML gets data fastest | SYC-57 doesn't exist; SYC-56 forbids recognition work before a baseline |

### SYC402-D2: Game format

> **Decided: both formats from the start — pairs as the quick round, line-up as the challenge round.** The recommendation was pairs only. The cost accepted: two screens and two sets of copy in three languages. The spec keeps one answer model under both (§3.3) so the data doesn't split, which was the main risk.

| Option | Good | Bad |
|---|---|---|
| A. Same cat or not? pairs with Can't tell *(recommended)* | Maps exactly to the label SYC-56 needs; Can't tell is itself data; fastest to learn in three languages | Least "gamey" on its own |
| B. Line-up | Mirrors what the matcher and the spotter do; one round yields up to three labels | Needs a plausible lookalike; players under-pick "None"; small photos |
| C. Odd one out | Satisfying | Needs three confirmed photos of one cat (few cats have that); a wrong pick doesn't say which pair the player confused |
| **D. Pairs plus line-up** | Variety | Double the UI and copy; splits the data (mitigated, §3.3) |

### SYC402-D3: Which pairs

> **Decided: mixed deck, weighted to close calls (recommended).** §4.

| Option | Good | Bad |
|---|---|---|
| **A. Mixed deck 50/25/15/10** *(recommended)* | Most answers land where the matcher is weakest; known pairs give a trust signal free | Pool 1 thin until spotting volume grows; the deck job is the most engineering in the spec |
| B. Close calls only | Every answer maximally useful | Runs dry in days on 28 cats; all hard; no attention check |
| C. Random public pairs | Trivial; never dry | Almost all obvious; says nothing the matcher doesn't know |
| D. A cat against itself | Finds wrong matches on the map | Only finds splits; an always-"Same" player looks perfect |

### SYC402-D4: Trust

> **Decided: agreement of three, weighted by track record; guardian weight 2 in her colony; team decides at once (recommended).** §6.

| Option | Good | Bad |
|---|---|---|
| **A. Three agree, weighted** *(recommended)* | Simple to explain; robust to one joker; uses signals the app has | Some pairs wait weeks for three answers at launch volume |
| B. Two agree, unweighted | Twice as fast | Two tourists making the same lookalike mistake is common |
| C. Team decides everything | No wrong label ever | The game makes a queue, not data |
| D. Majority of five | Statistically strongest | Most pairs never reach five at launch scale |

### SYC402-D5: Rewards

> **Decided: care over speed — the decided count and two badges; no points, no leaderboard, soft daily cap (recommended).** §8.

| Option | Good | Bad |
|---|---|---|
| **A. Decided count + badges** *(recommended)* | Rewards agreement with eventual truth; can't be gamed for rank | Moves slowly at launch volume |
| B. Points on the leaderboard | Strongest pull | A tap farm; a tourist out-ranks a guardian without seeing a cat; contaminates the 25/15 balance |
| C. A game streak | Brings people back on cat-less days | Competes with the spotting streak; rewards turning up, not accuracy |
| D. No rewards | Purest data | Most people stop after one go |

### SYC402-D6: Where it lives

> **Decided: a Home card plus a one-line nudge on the reward screen; not the match-wait screen (recommended).** §3.1.

| Option | Good | Bad |
|---|---|---|
| **A. Home card + after-result line** *(recommended)* | Findable on a cat-less day; no collision with PR #195; nothing to interrupt | One more thing on the first screen |
| B. Replace the facts on the wait screen | A captive moment | The wait is seconds; the slot was just given away; the result kills the round |
| C. A fifth tab | Most discoverable | Promotes a side activity before anyone knows if people play |
| D. On the cat's page | People who care about a cat judge it best | Only reachable from a cat page; runs dry in one sitting |

### SYC402-D7: Privacy

> **Decided: photos only; names after the answer; never a place (recommended).** §3.2, §4.2.

| Option | Good | Bad |
|---|---|---|
| **A. Photos only, names after** *(recommended)* | Nothing learnable that the public map doesn't show, minus the location; names before the answer would bias the label | Locals can't use names as a clue (the point) |
| B. Plus a rough area | Easier for locals | An area word plus a recognisable background can find a feeding site; SYC-39 redacts positions for this reason |
| C. Names up front | Friendlier | Players answer from the names, which is the record error we're hunting |

### SYC402-D8: Offline

> **Decided: full offline — deck plus local scoring.** The recommendation was a prefetched deck with answers queued and the count on sync. Samuel's choice is kept for play and the reveal, and **narrowed** for the count and badges (§9), because a phone can't know whether three people agreed and the app never stores a badge. He can overrule the narrowing by letting the phone show a provisional "likely" count; the spec recommends against it because a number that goes *down* on sync is worse than one that lags.

| Option | Good | Bad |
|---|---|---|
| A. Prefetched deck; answers queue; count on sync *(recommended)* | Fits the island; small; reuses the queue pattern | Hidden-photo lag up to one deck lifetime; server must drop retired pairs on sync |
| B. Nothing offline | Simplest; no lag | The person with time to spare is the one with no signal |
| **C. Full offline, deck plus local scoring** | Feels instant | The phone can't know other players' answers; a locally awarded badge would be the first stored one |

---

## 14. Out of scope, and follow-ups

- **Merging two cats into one**, and splitting one into two: needs its own spec (it touches sightings, collections, subscriptions, the match record and the deletion family in SYC-63). The queue shows the need; it doesn't act on it. *Follow-up ticket.*
- **Tuning the 0.4 threshold** using the test set: SYC-56's job once it has labels.
- **Retiring the 500 m radius** or widening it: SYC-80 and SYC-151's distance-miss evidence; the game's pool 2 doesn't depend on it.
- **A daily puzzle** or a timed mode: not at launch (D5).
- **Showing a player which cats they helped decide**: a nice later addition to the profile; needs no new data.
- **Photo quality asks** ("Nobody can tell these apart"): the queue row exists (§7.2); a route for the team to ask a guardian for a better photo is SYC-54's colony view, not this spec.

---

## 15. Open questions for Samuel at approval

1. The **daily cap** of 20 rounds and the **deck size** of 20 + 5: are these the numbers to start with? (Both are settings.)
2. **Seeding the known pairs**: 20–30 by hand on the dashboard before the game opens. Is that you, or Syros Cats?
3. The **milestone**: Phase 4, as proposed, or earlier?
