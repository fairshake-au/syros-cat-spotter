# Adding details to a cat later, from the cat's page

**Status:** Draft for Samuel's approval, 4 October 2026. Adversarial review done and folded in (§11; full review in [`reviews/add-details-later-review.md`](./reviews/add-details-later-review.md)).
**Owner:** Samuel
**Covers:** SYC-117 part 2, from the 29 September user-testing call (SYC-116): *"anyone must be able to answer [the details questions] later from the cat's page, not only in the moment."*
**Builds on:** data spine PR 7, the questions on the reward screen (SYC-37, SYC-74; draft PR #72, waiting for SYC-79's photos). This spec changes two of PR 7's approved rules, on purpose, and says so in §5.
**Related:** [`cat-record-data-spine.md`](./cat-record-data-spine.md) §3.4 (evidence of life), §4.1–4.5 (the ear-tip rules), §7 (the note and food and water), §8 (deletion), §10.1 (observations) · [`DECISIONS.md`](./DECISIONS.md) Part 2c, Part 3 · `docs/superpowers/plans/data-spine.md` PR 7 and decisions Q2, Q3 · [`choose-a-different-cat.md`](./choose-a-different-cat.md) §4.7 (coat colour) · SYC-2 (coat and markings), SYC-43 (staff dashboard), SYC-79 (ear-tip photos)

**What this document owns.** What a spotter can add to a cat after the moment has passed, where they do it, and for how long. It does **not** own the observation model, the ear-tip rules or deletion: those stay with `cat-record-data-spine.md`, and this spec only points at them (`DECISIONS.md` Part 3).

---

## 1. The short version

After spotting a cat, a spotter can come back to that cat's page and **finish telling us about it**: whether its ear tip is clipped, and anything they noticed. A small card on the cat's page says *"You spotted Agatha on 3 October. Anything to add?"* and opens the same questions as the reward screen, showing only the ones they haven't answered yet.

What they add is **tied to their own sighting**: to the photo they took and the moment they took it. That one choice keeps every rule in the data spine working. A "clipped" answer still has a photo behind it, and an answer typed at home a week later still counts as "seen on 3 October", not "seen today".

Three things change from PR 7, and each one is a decision for Samuel (§4):

- **Who:** the people who spotted the cat, not literally anyone (Decision 1).
- **How long:** 30 days after the sighting, not 24 hours (Decision 2).
- **How often:** still once per question per sighting, and still once per cat for the ear tip. You can add what you skipped, but you can't change what you said (Decision 3).

---

## 2. The problem

On 29 September Jacky said the app seemed to offer adding information once, with no way back to add it later. Part of that was the "New spot" screen promising details it never asked for. PR 7 fixes that: the screen now says the questions come after matching, and they do.

But the underlying need is real and PR 7 doesn't meet it. The questions appear once, on the reward screen, straight after the points. That's the right moment for most people, and it's where PR 7 puts them, because nothing should stand between a spotter and their points (`cat-record-data-spine.md` §7). But people:

- **skip in the moment** because the cat is walking off, the sun is on the screen, or they're with friends;
- **notice later** when they look at their photo properly, zoom in on the ear, or remember the cat was limping;
- **lose signal** on the reward screen. PR 7 doesn't queue answers offline, so if sending fails they're gone.

Each of these is an answer we could have had and didn't get. Syros Cats can't get it back later either: the spotter has walked away (SYC-74's own words).

### 2.1 Two audiences, needs that fit together

| | Tourists | Cat guardians and residents |
|---|---|---|
| **When they'd add details** | That evening, at the hotel, looking back at the day's photos | The next time they open a cat they see every week |
| **What they'd add** | "The ear looked clipped in my photo", "she was limping" | Notes the team should know: "new cat in the colony", "hasn't been at the bowl for two days" |
| **What would go wrong without this** | The answer is lost | They tell Syros Cats on WhatsApp instead, and it never reaches the cat's record |

---

## 3. What a spotter sees

**On a cat's page**, below the photo and the status lines, a spotter who has an open sighting of this cat sees one card:

> **You spotted Agatha on 3 October.** Anything to add?
> *[Tell us more]*

If they've spotted her more than once in the last 30 days, the card lists each sighting, newest first, with its small photo and date. Sightings with nothing left to answer don't appear. If nothing is left at all, the card isn't shown. Most visitors to a cat's page never see it, because most visitors haven't spotted that cat.

**Tapping "Tell us more"** opens the same questions as the reward screen (PR 7's `SightingQuestions`), with the spotter's own photo at the top so they're answering about the right moment. It shows **only what they haven't answered yet**:

- the ear-tip question, with the example photo, unless they've already answered it for this cat (from any sighting);
- "Anything you noticed?", unless they've already left a note on this sighting;
- "Do they have food and water?" only if Samuel chooses Decision 4's option B.

Sending works exactly as on the reward screen, and needs signal. If it fails, they can try again, or close it and come back later: the card is still there until the window closes.

**What they never see:** anyone else's answers or notes, or a way to change an answer they already gave (Decision 3).

**No points.** Adding details earns nothing, just as answering on the reward screen earns nothing. The points are for the sighting. Paying for details would invite people to tap answers for points.

**Offline.** The cat's page opens without signal from the phone's saved copy of the catalogue, but the card needs signal to know what's still open, so it doesn't show offline. Answers aren't queued.

---

## 4. Decisions for Samuel

### Decision 1 · Who can add details later, and what do they attach to?

The ticket says "anyone". Taken literally, that means a box on every cat's page that any visitor can fill in.

| | **A. The people who spotted the cat, attached to their own sighting (recommended)** | **B. Anyone, attached to nothing** | **C. A, plus a note-only box for anyone who has ever spotted the cat** |
|---|---|---|---|
| **What the person sees** | The card appears only on cats they've spotted in the last 30 days | A "Tell us something about this cat" box on every cat's page, for everyone | A's card, plus a note box on any cat they've ever spotted |
| **Ear tip** | Counts as usual: it has the spotter's own photo behind it | **Can't count.** A clipped tip only reaches *Likely* with a photo (§4.2's rule). It would be stored and do nothing | As A |
| **"Is this cat alive?"** | Dated to the sighting, so it says "seen on 3 October", which is true | **Dated today, by someone who may be on their sofa.** An ear-tip answer counts as evidence the cat was alive (§3.4), so a cat unseen for three years would quietly stop being "Not seen since…" because someone answered from memory | As A. Notes don't count as evidence of life |
| **Abuse** | Limited to people who really photographed this cat | Anyone can write about any cat, including ones they've never seen. Notes are private, so nothing hostile is published, but the team's notes list fills with noise | Small: notes only, and only from past spotters |
| **Building it** | Reuses PR 7's answers endpoint, with a wider window | A second way to write each answer, with its own rules for dates, photos and abuse | A, plus a second, simpler path for notes |

**Recommendation: A.** It's what "add details later" means for nearly everyone who'd use it, and it keeps the data honest without any new rules. B would look generous but store answers that can't count, and could revive a missing cat by accident. C is a reasonable later step if cat guardians ask for it. It's filed as an idea in §9, not built now.

### Decision 2 · How long after a sighting can details be added?

PR 7 accepts answers for 24 hours after the match. That was set for the reward screen, where answers arrive within seconds. It's the rule this feature pushes against hardest.

| | **A. Keep 24 hours** | **B. 30 days (recommended)** | **C. No limit** |
|---|---|---|---|
| **What the person sees** | The card disappears the next day | The card stays for a month after each sighting | The card stays for ever, for every cat they've ever spotted |
| **Benefits** | No change to PR 7 | Covers "back at the hotel tonight", "looked at my photos at the weekend" and "home from holiday". 30 days is already the app's limit for how old a sighting's date can be (`captureTime.ts`), so it matches a rule people have already met | Nothing is ever lost |
| **Risks** | Barely helps: most of the value is in the evening and the days after | A month-old memory of an ear can be wrong. The photo is still there to look at, which helps | Year-old answers from memory. A permanent card on every cat page they've visited. Their answers keep arriving long after they could check the photo |

**Recommendation: B, 30 days.** It turns "lost" into "later" for nearly every case, and it's the same limit the app already uses for dates. The answer is still about the original moment, so it's dated to the photo, not to the day it was typed.

### Decision 3 · Can a spotter change an answer, or answer the ear tip again?

PR 7 asks the ear-tip question **once per spotter per cat**, whatever they answered (Q3 → B, Samuel, 2 October), and accepts **one set of answers per sighting**. A cat's page is exactly where someone would want to say "actually, looking at my photo again, it is clipped".

| | **A. Add what you skipped; never change what you said (recommended)** | **B. Also let a spotter replace their own ear-tip answer** | **C. Ask again after 30 days** |
|---|---|---|---|
| **What the person sees** | Only the questions they haven't answered. A skipped ear tip can be answered later; an answered one is gone from the card | Their previous answer, with "Change my answer" | The ear question comes back a month after they last answered it |
| **Benefits** | Keeps Q3 → B exactly. Nothing is overwritten. Simple to explain: "tell us anything you didn't get to" | Fixes a mis-tap or a second look | More independent looks at each ear |
| **Risks** | Someone who tapped the wrong answer can't fix it themselves. Syros Cats can, with the correction tools (data spine PR 8) | A new kind of public correction: today only the team can mark an answer wrong. Someone could flip a cat between answers. More to build and test | Re-opens a decision Samuel made on 2 October, and it's the nagging Q3 → B was chosen to avoid |

**What this changes in PR 7.** "One set of answers per sighting" becomes **"each question once per sighting"**, so a spotter who answered food and water on the reward screen can add the ear tip or a note later. The ear tip stays once per cat.

**Recommendation: A.** It meets Jacky's need (add what you couldn't at the time) without weakening the rule Samuel chose. If testers ask to fix their own answers, B can follow as its own small change.

### Decision 4 · Should "Do they have food and water?" be offered later too?

This question is about **the place and the moment**: "a bowl that was empty at nine is full at ten" (`cat-record-data-spine.md` §7.2). Syros Cats will read it as "where the feeding network reaches" and look for "cats where the last three answers were no".

| | **A. Only in the moment: 24 hours, as now (recommended)** | **B. Within 30 days, like the rest** |
|---|---|---|
| **What the person sees** | Food and water is on the reward screen, and on the cat's page only on the day of the sighting | Food and water is on the cat's page card for a month |
| **Benefits** | Answers stay fresh, which is what makes them useful | One rule for everything; simpler to explain |
| **Risks** | One more rule (the card's questions differ by age) | A remembered "no" from three weeks ago could put a well-fed colony on the "last three answers were no" list |

**Recommendation: A.** The ear tip doesn't change from week to week. A bowl does.

### Decision 5 · Where the card goes

A smaller choice, with a clear default: the card sits **on the cat's page, under the status lines**. A second entry point, a "Finish telling us about your recent spots" list on the Profile tab, could come later if people don't find the card. It isn't needed to meet the ticket, and one place is easier to explain. **Recommendation: the cat's page only, for now.**

---

## 5. The two PR 7 rules this changes, said plainly

| PR 7 rule (approved) | This spec, if Decisions 2 and 3 go as recommended | Why it's safe |
|---|---|---|
| Answers are accepted **within 24 hours** of the match | **30 days** for the ear tip and the note; food and water stays at 24 hours | Every answer is still dated to the photo, not to the day it's typed, so a late answer can't make a cat look recently seen. Public answers can't be dated more than 30 days back anyway (§10.1) |
| **One set of answers per sighting** | **Each question once per sighting**; ear tip still **once per cat** (Q3 → B unchanged) | Nothing is ever overwritten; observations stay append-only. A spotter can only fill gaps they left |

Nothing else in PR 7 changes. The questions, wording, example photo, privacy of the note, and the "Probably sterilised stays hidden until Syros Cats can correct it" rule (Q2 → A) all carry over as they are.

---

## 6. How it's built (for the builder)

No migration. Everything below rides on PR 7.

- **`POST /sightings/{id}/answers`** (PR 7) changes in two ways. Its window becomes per question: `ear_tip` and `note` for 30 days after the match, and `food_and_water` for 24 hours. The window is still timed from the match record's `chosen_at`, then the resolve's `cat_updates` row, then the capture time, exactly as PR 7 does. And "already answered" becomes per question: a second `note` for the same sighting is refused, but a `note` after an earlier `food_and_water` is accepted. The ear tip stays once per device per cat. A request with a mix of open and already-answered questions records the open ones and reports which it recorded (PR 7 already does this for the ear tip).
- **New `GET /cats/{catId}/my-open-sightings`**, device-authenticated (`X-Device-Secret`, the same check resolve uses). It returns this device's resolved sightings of this cat from the last 30 days that still have an open question. Each one has its id, capture date, its photo's opaque URL, and which questions are still open. It answers only about the caller's own sightings, so it reveals nothing about anyone else. Its payload carries no coordinates.
- **The app.** A `MoreToAdd` card on `app/cat/[id].tsx`, fed by that endpoint, shown only with signal and only when it has something. The sheet reuses `SightingQuestions` with a new `questions` prop (which to show) and the sighting's own photo, and sends through the same `answersRequest`.
- **Every answer is still written by `writeObservation`** with the sighting's `photoId`, `observedAt` = the sighting's capture time, role `public`, provenance `volunteered`. So: a clipped answer reaches *Likely* only with its photo, as always; the answer adds no new evidence of life beyond the sighting it belongs to (the sighting itself already counts); and deleting a person (SYC-63) severs these rows like any other device-authored observation.
- **Rate limits.** The card's endpoint is cheap and device-scoped; it sits behind the same device check as resolve. Answers are bounded by the number of the device's own sightings, which are already rate-limited at upload.

---

## 7. Tests that must exist

1. A spotter can add the ear tip or a note to their own sighting 10 days later. The answer's `observedAt` is the photo's capture time, not the day it was sent.
2. **A late answer never makes a cat look more recently seen.** An ear-tip answer sent today on a 20-day-old sighting leaves the cat's "last evidence of life" at that sighting's date, not today.
3. Answers after 30 days are refused. Food and water after 24 hours is refused (Decision 4 A).
4. Each question once per sighting: food and water on the reward screen, then a note later, both land; a second note is refused.
5. The ear tip stays once per device per cat across sightings, the reward screen and the cat's page (Q3 → B), including two sends at once.
6. `my-open-sightings` returns only the caller's own sightings, refuses a wrong secret, never includes coordinates, another person's sighting, or any answer text, and is empty when nothing is open.
7. A clipped answer added later reaches *Likely* in the record only because its sighting has a photo. The public line still says *Not known yet* while Q2's gate is closed.
8. A note added later never appears in any public payload (the §10.8.8 list, as in PR 7).
9. The card shows only the open questions, hides itself when there are none, and doesn't show offline (app tests), at ~390 px and desktop, in all three languages.

---

## 8. What this doesn't cover

- **Coat colour and markings.** Later, these will be new kinds of detail on the same card. Coat colour is already planned: the matching model reads it from the main photo and stores it as a `system:vision` observation (SYC-119 Slice C, `choose-a-different-cat.md` §4.7). A person correcting or adding it would be a later kind of answer here. Markings (SYC-2) aren't specified yet. Neither is built by this spec.
- **Sex, age and health.** Not asked anywhere today. Health worries already have their own route: the "This cat needs help" report (SYC-42).
- **Owners and cat guardians adding authoritative facts** ("she was spayed in 2023"). That's a different authority, not a spotter's observation, and it belongs with roles (SYC-53) and the team's correction tools.
- **Showing notes, answers and food and water to the team.** That's the staff dashboard (SYC-43).

---

## 9. Ideas parked, not proposed

- **A note-only box for anyone who has ever spotted the cat** (Decision 1, option C). Useful for cat guardians once they're regulars. Worth revisiting if guardians ask.
- **A Profile-tab list of recent spots with open questions** (Decision 5).
- **Changing your own answer** (Decision 3, option B).

---

## 10. Rollout

Code only; no migration. It ships after PR 7 (it extends PR 7's endpoint and component), so it also waits for SYC-79's photos. Rollback is a revert. Answers already stored stay valid observations.

---

## 11. Review

An independent adversarial review (Sonnet, its own worktree) checked this spec against the data spine, PR 7's code and DECISIONS.md, on 4 October 2026. Findings and how each was folded in are in [`reviews/add-details-later-review.md`](./reviews/add-details-later-review.md).
