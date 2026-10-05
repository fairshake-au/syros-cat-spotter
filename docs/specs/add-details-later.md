# Adding details to a cat later, from the cat's page

**Status:** **Approved by Samuel, 5 October 2026** (`DECISIONS.md` Part 2k): Decisions 1, 2 and 5 as recommended; **Decisions 3 and 4 as option B**, which this version builds in. An independent adversarial review found one serious problem (a late answer could have made a cat look recently seen). It is fixed here and in PR 7. All findings are folded in (§11; full review in [`reviews/add-details-later-review.md`](./reviews/add-details-later-review.md)). The parts written after the approval (spotters changing their own ear-tip answer, §3.1 and §6) had their own review pass (§11).
**Owner:** Samuel
**Covers:** SYC-117 part 2, from the 29 September user-testing call (SYC-116): *"anyone must be able to answer [the details questions] later from the cat's page, not only in the moment."*
**Builds on:** data spine PR 7, the questions on the reward screen (SYC-37, SYC-74; draft PR #72, waiting for SYC-79's photos). This spec changes two of PR 7's approved rules, on purpose, and says so in §5.
**Related:** [`cat-record-data-spine.md`](./cat-record-data-spine.md) §3.4 (evidence of life), §4.1–4.5 (the ear-tip rules), §7 (the note and food and water), §8 (deletion), §10.1 (observations) · [`DECISIONS.md`](./DECISIONS.md) Part 2c, Part 3 · `docs/superpowers/plans/data-spine.md` PR 7 and decisions Q2, Q3 · [`choose-a-different-cat.md`](./choose-a-different-cat.md) §4.7 (coat colour) · SYC-2 (coat and markings), SYC-43 (staff dashboard), SYC-79 (ear-tip photos)

**What this document owns.** What a spotter can add to a cat after the moment has passed, where they do it, and for how long. It does **not** own the observation model, the ear-tip rules or deletion: those stay with `cat-record-data-spine.md`, and this spec only points at them (`DECISIONS.md` Part 3).

---

## 1. The short version

After spotting a cat, a spotter can come back to that cat's page and **finish telling us about it**: whether its ear tip is clipped, and anything they noticed. A small card on the cat's page says *"You spotted Agatha on 3 October. Anything to add?"* and opens the same questions as the reward screen, showing only the ones they haven't answered yet.

What they add is **tied to their own sighting**: to the photo they took and the moment they took it. That one choice keeps every rule in the data spine working. A "clipped" answer still has a photo behind it, and an answer typed at home a week later still counts as "seen on 3 October", not "seen today".

Four things change from PR 7, each decided by Samuel on 5 October (§4):

- **Who:** the people who spotted the cat, not literally anyone (Decision 1).
- **How long:** for a month after the photo was taken, not 24 hours. This covers all three questions, food and water included (Decisions 2 and 4).
- **How often:** each question once per sighting. The reward screen still asks about a cat's ear only once per spotter.
- **Changing your mind:** on the cat's page, a spotter can **change their own ear-tip answer**, as long as Syros Cats haven't already checked it (Decision 3, §3.1).

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

If they've spotted her more than once in the last month, the card lists each sighting, newest first, with its small photo and date. Sightings with nothing left to answer don't appear. If nothing is left at all, the card isn't shown. Most visitors to a cat's page never see it, because most visitors haven't spotted that cat.

**Tapping "Tell us more"** opens the same questions as the reward screen (PR 7's `SightingQuestions`), with the spotter's own photo at the top so they're answering about the right moment. It shows **only what they haven't answered yet** for that sighting:

- the ear-tip question, with the example photo, unless they've already answered it for this cat (from any sighting). If they have, they see their answer instead, with a way to change it (§3.1);
- "Do they have food and water?", unless they've already answered it for this sighting;
- "Anything you noticed?", unless they've already left a note on this sighting.

A sighting whose ear-tip answer can still be changed counts as open, so its card stays for the month.

Sending works exactly as on the reward screen, and needs signal. If it fails, they can try again, or close it and come back later: the card is still there until the window closes.

**What they never see:** anyone else's answers or notes.

### 3.1 Changing an ear-tip answer

Someone who tapped "No, looks whole" on the beach, then zoomed into their photo at the hotel and saw the clip, can put it right. On the cat's page the ear-tip question shows their answer:

> **You said: No, looks whole.** *[Change my answer]*

Changing it records their new answer and marks the old one as replaced. The old one stays in the cat's history, so the team can see that the spotter changed their mind and when. Four rules keep this honest:

1. **Only your own answer.** A spotter can only replace an ear-tip answer they gave themselves, about this cat. Nobody can replace anyone else's.
2. **Only with a recent photo of the cat.** The change is made from one of their sightings of this cat from the last month. The new answer is tied to that sighting's photo and date, like any other answer. If they haven't photographed the cat in the last month, there's no card, so there's nothing to change from. (A "clipped" answer always needs a photo behind it.)
3. **Never once Syros Cats have checked it.** "Checked" means either of two things: the team has corrected one of this spotter's ear-tip answers for this cat (for example "that's not a clip, it's a torn ear"), or the team, a vet or Syros Cats' records have said whether this cat is sterilised. Either way the answer shows *"Syros Cats have checked this one"* and can't be changed. Otherwise a spotter could quietly undo the team's correction and put the cat back to "Probably sterilised". (When the team or a vet has spoken about sterilisation, their word decides the cat's public line anyway; blocking the change just keeps the card honest.)
4. **The reward screen still asks only once.** Changing is something a spotter chooses to do on the cat's page. The app never asks about the same cat's ear again after a sighting (Samuel's 2 October rule stands).

Every change is kept, so if someone flips a cat back and forth, the team sees it all in the history. "Probably sterilised" stays hidden from the public until the team can correct it (Q2), so a flip can't mislead anyone outside the team in the meantime.

**No points.** Adding details earns nothing, just as answering on the reward screen earns nothing. The points are for the sighting. Paying for details would invite people to tap answers for points.

**Offline.** The cat's page opens without signal from the phone's saved copy of the catalogue, but the card needs signal to know what's still open, so it doesn't show offline. Answers aren't queued.

---

## 4. Decisions (all made by Samuel, 5 October 2026)

The options are kept as they were put to Samuel, with his decision under each.

### Decision 1 · Who can add details later, and what do they attach to?

The ticket says "anyone". Taken literally, that means a box on every cat's page that any visitor can fill in.

| | **A. The people who spotted the cat, attached to their own sighting (recommended)** | **B. Anyone, attached to nothing** | **C. A, plus a note-only box for anyone who has ever spotted the cat** |
|---|---|---|---|
| **What the person sees** | The card appears only on cats they've photographed in the last month | A "Tell us something about this cat" box on every cat's page, for everyone | A's card, plus a note box on any cat they've ever spotted |
| **Ear tip** | Counts as usual: it has the spotter's own photo behind it | **Can't count.** A clipped tip only reaches *Likely* with a photo (§4.2's rule). It would be stored and do nothing | As A |
| **"Is this cat alive?"** | Dated to the sighting, so it says "seen on 3 October", which is true | **Dated today, by someone who may be on their sofa.** An ear-tip answer counts as evidence the cat was alive (§3.4), so a cat unseen for three years would quietly stop being "Not seen since…" because someone answered from memory | As A. Notes don't count as evidence of life |
| **Abuse** | Limited to people who really photographed this cat | Anyone can write about any cat, including ones they've never seen. Notes are private, so nothing hostile is published, but the team's notes list fills with noise | Small: notes only, and only from past spotters |
| **Building it** | Reuses PR 7's answers endpoint, with a wider window | A second way to write each answer, with its own rules for dates, photos and abuse | A, plus a second, simpler path for notes |

**Recommendation: A** *(approved, 5 October 2026)*. It's what "add details later" means for nearly everyone who'd use it, and it keeps the data honest without any new rules. B would look generous but store answers that can't count, and could revive a missing cat by accident. C is a reasonable later step if cat guardians ask for it. It's filed as an idea in §9, not built now.

### Decision 2 · How long after a sighting can details be added?

PR 7 accepts answers for 24 hours after the match. That was set for the reward screen, where answers arrive within seconds. It's the rule this feature pushes against hardest.

| | **A. Keep 24 hours** | **B. 30 days after the photo was taken (recommended)** | **C. 30 days after the match** | **D. No limit** |
|---|---|---|---|---|
| **What the person sees** | The card disappears the next day | The card stays until a month after they took the photo | The card stays for a month after the app matched the cat | The card stays for ever, for every cat they've ever spotted |
| **Benefits** | No change to PR 7 | Covers "back at the hotel tonight", "looked at my photos at the weekend" and "home from holiday". 30 days is already the app's limit for how old a sighting's date can be, so it matches a rule people have already met. And the answer's date never needs adjusting (see below) | Everyone gets a full month, even for a photo that synced late | Nothing is ever lost |
| **Risks** | Barely helps: most of the value is in the evening and the days after | A photo that waited in the phone's queue for weeks before it synced gets less time: one taken 25 days ago and synced today leaves 5 days. Rare, because most photos sync within the day | **Answers could end up wrongly dated.** The app won't accept a public date more than 30 days old; it quietly moves it to "30 days ago". A late-synced photo answered weeks later would have its answer re-dated weeks newer than the real sighting (found in review, §11) | Year-old answers from memory. A permanent card on every cat page they've visited |

**Recommendation: B, a month from the photo** *(approved, 5 October 2026)*. It turns "lost" into "later" for nearly every case. It's the same limit the app already uses for dates, so every answer can keep the true date of the photo, and that is what stops a late answer from making a cat look more recently seen. (PR 7 also now counts an answer only through its sighting when working out when a cat was last seen alive, so even a wrongly dated answer couldn't move that. Belt and braces.)

### Decision 3 · Can a spotter change an answer, or answer the ear tip again?

PR 7 asks the ear-tip question **once per spotter per cat**, whatever they answered (Q3 → B, Samuel, 2 October), and accepts **one set of answers per sighting**. A cat's page is exactly where someone would want to say "actually, looking at my photo again, it is clipped".

| | **A. Add what you skipped; never change what you said (recommended)** | **B. Also let a spotter replace their own ear-tip answer** | **C. Ask again after 30 days** |
|---|---|---|---|
| **What the person sees** | Only the questions they haven't answered. A skipped ear tip can be answered later; an answered one is gone from the card | Their previous answer, with "Change my answer" | The ear question comes back a month after they last answered it |
| **Benefits** | Keeps Q3 → B exactly. Nothing is overwritten. Simple to explain: "tell us anything you didn't get to" | Fixes a mis-tap or a second look | More independent looks at each ear |
| **Risks** | Someone who tapped the wrong answer can't fix it themselves. Syros Cats can, with the correction tools (data spine PR 8) | A new kind of public correction: today only the team can mark an answer wrong. Someone could flip a cat between answers. More to build and test | Re-opens a decision Samuel made on 2 October, and it's the nagging Q3 → B was chosen to avoid |

**What this changes in PR 7.** "One set of answers per sighting" becomes **"each question once per sighting"**, so a spotter who answered food and water on the reward screen can add the ear tip or a note later. The ear tip stays once per cat.

**Recommendation: A.** It meets Jacky's need (add what you couldn't at the time) without weakening the rule Samuel chose. If testers ask to fix their own answers, B can follow as its own small change.

**Decided by Samuel, 5 October 2026: B.** Spotters can replace their own ear-tip answer, from the cat's page. §3.1 sets out the rules, including the one the risks above call for: never once Syros Cats have checked it.

### Decision 4 · Should "Do they have food and water?" be offered later too?

This question is about **the place and the moment**: "a bowl that was empty at nine is full at ten" (`cat-record-data-spine.md` §7.2). Syros Cats will read it as "where the feeding network reaches" and look for "cats where the last three answers were no".

| | **A. Only in the moment: 24 hours, as now (recommended)** | **B. Within 30 days, like the rest** |
|---|---|---|
| **What the person sees** | Food and water is on the reward screen, and on the cat's page only on the day of the sighting | Food and water is on the cat's page card for a month |
| **Benefits** | Answers stay fresh, which is what makes them useful | One rule for everything; simpler to explain |
| **Risks** | One more rule (the card's questions differ by age) | A remembered "no" from three weeks ago could put a well-fed colony on the "last three answers were no" list |

**Recommendation: A.** The ear tip doesn't change from week to week. A bowl does.

**Decided by Samuel, 5 October 2026: B.** Food and water is offered for the month, like the other questions. One thing softens the risk above: every answer carries the date the photo was taken, not the day it was typed. **This only helps if the team's view uses that date.** So this spec needs the staff dashboard (SYC-43, which owns that view) to order food-and-water answers, and work out "the last three answers", by the date the photo was taken, never by when the answer arrived, and to show each answer's date, so a three-week-old "no" reads as three weeks old.

### Decision 5 · Where the card goes

A smaller choice, with a clear default: the card sits **on the cat's page, under the status lines**. A second entry point, a "Finish telling us about your recent spots" list on the Profile tab, could come later if people don't find the card. It isn't needed to meet the ticket, and one place is easier to explain. **Recommendation: the cat's page only, for now.** *(Approved as recommended, 5 October 2026.)*

---

## 5. The PR 7 rules this changes, said plainly

| PR 7 rule (approved) | This spec (approved 5 October) | Why it's safe |
|---|---|---|
| Answers are accepted **within 24 hours** of the match | All three questions: **until 30 days after the photo was taken** | Every answer keeps the true date of the photo, never the day it's typed, and a month from the photo is inside the app's 30-day limit on public dates, so no date is ever moved. And an answer only counts through its sighting when working out when the cat was last seen alive (PR 7), so a late answer can't make a cat look recently seen |
| **One set of answers per sighting** | **Each question once per sighting** | Nothing is ever overwritten; observations stay append-only. A spotter can only fill gaps they left |
| The ear tip is asked **once per spotter per cat** (Q3 → B), and a second answer is dropped | The **reward screen** still never asks again. On the **cat's page**, a spotter may deliberately **change** their own answer (§3.1) | The old answer is kept and marked replaced, never deleted. Only the spotter's own answer, only with a photo from the last month, and never once Syros Cats have checked it |

Nothing else in PR 7 changes. The questions, wording, example photo, privacy of the note, and the "Probably sterilised stays hidden until Syros Cats can correct it" rule (Q2 → A) all carry over as they are.

---

## 6. How it's built (for the builder)

No migration. Everything below rides on PR 7.

- **`POST /sightings/{id}/answers`** (PR 7) changes in three ways.
  - **The window.** All three kinds are accepted until **30 days after the sighting's capture time** (`sightings.created_at`), replacing PR 7's 24 hours after the match. Measuring from the capture time keeps every answer's `observedAt` inside `writeObservation`'s 30-day public limit, so the date is never clamped.
  - **"Already answered" becomes per question.** A second `note` or `food_and_water` for the same sighting is refused, but a `note` after an earlier `food_and_water` is accepted. A request mixing open and already-answered questions records the open ones and reports which it recorded (PR 7 already does this for the ear tip).
  - **Changing an ear-tip answer.** The request may carry `changeEarTip: true` with its `earTip`. Inside PR 7's existing lock (device and cat), the server finds this device's ear-tip answers for this cat. With none, it's an ordinary first answer. It refuses with `EAR_TIP_CHECKED` if **either** any of them has been superseded by a row the device didn't write (a team correction), **or** the cat has any `sterilised` observation from staff, admin, a vet or an import (any date). Otherwise it takes the device's current answer (the one nothing points at), **locks that row with `SELECT … FOR UPDATE` and re-checks, under the lock, that nothing points at it yet**, exactly as the team's `POST /team/observations/{id}/supersede` does. If the team got there first, it refuses with `EAR_TIP_CHECKED`. Then it writes the new answer through `writeObservation` on this sighting (its photo, its capture time), with `supersedesId` = that row and `supersedeReason: "changed by the spotter"`. (Review of the approved spec, 5 October: PR 7's lock is per device and cat and never meets the team's row lock, so without locking the row itself, a change and a team correction sent at the same moment could both point at the same answer, and the spotter's could win.) The same answer again writes nothing. A change is allowed on the same sighting that gave the original answer: "each question once per sighting" doesn't apply to a change. Without `changeEarTip`, a second ear-tip answer is dropped as PR 7 does now, so the reward screen can never change an answer by accident.
  - **The ownership check is the safety rule.** The resolver treats any row that points at an older one as replacing it, whoever wrote it (`resolve.ts`). So the server must only ever let a device's new answer point at that same device's own answer, never at anyone else's. A test proves it.
- **New `GET /cats/{catId}/my-open-sightings`**, device-authenticated (`X-Device-Secret`, the same check resolve uses). It returns this device's resolved sightings of this cat, taken in the last 30 days, that still have something open. Each one has its id, capture date, its photo's opaque URL, which questions are still open, and the ear tip's state: `open`, `answered` (with this device's current answer, so the card can show "You said…" and offer a change) or `checked` (Syros Cats have ruled, so no change). It answers only about the caller's own sightings, so it reveals nothing about anyone else. Its payload carries no coordinates.
- **The app.** A `MoreToAdd` card on `app/cat/[id].tsx`, fed by that endpoint, shown only with signal and only when it has something. The sheet reuses `SightingQuestions` with a new `questions` prop (which to show) and the sighting's own photo, and sends through the same `answersRequest`.
- **Every answer is still written by `writeObservation`** with the sighting's `photoId`, `observedAt` = the sighting's capture time, role `public`, provenance `volunteered`. So: a clipped answer reaches *Likely* only with its photo, as always; deleting a person (SYC-63) severs these rows like any other device-authored observation; and the answer adds no evidence of life of its own, because `loadCatRecords` counts an ear-tip answer that belongs to a sighting only through that sighting, at its true date (PR 7, after this spec's review).
- **Rate limits.** The card's endpoint is cheap and device-scoped; it sits behind the same device check as resolve. Answers are bounded by the number of the device's own sightings, which are already rate-limited at upload.

---

## 7. Tests that must exist

1. A spotter can add the ear tip or a note to their own sighting 10 days later. The answer's `observedAt` is exactly the photo's capture time, not the day it was sent, and not moved.
2. **A late answer never makes a cat look more recently seen.** An ear-tip answer sent today on a 20-day-old sighting leaves the cat's "last evidence of life" at that sighting's date, not today. And the edge the review found: a sighting captured 29 days ago, synced and matched today, accepts an answer today and refuses one in two days; no answer is ever stored with a moved date.
3. Answers of every kind more than 30 days after the photo was taken are refused; inside the month, all three are accepted.
4. Each question once per sighting: food and water on the reward screen, then a note later, both land; a second note, or a second food-and-water answer, is refused.
5. The reward screen still asks about a cat's ear once per spotter: `askEarTip` stays false after any answer, and after a change. A second ear-tip answer without `changeEarTip` is dropped, as in PR 7.
6. **Changing an answer:** "looks whole" then a change to "clipped" on a sighting from the last month leaves one current answer, the old one replaced and still in the history, and the cat reaches *Likely* in the record. Changing to the same answer writes nothing. Two changes sent at once leave exactly one current answer.
7. **Only your own:** a change can never point at another device's answer, even if the request names one. A spotter with no answer yet can't "change" anyone else's.
8. **Never after Syros Cats have checked it:** after a team "that's not a clip" on this spotter's answer, a change is refused (`EAR_TIP_CHECKED`) and the cat stays *Not known yet*.
9. **Checked includes sterilisation:** after a staff or vet statement that the cat is (or isn't) sterilised, a change is refused and the card says Syros Cats have checked it.
10. **A change racing a team correction:** a change and a team "that's not a clip" on the same answer, sent at the same moment, never both land. Whichever is second is refused, and if the team's lands, the cat stays *Not known yet*. (Run both orders, and a backdated team correction.)
11. **Only with a recent photo:** a spotter whose sightings of this cat are all more than a month old can't change their answer (there's no open sighting to change it from).
12. `my-open-sightings` returns only the caller's own sightings, refuses a wrong secret, never includes coordinates, another person's sighting or any note text, reports the ear tip as open, answered or checked correctly, and is empty when nothing is open.
13. A clipped answer added later reaches *Likely* in the record only because its sighting has a photo. The public line still says *Not known yet* while Q2's gate is closed.
14. A note added later never appears in any public payload (the §10.8.8 list, as in PR 7).
15. The card shows only the open questions, shows "You said…" with "Change my answer" (or "Syros Cats have checked this one"), hides itself when there's nothing left, and doesn't show offline (app tests), at ~390 px and desktop, in all three languages.

---

## 8. What this doesn't cover

- **Coat colour and markings.** Later, these will be new kinds of detail on the same card. Coat colour is already planned: the matching model reads it from the main photo and stores it as a `system:vision` observation (SYC-119 Slice C, `choose-a-different-cat.md` §4.7). A person correcting or adding it would be a later kind of answer here. Markings (SYC-2) aren't specified yet. Neither is built by this spec.
- **Sex, age and health.** Not asked anywhere today. Health worries already have their own route: the "This cat needs help" report (SYC-42).
- **Owners and cat guardians adding authoritative facts** ("she was spayed in 2023"). That's a different authority, not a spotter's observation, and it belongs with roles (SYC-53) and the team's correction tools.
- **Showing notes, answers and food and water to the team.** That's the staff dashboard (SYC-43).
- **A sighting the team moves to a different cat** (SYC-150, not built yet). Its answers were written against the first cat. Whoever builds moving a sighting must decide what happens to its answers, and must make sure `my-open-sightings` then shows the sighting under its new cat only. Flagged here so it isn't missed (review finding 3).

---

## 9. Ideas parked, not proposed

- **A note-only box for anyone who has ever spotted the cat** (Decision 1, option C). Useful for cat guardians once they're regulars. Worth revisiting if guardians ask.
- **A Profile-tab list of recent spots with open questions** (Decision 5).

---

## 10. Rollout

Code only; no migration. It ships after PR 7 (it extends PR 7's endpoint and component), so it also waits for SYC-79's photos. Rollback is a revert. Answers already stored stay valid observations.

---

## 11. Review

An independent adversarial review (Sonnet, in its own worktree) checked this spec against the data spine, PR 7's code and DECISIONS.md on 4 October 2026. Its one serious finding: a late answer could have been stored with a date weeks newer than its photo, and made the cat look more recently seen. That's now fixed twice, in PR 7's code and in Decision 2's recommendation. Everything else held up or is folded in. The full findings, and what changed for each, are in [`reviews/add-details-later-review.md`](./reviews/add-details-later-review.md).

A second review pass (Sonnet, its own worktree, 5 October 2026) checked the parts written after Samuel's approval: spotters changing their own ear-tip answer, and food and water for the month. It found a timing gap (a change and a team correction sent at the same moment could both land, and the spotter's could win) and that "checked" missed a team or vet statement about sterilisation. Both are fixed in §3.1 and §6, with tests. It also asked for the dashboard to order food-and-water answers by the photo's date, now a stated requirement on SYC-43. Details are in the review file.
