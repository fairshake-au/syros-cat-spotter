# Adversarial review: `matching-game.md` (SYC-402)

**Reviewer:** independent subagent, Sonnet tier, 15 October 2026. Read-only. Checked the spec against the code on branch `claude/bold-bardeen-uveanq` (head `ce81061`), the Linear ticket SYC-402, the specs and plans named in the brief, and `CLAUDE.md`.
**Reviewed version:** `docs/specs/matching-game.md` at `ce81061` (draft with Samuel's eight decisions recorded).
**Outcome:** **Needs rework before approval.** 4 blockers, 9 majors, 8 minors, 2 nits. The format, rewards, placement and staging decisions are sound. The weak parts are the pair data model, the trust rule and the privacy claims.

> **How each finding was handled** is recorded in the spec's §16 ("Review outcome"), draft 2 of `matching-game.md`. The text below is the reviewer's, unedited.

Where a section number alone cannot point to a spot, the finding quotes the spec's words.

---

## In plain English (for Samuel)

The idea is good and the decisions you made hold up. The ticket's questions are all answered, including odd-one-out, timed rounds and daily puzzles, which are rejected for stated reasons. The trouble is underneath.

1. **The spec says it can never show more than the public cat page shows. That is not true.** The game's main pair type shows a sighting photo, and the public-photo helper it names only covers cats' display photos. Several kinds of sighting photo (hidden, private, still waiting for a match) are not public.
2. **The line-up turns one tap into labels that are wrong.** Picking the best of three cats is stored as "Different" against the other two, even when two of the three records are the same cat. Those are the duplicates the game is meant to find.
3. **"Three people agree" can be beaten by one person with three phones.** The extra weight for cat guardians cannot work, because the app has no way to know who a guardian is, and the spec's own text disagrees with itself about how many votes decide a pair. The rule also never says what happens to two agreeing votes plus one "can't tell".
4. **The reveal screen and the pair choices tell players which cats are close to each other.** They show scores and names the matcher deliberately withholds from the public. The privacy table says "nothing learnable that the public map doesn't show". That is not quite right.

All of this can be fixed on paper, and the fixes are listed below. The spec also has no target for how many labels it needs, so nobody could tell whether it worked.

---

## Blockers

### 1. "Built only from `catDisplayPhotos`" cannot cover the sighting photos the game mostly uses (§4.2, §4.1 pool 1, §4.4)
**Spec says:** §4.2: "The deck is built only from `catDisplayPhotos`, the same helper the public cat page uses, so the game can never show more than the public page does."
**What is true:** `catDisplayPhotos` (`photoVisibility.ts:84`) takes cats and returns each cat's *display photo*: its main photo, or the newest visible photo of that cat if the main one is hidden. Pool 1 is "a sighting photo against a cat". The line-up target is "the sighting's photo" (§4.4). Neither of those is a cat's display photo.

A sighting photo can be:
- hidden (`hiddenPhotoIds` is the check, not `catDisplayPhotos`);
- sent privately, or from a report;
- on a sighting that is still unresolved, or one that was sent to Syros Cats for matching. Those positions are team-only (roles §6.2 note 3), and the photo is not on any public page.

The `sighting_matches` rows the deck is built from include `sent_to_team`, `unlabelled` and `matcherFailed` rows. The spec never says which rows qualify.

**A second break in the same place.** The matcher does not compare display photos. `routes/sightings.ts` (the `candidateInputs` loop, around lines 262 to 274) reads `cat.primaryPhotoId` raw. That is exactly SYC-303 ("a hidden main photo is still sent to the matcher"), and the spec says only that "the game doesn't have that gap". But the stored score belongs to the photo that was compared. If that photo is now hidden, the game shows a different one (the stand-in), and the reveal still says "the matcher thought 58%". The label then attaches to a pair the matcher never scored. The cat's main photo can also change after matching.

**Fix:**
- State the rule precisely: a sighting photo qualifies only if its sighting is `resolved` and the photo is not hidden (`hiddenPhotoIds`).
- Run that check again at deck-request time, not only when the deck is built.
- Exclude rows with `choice` of `sent_to_team` or `unlabelled`, and rows with `matcherFailed`.
- For pool 1, store the id of the cat photo that was actually compared. Add the compared photo's id to `sighting_matches`, or drop pool 1 pairs whose compared photo is no longer the cat's current display photo.
- Remove the sentence "the game can never show more than the public page does", or make it true.

### 2. The privacy table's "nothing learnable that the public map doesn't show" is false (§3.2, §4.1, §5, D7)
Four separate leaks:

- **Withheld candidates are shown by name, with a score.** Pool 1 spans scores 0.25 to 0.6. The 0.25 to 0.4 band is exactly the band the public response withholds: "left out of the response ENTIRELY" (`CONFIDENCE_THRESHOLD` comment, `sightings.ts`). It is also the band `DECISIONS.md` Part 2h and data spine §6.3 point 3 protect ("a candidate set never reveals its own geography"). The reveal then names the cat and gives its score.
- **Pairs prove closeness at finer than the published grid.** Any pool 1 pair shows a sighting that was within 500 m, by exact position, of that cat's first-spotted point. Any pool 2 pair is two cats within 500 m of each other, by exact position. The public map blurs to 250 m cells (spine §6.2). A line-up shows three cats that are all within 500 m of one real sighting. Harvested over many devices, these are position constraints on both the sighting and the cat. This is the passive version of the oracle that spine §6.3 calls "fixed, not accepted", and Samuel accepted only the *active* probing risk in Part 2h.
- **"Never compared" means different things for different pools.** The matcher compares a sighting to cats. It never compares cat to cat. So for pools 2 and 4 the line "The matcher never compared these two" is always true and tells the player nothing. For pool 1 it never applies. If the line is ever shown for a real sighting-versus-cat pair, it proves that pair was more than 500 m apart. Pool 4 is defined as "far apart". So the line's presence or absence depends on how the pair was built, which the spec never defines.
- **"Pairs from her own colony's area surface first for her" (§5).** This contradicts "never a place". It also needs the server to know which colony a device is tied to (see finding 4).

**Fix:**
- Show names and scores only for candidates that were above 0.4 (`shown`), or show no score at all.
- Build pool 1 and the line-ups only from pairs whose cats and sighting already share published information, or drop names from pool 1 and line-up reveals.
- Randomise the order within a line-up. Never order by score or distance.
- Define when the "matcher" line appears and remove "never compared".
- Add a line to D7 that says what the game does reveal.
- Drop the colony-area personalisation, or specify how it works without exposing colony membership.

### 3. A line-up answer becomes wrong pair labels (§3.3, §13 D2)
**Spec says:** "One line-up answer is stored as up to three pair judgements: target vs. chosen = Same, target vs. each other candidate = Different; None of them = Different against all three."

**What breaks:**
- **The forced "Different" is not something the player said.** The player picked the best of three. If two of the three candidates are records of the same cat (the duplicates the game exists to find, §2.2 and pool 2), the player picks one and the other is stored as "Different". Three such answers then produce a confident, wrong "Different 3 of 3" for a duplicate pair, which feeds queue row 2.
- **"Chosen" is ambiguous.** It could mean the spotter's original choice (the record) or the player's pick. If it is the record's choice, the player's answer is compared with a record that §2.2 says "overstates its accuracy". If it is the player's pick, see above.
- **"None of them" is the weakest evidence in the record.** The "None" answer comes from `choice = new_cat`. `choose-a-different-cat.md` §4.6 calls a new-cat choice "weak but useful evidence", and the new cat is often a duplicate.
- **"None" has a known prior.** "Roughly one in four" is stated in the spec, and the D2 table itself says players under-pick it.
- **The candidate list is truncated.** Only the top 3 at 0.1 or above are stored (`rankedForRecord`). A line-up cannot show "all cats compared".

**Fix:**
- Store a line-up answer as one record of the form "from these N, the player chose X (or none)". Derive a pair label only for "Same". Derive "Different" only if the player taps "None".
- Say that a line-up never produces a "Different" for a candidate the player did not rule out.
- Record who (the player or the record) "chose".
- Exclude `new_cat` rows from "None" line-ups, or tag them as weak.

### 4. The trust rule cannot be implemented as written, and it contradicts itself (§5, §6.1, §6.3, §7.2)
- **Guardian weight needs an app identity that the architecture says will never exist.** Data spine §6.5: "There is no sign-in in the app and there is not going to be one: identity is an anonymous per-device id plus a device secret." Roles §2.2 note 3: "A guardian takes photos in the public app under its anonymous phone identity." So "a cat guardian, signed in as one (SYC-53), answering a pair where at least one cat is in her own colony: weight 2" has no mechanism. §12 item 5 says "not needed to ship; the rule degrades to weight 1". But §5 and the D4 decision are sold on that weighting.
  - A claimer is not a guardian. A claim needs no endorsement (roles §2.2, last paragraph).
  - The spec cannot reuse "claimed a cat" as a stand-in for guardian.
- **The decision rule says three things.** §6.1: "three different devices, counted by weight, agree". §5: "her two votes plus any one agreeing tourist decides" (that is two devices). §6.3: "Her weight-2 judgement can never decide alone (it takes a third counted vote)". So either three devices or total weight 3, and §5 and §6.3 disagree.
- **The rule has gaps:**
  - Does weight 0 count toward the "three different devices"? Presumably not, but it is not stated, and a weight-0 judgement may or may not trigger "contested".
  - "Five counted judgements" and "at least 4 to 1" could mean heads or weights.
  - Is a guardian's Same plus a tourist's Same (weight 3) decided? Is that decided by weight, or still waiting for a third device?
- **§7.2 invents a capability.** "Her `confirm`-class capability for her colony". There is no `confirm` capability. The roles catalogue (`roles-and-invites.md` §6.2) is "the single list of capability names", and a spec that needs a power "adds a row here first". The nearest rows are `review_hand_picks` (hand picks only), `set_appearance` and `set_sterilisation`. None of them covers "decide a pair".
  - A pair spans two cats. A placed capability needs one target colony per request (roles §6.1), and a cat in no colony is island-only.
  - The spec says it adds no capabilities. It does.

**Fix:**
- Pick one rule, in weights and heads, and write the three cases (guardian plus tourist, guardian against three, mixed) as a table.
- Drop guardian weighting from the design until a mechanism exists, or define one (for example a one-time code from the dashboard that marks a device).
- Replace `confirm`-class with a new row proposed in the roles catalogue, named, with its kind (placed or island-only) and what happens when the two cats are in different colonies.

---

## Majors

### 5. Pool 3 ("known pairs") contradicts §4.2 and §6.1, and is partly circular (§4.1, §4.2, §6.1, §6.2, §7.2)
- §4.2 says the deck never contains "a pair the team has retired (§7.2: decided, merged, or marked 'don't ask')". §6.1 says "A decided pair leaves the deck. A team answer on the dashboard decides at once". Pool 3 is "a pair the team has already decided". By the spec's own rules, pool 3 is always empty.
- The source is given as "the game's own decisions, once the team has made some". So known pairs partly come from the contested and decided pairs the game produced and the team then adjudicated. These are the hardest pairs, and they are selected by the game itself. The care score then measures agreement with the team on exactly those, so honest players are penalised for hard pairs.
- After answering, a pool 3 reveal says "Syros Cats have confirmed these are different cats". Any device farm can answer once, read the reveal, and build a lookup table. Later devices then score 100% on known pairs.
- It is not said whether answering a known pair counts toward the "cats you've helped tell apart" count (§3.4). If it does, 1 in 6 answers give credit immediately.

**Fix:** keep pool 3 as a separate list of team-decided pairs that stay in rotation and are explicitly exempt from §4.2's "retired" rule. Say how it grows. Do not show the team's answer on the reveal for known pairs, or only after the player has used up their daily allowance. Decide whether known and easy pairs count toward the decided count (recommend: they do not).

### 6. The care score and the "three devices" rule are easy to beat with fresh devices (§4.5, §6.1, §6.2)
- A device has weight 1 until it has answered five known pairs. A fresh device starts at weight 1. Someone who makes new devices never builds a score to lose.
- Cost of a new device: `deviceAuth.ts` is trust-on-first-use. `newDeviceLimit.ts` (SYC-195) caps *new devices per internet address*, and its own comment says it "is NOT the defence against an attacker with many addresses". The spec does not cite it, nor require the device secret or a rate limit on the deck and answer endpoints.
- "Delete my data" is another route to a fresh identity: after deletion the device gets a new one, and §4.5's one-answer-per-device rule resets.
- Weights are stored "at the time" (`game_judgements.weight`, §10). A device caught below 60% keeps its earlier weight-1 votes inside already-decided pairs. The spec says nothing about re-weighing or reopening them.
- §4.5 admits "Two devices in one pocket are a known hole; the trust rule (§6.2) is what limits the damage". The trust rule does not limit it.
- The consequence is poisoned test-set labels (SYC-56) and a flooded team queue. It does not change a cat, which is the right limit (§7.4). But "robust to one joker" (D4) is the only claim made, and it needs to be tested against "three fresh devices agree".

**Fix:** require the device secret and a per-device rate limit on both game endpoints (cite SYC-195). State plainly that the rule resists one careless or joking person, not a person with several devices. Re-weigh stored judgements if a device later drops below the threshold. Mark game labels with the number of distinct devices and the devices' age, so a suspicious cluster can be found. Treat a burst of decisions from new devices as a team alert.

### 7. Stuck and mixed states are undefined (§6.1, §3.2, §7.2)
- **Two agree plus one "can't tell":** "Can't tell never counts". The pair has two counted votes, is not decided, is not contested, and is not in the queue (the queue's "can't tell" row needs three can't-tells, not one). It stays live until a third decisive device arrives, with no expiry.
- **One dissenter makes a pair contested.** "The first disagreement makes the pair contested" and it stays in the deck until five counted judgements. With a deck of a few hundred pairs and few players, one troll per pair can hold the pair open indefinitely and fill the team's contested list.
- Nothing says what happens to live pairs that never reach three answers. There is no age limit and no "retire if stuck".
- "Can't tell" copy: "A pair that three people can't tell apart is a pair the matcher shouldn't be expected to either" is an unfounded claim. The matcher sees the pair in a multi-image prompt, with both images side by side.

**Fix:** add a state table with every combination of 1 to 5 answers (including can't-tell and weight 0) and what each does. Add an age cap (for example 60 days, then retire or send to the team). Cap how many contested rows can reach the queue per day.

### 8. The test set is biased, and §7.1 handles the bias only halfway (§7.1, §4.1)
- **What pool 1 actually contains.** `rankedForRecord` stores the top 3 candidates at 0.1 or above (`sightings.ts`, around line 296). So 0.25 to 0.4 scores *are* stored (the spec is right that they are "remembered"), but only if the candidate was in the top 3. A hand pick that the matcher scored under 0.1, or ranked fourth or lower, has no stored score. Those are the clearest matcher misses (`miss_kind = 'matcher_miss'`), and the reveal has no copy for them ("under 10%" is not one of the three lines).
- **Selection on the thing being measured.** Pool 1 is chosen by the matcher's own score band (0.25 to 0.6). Accuracy measured on those pairs is accuracy *in that band*. It can calibrate the 0.4 cut-off, but it cannot give an overall figure. §7.1 says only that close calls would "make an accuracy figure look worse than the real-world mix". The agreement rule pushes the other way: the hardest pairs (contested, or "can't tell") are never decided, so they never become labels. Survivorship bias makes the figure look *better*. The spec should say both effects exist and that neither is quantified.
- **Pool 2 and pool 4 pairs have no matcher score at all.** They are not useful for measuring the matcher.
- **Labels are human judgements from photos, not ground truth.** A person comparing two photos of the same cat from different sides will say "Different" or "can't tell". The label measures the matcher against that human limit, not against the truth the charity knows.
- **The score depends on the other images in the prompt.** `matching.ts` sends the new photo and up to 10 candidates in one prompt, and the scores are relative within that prompt. A score of 58% is not a pairwise probability. The reveal "The matcher thought 58% likely the same" presents it as one.
- **No model version is stored.** `VISION_MODEL` is a constant in `visionModel.ts` and can change. The match record has no model field. A test set built from old scores is not comparable with the current model.
- **No target.** Nothing says how many decided pool 1 pairs SYC-56 needs before it can say anything about 0.4, or what "the game worked" means. At about 100 resolved sightings (SYC-194) the pool is likely only a few dozen pairs.

**Fix:** add a model-version field (or at least record the date range). State the sample size SYC-56 needs and what the report will say. Say plainly what the labels can and cannot measure. Add the "score under 10% or not stored" case to the reveal copy.

### 9. The 24-hour stale-deck window is not defensible as written (§9, §4.3, §11)
- The spec counts 24 hours on the phone. But the deck is built by a job "nightly, and after each team decision" (§4.3). A photo hidden an hour after the nightly job is still in `game_pairs` for up to a day, a phone that fetches just before expiry keeps it for another day, so the real window is up to about 48 hours. A hide is not a "team decision", so nothing refreshes the deck.
- Thumbnails are generated and carried in the deck itself (§11: "generated once per photo into the deck response"). That means copies of the bytes sit on the phone. The cat-alogue stores URLs. A SYC-246 privacy removal (`remove_photo`, "removes a hidden photo's bytes for good") reaches the server and the photo route immediately, but not those copies.
- "The server drops any queued answer for a retired pair on sync" does not make the photo disappear from the phone.
- A mitigating point the spec could cite: spine §6.5 already accepts that a stale catalogue "can outlive a deploy by weeks". But that is for cats' URL entries, not for copies of photos that were later taken down for privacy.

**Fix:** filter deck requests through `hiddenPhotoIds` at request time. Have the app check hidden/removed status on each launch with signal and delete matching items from the local deck. State the worst case honestly (up to X hours offline, never longer than the next time the phone has signal). Say what happens to a `remove_photo` case specifically.

### 10. Offline: the queue, the badges and "Delete my data" do not work as the spec says (§9, §10, §3.4)
- **The queue store is generic, but the sync driver is not.** `queueStore.ts` is generic over `QueueItem { localId }` (the SYC-42 cat-report queue already uses it), so storing judgements in it is reasonable. But `offlineQueue.ts` is sighting-specific: `PendingSighting`, a 30-day stale rule (`MAX_QUEUE_AGE_MS`), 3 server-failure attempts, and `classifySyncFailure`, which marks *any 4xx* as a permanent error. "The same retry rules as a queued spot" therefore means: if the server rejects a second answer with a 4xx, or a retired pair with 410/409, the item becomes a permanent error. The spec's "silently drop" only works if the server returns 2xx for these cases. A judgement item type, its own storage key and its own sync driver also need to be listed as work.
- **A game badge can never appear as "New badge unlocked!"** `newBadges` is computed in the resolve route as "badges after minus badges before" around one resolve (`sightings.ts:633` and `:845`). A badge earned between resolves (when a third player agrees) is already in `badgesBefore` at the next resolve, so the banner never shows. The spec's "arrive the same way ('New badge unlocked!')" (§3.4) is wrong. It needs its own notification path.
- **`ProfileStats` has no game field.** Adding `pairsDecided` means a new query in `getProfileStats` (`catHelpers.ts:539`), which runs on every resolve and profile read. The spec's "Profile payload gains one integer" understates this.
- **"Delete my data" (SYC-63) is handled in two incompatible ways.** §9 says the local deck is deleted. §10 says judgements are "linked to the device like a sighting is, so 'Delete my data' removes them". But spine and DECISIONS say sightings *survive, unlinked*. Deleting judgements would silently change decided pairs, labels, and other players' counts. `queueStore.wipe()` covers the queue only. The deck and the daily tally need their own wipe.
- **Samuel's decision 8 is narrowed without his approval.** §13 says so and offers the way back. It would help to make the narrowing an explicit approval item in §15.

**Fix:** list the new queue item type and sync driver; say the server returns 2xx for first-wins and retired pairs; add a notification path for game badges (or accept that there is none and say so); unlink rather than delete judgements on "Delete my data", and say what happens to the decided count; add the deck to the wipe list.

### 11. The dashboard queue and guardian actions are under-specified (§7.2, §12 item 3)
- SYC-43's queue pattern is welfare-specific (`teamPages/queuePage.ts` is built around `WelfareQueue` with reports and drafts). The nearer precedent is "Matched by hand", which Part 2i calls "a low-priority list… not the SYC-53 confirmation queue". §12 item 3 says "this adds a queue" but not which, or under which capability name.
- A team re-file route is named as existing ("the existing choose-a-different-cat path, as the team"). I found no route that moves a sighting to a different cat in `routes/team*.ts`, and the schema has none of the `teamAction` columns that data spine §10.9 describes. I could not confirm the path exists. Treat it as unverified, and list it in §12 as a dependency.
- Row 1 ("Players think Mikis and Ermis are one cat") is the headline benefit of stage 2. Without SYC-59 it is only a note. The spec says so, but it also writes one of SYC-59's triggers ("the third-spotter side-by-side question") into this spec, which `DECISIONS.md` Part 3 would hand to one owner. Decide who owns it.
- Pairs are stored with cat ids "at the time". After a merge, a pair of two now-identical cats is meaningless. §10 should say the deck job retires pairs whose cats resolve to one cat through `cat_identity` (spine §10.3 and §10.9 "Merges").
- A guardian who sees rows about her colony's cats sees photos of other colonies' cats too. State that she sees only what the public sees for those.

### 12. Rewards: no points, but the count can still be farmed (§3.4, §8)
There is no leaderboard or points route, which is right. But:
- **Weight 0 still earns count.** "A careless tapper earns a count that doesn't move (because their answers rarely land on the winning side)" is false for anyone who taps at random: half their answers land on the winning side. Weight 0 changes only their vote, not their credit. Say whether weight-0 answers earn credit.
- **A team override changes the count.** "A team answer… overrides any player decision." Do those who agreed with the earlier player decision lose credit? §13 argues a count that goes *down* is worse, yet this path does exactly that.
- **Easy pairs inflate it.** Pool 4 (one per round) is nearly always unanimous, so it decides quickly and counts.
- **The badge numbers look unreachable.** Pairs leave the deck once decided, the deck has "a few hundred live pairs", and each decided pair needs three players. 25 and 100 decided pairs for one player may be a large share of the whole supply. Check against the expected deck size.
- **Colluding devices.** Three devices (or three friends) that always answer the same way decide and credit each other. The daily cap of 20 rounds is per device, so it does not limit them. The one-line cost of this is a drained deck for honest players.
- **The daily cap does not match its reason.** Twenty rounds a day is 100 pairs per device per day. The stated reason is that "a grinder would exhaust it in an hour". With a few hundred pairs it takes two or three days.

### 13. No way to flag a photo from inside the game (§4.2, §3.2)
The game enlarges photos and shows them to people with no cat in sight. The ticket's privacy requirement is "only show photos that are visible to the public". If a photo shows a person, a house number or a feeding site, a player has no way to say so from the card. The app already has "Report an issue" (SYC-44, "something wrong with this photo") and a hide route. Without a flag on each card, the only protection is that the photo was already public.

**Fix:** add a small "Report this photo" link on each card that goes to the existing report flow, with the pair retired for that photo while the report is open.

---

## Minors

### 14. Several "exists today" claims are incomplete or unverifiable
See the table at the end. The ones that matter:
- §2.1 says the server compares "every cat whose first-spotted position is within 500 m". The code caps this at the 10 nearest (`MAX_CANDIDATES`, `candidateSelection.ts`). This matters for "compared but scored low" versus "never compared".
- §2.1 says a candidate between 0.1 and 0.4 "is remembered". True only for the top 3.
- §12 item 4 depends on `app_settings`, which exists only in the match-wait plan (C3: "No settings store exists"). Fair, but §10 and §8 rely on it for the daily cap and weights.
- §9 says the deck should not go in the cat-alogue cache because of "SYC-161's warning: a retired key empties offline catalogues". I could not find that warning in the code or the checked specs. Treat as unverified.
- The Status line says the review exists at `reviews/matching-game-review.md`; at the time of this review that file was not in the repo.

### 15. The reveal line needs plain words and honest meaning (§3.2)
"The matcher thought 58% likely the same" uses a word ("matcher") that a tourist has not met, and a number that is not a calibrated probability (finding 8). Suggested: "Our photo-matching tool wasn't sure either." and drop the percentage. Also, players who see scores in early rounds will anchor on them later; that biases the labels.

### 16. Pool 2 does not find lookalikes, and uses a stale position (§4.1)
It pairs cats within 500 m of each other with the same colour, "or both have no colour yet". Two cats with no colour yet are not lookalikes. Positions are frozen first-spotted points (spine §6.6; SYC-80), so a ferry-terminal discovery point makes harbour cats look like neighbours. Colour itself is machine-read (SYC-161) and often only *Reported*, not *Confirmed* (coat spec §4.2), so pool 4's "different resolved colours" can be wrong too.

### 17. The deck composition numbers do not agree (§3.3, §4.1, §8)
Weights 50/25/15/10 on five pairs are 2.5, 1.25, 0.75 and 0.5 pairs per round, but §4.1 also says pool 4 is "one per round" (20%) and pool 3 is "one in six" (about 0.8). "Every fourth round is a line-up" (§3.3) and "20 pairs, 5 line-ups" (§9) are not clearly the same thing; a "round" of line-ups is not defined. Pick one scheme.

### 18. Pair identity is undefined: photos or cats? (§4.1, §7.2, §10)
A label is for two *photos*, but the queue rows speak about *cats* ("Players think this sighting isn't Mikis"). "Different" on a sighting photo versus Mikis's main photo does not show the sighting isn't Mikis (angle, lighting, kitten against adult). Say that labels are per photo pair, and require several photo pairs (or the team's look) before a cat-level queue row.

### 19. The thumbnail plan does not fit the size or the existing code (§4.3, §11)
- "480 px, under 1 MB for the whole deck" is for 20 pairs and 5 line-ups, which is about 60 photos, or roughly 16 KB each. A 480 px JPEG is usually several times that, and cats are hard to tell apart at that quality.
- There is no thumbnail route today: `routes/photos.ts` has one `GET /photos/:id`. Resizing exists only in the 12-month replacement plan in `hosting-and-photo-storage.md`. Embedding thumbnails in the deck response bypasses `photoVisibility.ts`, whose header says it is "the only place a public photo address is built" and which has a test enforcing it.
- Web storage limits (localStorage is a few MB) are not discussed.

### 20. Placement text conflicts with the feeding-nudge spec (§3.1)
§3.1 puts the game line on the reward screen "below the feeding nudge and the matches". `feeding-nudge.md` §1 and the review of it put the nudge on the *first* result screen (the candidate list), above the "This cat needs help" link. The reward screen already carries the ear-tip and details questions and the badge banner. Say exactly which screen, and confirm the nudge is not on it.

### 21. Plain-English jargon in the spec body
Terms used before they are defined or never defined for a volunteer reader: "pair judgement", "pool", "decided", "contested", "weight 2", "care score", "close calls", "test set", "baseline", "deck". The user-facing copy is fine ("Cats you've helped tell apart", "Counted when three people agree"). The spec should define these once near the top, or §1 should use plainer words.

---

## Nits

### 22. Over-splitting "built" from "proposed" (canonical rule)
The spec describes the whole game as one vision, which is right. Three places lean the other way: the §10 heading "Proposed tables and fields", the §6.3 sentence "At launch there is no sign-in… everyone is weight 1", and "Where this spec needs a new table… §10 writes it as a proposal, not a change". "What has to exist first" (§12) is allowed as dependencies. Suggest: rename §10 to "Tables and fields", and move the launch-state remarks into §12.

### 23. Offline wording in the summary (§1, last paragraph)
"It works without signal" is broader than §9 ("playing and the reveal work; the decided count, badges and new decks need signal"). Per `CLAUDE.md`, be precise. Use the §9 wording in §1.

---

## Canonical facts check (`CLAUDE.md`)
- "Cat guardian" (never "colony carer"): **passes**. No "carer" in the file.
- "Spotter" (never "snapper"): **passes**.
- Sterilisation cost: not mentioned. Fine.
- Two audiences complementary: **passes** (§2.3, §5 both say so). One phrase in §5 ("let three tourists outvote her") reads adversarially; reword.
- Offline precise: **mostly passes** (§9 is precise; §1 is not, finding 23).
- Mapping not exclusive to BL families: not mentioned. Fine.
- Aspirational spec: **mostly passes**; see finding 22.

## Coverage of the SYC-402 ticket
| Ticket asks | Answered? |
|---|---|
| Format (pairs, line-up, odd-one-out, timed, daily) | Yes (D2, D5). Odd-one-out, timed and daily are rejected with reasons. |
| Useful data: close calls, hand picks, cats near each other | Yes (§4.1). Needs the fixes in findings 1, 2 and 8. |
| Trust, careless/joke answers, guardian weight | Answered, but see findings 4 to 7. |
| How answers are used; who reviews merges/splits | Yes (§7). See finding 11. |
| Privacy: no hidden photos, no feeding-site locations | Answered, but see findings 1, 2, 9 and 13. |
| Rewards: friendly, care over speed | Yes (§8). See finding 12. |
| Both audiences | Yes (§5). Guardian half depends on finding 4. |
| Where it lives | Yes (§3.1, D6). See finding 20. |
| Offline, precisely | Yes (§9). See findings 10 and 23. |
| Not asked, missing | A success measure and sample size (finding 8), a way to flag a photo (finding 13). |

## Table: "exists today" claims

| Claim (spec §) | Verdict | Where |
|---|---|---|
| Matcher sends the new photo and nearby cats' main photos to a vision model, 0 to 1 per cat (§2.1) | True | `matching.ts:20-70` |
| Candidates under 0.1 dropped, top 3 at 0.4 or above suggested (§2.1) | True | `sightings.ts` `CONFIDENCE_THRESHOLD` and the `ranked` / `shown` filters |
| Every cat within 500 m is compared (§2.1) | Incomplete: capped at the 10 nearest | `candidateSelection.ts` `MAX_CANDIDATES` |
| 0.1 to 0.4 candidates are remembered (§2.1) | True only if in the top 3 | `rankedForRecord` in `sightings.ts` |
| Match record has `suggested[].score`, `choice`, `miss_kind` (§4.1) | True | `sightingMatches.ts` |
| Matcher compares the public display photo (implied §4.2) | False: reads `primaryPhotoId` raw | `sightings.ts` candidateInputs loop; SYC-303 |
| `catDisplayPhotos` and `hiddenPhotoIds` exist (§4.2) | True | `photoVisibility.ts:51, 84` |
| `catDisplayPhotos` covers sighting photos (§4.2) | False | `photoVisibility.ts:84-94` |
| Badges computed on read, never stored (§9) | True | `badges.ts`, `SPEC.md` §5.6 |
| Game badges arrive as "New badge unlocked!" (§3.4) | False | `sightings.ts:633, 845` |
| Offline queue store is reusable (§9) | Store: yes (generic). Sync rules: sighting-specific | `queueStore.ts`, `offlineQueue.ts` |
| Offline cat-alogue cache and its retired-key warning (§9) | Cache exists; warning not found | `catalogue.ts` |
| `app_settings` (§10, §12) | Not in code; planned | match-wait plan C3 |
| SYC-43 queue pattern (§7.2) | Welfare-only | `teamPages/queuePage.ts` |
| `confirm`-class guardian capability (§7.2) | Does not exist | `roles-and-invites.md` §6.2 |
| Team re-file path (§7.2) | Not found in `routes/team*.ts` | unverified |
| App sign-in for guardians "once SYC-53 lands" (§6.3) | Contradicts the architecture | spine §6.5, roles §2.2 note 3 |

---

## Verdict: **Needs rework**

The structure, rewards, staging and placement can stay. Before approval the spec needs:
- a corrected source rule for sighting photos and the photo that was actually compared (1);
- a revised reveal and deck design that do not expose withheld candidates or position constraints (2);
- a line-up storage model that does not manufacture "Different" labels (3);
- a single, tested decision rule and an honest answer on guardian identity (4).

The majors (5 to 13) are mostly clarifications and limits that fit in a second draft. A second pass should check the fixed rule table in finding 7 and the privacy wording in finding 2.

**In plain English, for Samuel:** The game is a good idea and your eight decisions are mostly fine. It answers every question in the ticket. But as written it would show some photos the public cannot see, tell players which cats live near each other, turn a "best of three" tap into labels that can be wrong, and rely on a "guardian counts double" rule the app has no way to apply. A person with three phones could also decide pairs on their own. None of that is hard to fix on paper. Fix the four blockers, tidy the majors, and set a target for how many labels you need, and it is ready for a second look.
