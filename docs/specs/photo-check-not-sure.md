# When the photo check isn't sure it's a cat

**Ticket:** SYC-866 (a sock became cat #32, "Captain Sprout"). **Related:** SYC-642 (letting a spotter overrule "no cat", parked), SYC-632 (server refuses "no cat" photos, backlog), SYC-249 (refuse off-island spots, backlog), SYC-503 (when the check fails), SYC-574 ("Is this {name}?"), SYC-760 (launch measures).
**Status:** draft for Samuel's approval, 18 Nov 2026. Fix direction chosen by Samuel, 18 Nov: "Prompt + can't tell". Adversarial review done 18 Nov (16 findings, all folded in; see §11).
**Builds on:** [`when-the-photo-check-fails.md`](./when-the-photo-check-fails.md) (the "couldn't check" screen), [`photo-tips-and-extra-photos.md`](./photo-tips-and-extra-photos.md) (the "not a cat" screen and multi-photo spots).

## 1. The problem

On 17 Nov Samuel photographed a black sock lying on a floor at night. The photo check said "yes, there's a cat", and with no known cats nearby the app went straight to naming, so the sock became a new cat, "Captain Sprout".

What the live record shows (Neon, read-only, 18 Nov): the check **worked** (`matcher_failed = false`) and answered **cat** (`no_cat_in_any_photo = false`). It compared against no cats (`compared_cat_ids` empty), and the spotter chose "new cat". The photo is a dark crumpled sock on a pale floor, taken from above at night. It honestly looks like a small black cat curled up.

Why the check said yes: the instructions we send the vision model lean towards yes.

1. They open with "You are an expert at identifying individual street cats", which tells the model the photo is a cat before it's asked.
2. "Is there a cat?" is a side task with only yes or no. The model isn't asked what it actually sees, isn't asked to point to cat features, and can't say "I can't tell".
3. With no known cats nearby, the instructions still say "The following 0 images are known cats, in order: ." The whole request is about matching a cat.

**Unchecked:** the check hasn't been re-run on this photo. The AI keys exist only inside Replit. §7 is how we'll prove the cause and the fix.

**The trap to avoid.** Real cats photographed at night, half-hidden or curled up are just as hard to tell apart as this sock, and spotters often take exactly those photos. A stricter "yes or no" would block socks but would also turn real cats away at a dead-end screen. So the check gets a third answer, **"not sure"**, and the spotter decides only in that case.

## 2. What the spotter sees

The check now gives one of three answers: **cat**, **not a cat**, or **not sure**.

- **Cat:** unchanged. "Is this {name}?" when the spot came from a cat page (SYC-574), then the look-alikes, or the naming screen when there are none.
- **Not a cat:** unchanged. The existing dead-end screen ("No cat found", photo tips, "Take another photo"). The model only says this when it can see what the photo shows instead, such as a sock, a wall, a dog or a shadow.
- **Not sure:** a new screen.

> **[their photo]**
> **Is there a cat in this photo?**
> We couldn't see a cat clearly. A closer or brighter photo helps us match it to the right cat.
>
> **[ Take another photo ]** — main button
> *Yes, there's a cat* — a plain text link
> *(photo tips, compact, as on "No cat found")*

**Take another photo** works exactly like the button on "No cat found": the spot's card is taken off the review list, the photo can be sent again, and the app goes back to the Spot tab. On the server the spot stays unfinished, as a "not a cat" spot does today.

**Yes, there's a cat** carries on exactly as a "cat" answer would have:

- If the spot came from a cat page, "Is this {name}?" comes next. The "not sure" screen always comes *before* that step, so a sock can't skip it.
- Then the look-alikes, if the check found any, or the naming screen if not.
- There's no second check and no extra wait. The look-alikes were worked out in the same call, and low scores are still held back as today.

**Close (×)**, or leaving the app, keeps the spot in the review list. That includes leaving after tapping "Yes" but before finishing. Opening it again always starts at the "not sure" screen.

**With several photos** (first, face, body), the screen shows the first photo.

**Points:** the usual points apply once the spotter carries on (decision D2).

**No feeding nudge** (SYC-36) after a "not sure" answer, even if the spotter then carries on. The nudge is decided once, when the result screen opens, so "not sure" counts as a no-nudge result, like "No cat found" and "couldn't check". The waiting-card record (SYC-48) counts it as a result that was shown, as it does for "No cat found".

**Every screen is in English, Greek and French**, and is checked at phone width (390px) and desktop.

## 3. Which phones get this

The app has no over-the-air updates. A phone only gets the new screen once the spotter installs the new app version. Until then:

- **The web app** gets it as soon as it's published.
- **An older installed app** is told "it's a cat" for a "not sure" answer, which is exactly what it hears today. So it works as it does now and goes straight on, and socks can still get in that way. The team line in §5 is worded so it's true for these spots too.

## 4. What the check is asked

The vision call is rewritten so the cat question comes first and is asked neutrally. The matching part is unchanged.

1. **A neutral opening.** The "expert at identifying street cats" framing moves to the matching task, after the cat question.
2. **Say what you see, then list the cat parts, then answer.** The answer has a fixed order, so the model has to describe before it decides:
   `{"photoSeen": "…", "catPartsSeen": [...], "catCheck": "cat" | "not_cat" | "unsure", "mixedCats": …, "matches": [...]}`
   - `photoSeen`: what the photo shows, in a few words (for example "a black sock on a wooden floor"). It describes **animals and objects only**: never people, faces, text, signs, house numbers or number plates.
   - `catPartsSeen`: the cat parts the model can actually see, from a fixed list: face, eyes, ears, whiskers, tail, paws, fur.
3. **What each answer means.**
   - **cat:** at least one of face, eyes, ears or tail is visible, or two other parts. Fur alone, or fur and paws alone, isn't enough: a fuzzy sock has "fur".
   - **not_cat:** what's shown is clearly something else.
   - **unsure:** everything in between: too dark, too blurry, too far away, or a shape that could be a cat.
4. **The server double-checks.** If the answer says "cat" but the parts list doesn't meet the rule in point 3, the server treats it as "unsure".
5. **Several photos.** "cat" if any photo clearly shows a cat. "not_cat" only if every photo clearly shows something else. Otherwise "unsure". One `photoSeen` covers the whole spot, describing the first photo. The "more than one cat?" question (`mixedCats`) is asked and stored as today, whatever the cat answer.
6. **No known cats nearby.** The "known cats" sentence and the matching task are left out entirely, rather than saying "the following 0 images".
7. **Reading the answer.**
   - `catCheck` is read ignoring capitals and spaces.
   - Any other word (for example "maybe") counts as "unsure", not as a failed check. A failed check costs the spotter a "Check again".
   - An answer with no `catCheck` is read the old way: `anyCat`, or `isCatPhoto` if that's missing too. Yes means cat, no means not a cat.
   - If `catCheck` and an old field are both there, `catCheck` wins.
   - An answer that can't be read at all is a failed check, as today (SYC-503).
8. **Nothing about the photo is logged.** The timing log stays free of content. `photoSeen` is never written to the server log.

## 5. What the phone and the team see

**The phone is told a new field, `catCheck`** (`"cat"`, `"not_cat"` or `"unsure"`), next to today's `isCatPhoto`.

- `isCatPhoto` stays true unless the answer is `not_cat`.
- `catCheck` is optional. Where it's missing (an older server answer, or a spot saved on the phone before this change), the app works it out from `isCatPhoto`.
- It's carried everywhere a result is handed on: sending, the offline queue, spots kept for review, the "ready to review" banner, the review screen and its saved state, "Check again", and the photo-replace reset. The build plan lists every place by file.

**Saved and replayed answers keep "not sure".** When the phone asks again for an answer it has already been given (after a lost reply, or a "Check again" whose reply never arrived), the server rebuilds it from the record. It reads `cat_check`, so a "not sure" is never replayed as "cat".

**"Check again"** (SYC-503) still only runs after a failed check. If it now works and says "not sure", the spotter lands on the "not sure" screen.

**A repeat send can change the answer.** If the same spot is sent again before it's finished (a lost reply, or a queued send retried), the check runs again and replaces the stored answer, as it does today for look-alikes. The new answer is what the spotter sees. Once the spot is finished, the answer is final.

**Team "find from photo" page:** a "not sure" answer is treated as a cat. The team are looking at the photo themselves and can judge it. Only "not a cat" stops the search, as today. That page needs no change.

**Team cat page** (decision D3). A sighting whose check said "not sure" gets a short amber tag, using the same style as the "may be more than one cat" tag: **"Photo check wasn't sure this was a cat."** A sighting with this tag is never folded away among routine sightings.

## 6. What's recorded

The team-only match record for each spot (`sighting_matches`) gets two new columns. Both are empty for spots from before this change and for failed checks, and both are replaced when a repeat send runs the check again.

- **`cat_check`**: `cat`, `not_cat` or `unsure`.
- **`photo_seen`**: the model's few-word description (at most 120 characters, trimmed).
  - It's never shown to the public or sent to the phone.
  - **When a photo is removed** (for privacy, or by the team), `photo_seen` is cleared for every spot that used it, in the same step that removes the photo.

`no_cat_in_any_photo` is still written so nothing that reads it changes: true only for `not_cat`, false for `cat` and `unsure`.

**Launch measures** (SYC-760): the existing groups don't change, so the baseline stays comparable. Two side counts are added:

- **"not sure, finished"**: the spotter carried on and finished the spot.
- **"not sure, not finished"**: the spotter retook, closed it or walked away. The server can't tell these apart.

These show after launch how often the third answer comes up, and whether to look at SYC-642 again.

## 7. How we prove it works

The prompt can only be judged by running it on real photos, and the AI keys exist only in Replit.

**Getting the test to Replit.** A small team-only script ships first, in its own PR, with no change to the app. Replit can't fetch from GitHub itself, so after that PR merges, **Samuel pulls main in Replit's Git pane** (one click). Claude then runs the script in the Replit workspace through the Replit connector. First Claude checks that the workspace's database is the live one (Neon `production`). If it isn't, the script reads photos from the live database read-only instead.

**The test set is chosen by rule, not by eye, and fixed before the first run.**

- **Real cats:**
  - every finished spot taken between sunset and sunrise, Athens time
  - plus a random sample of the rest, to about 40 cats in all
  - plus a few spots with several photos
- **Non-cats:**
  - the sock (photo #62)
  - every photo the check has called "not a cat" so far
  - any photos Samuel adds (decision D5)
- **Ground truth:**
  - Claude labels every photo by hand ("cat", "not a cat", or "can't tell even for a person"), and the labels go in the PR for Samuel to glance at.
  - Some "not a cat" photos are probably real cats; they move to the cat side.
  - Photos even a person can't call are left out of the scoring.
- **Half the set is held back.** The prompt is tuned on one half. The final pass/fail runs once, on the other half.
- **Each photo is run 3 times**, because the model's answers vary. Its worst answer counts.
- **Both versions of the request are tested:** with no known cats, and with the 3 darkest nearby known cats attached. Cat photos in the same request may nudge the model towards "cat".

**What the script prints:** for each photo, its number, the old answer and the new answers. Never the photo, a name or a position. `photoSeen` goes to a file in the scratch folder only.

**Pass bar** (decision D4), on the held-back half, worst of 3 runs:

- The sock, and every confirmed non-cat, comes back "not a cat" or "not sure", never "cat".
- **No** real cat comes back "not a cat".
- At most 1 in 5 real night-time cats come back "not sure".

If the new prompt misses, it's tuned on the first half and the held-back half is run again. Nothing ships until it passes. With about 40 cats, "no real cat called not a cat" still allows a true miss rate of a few percent, so the launch measures in §6 keep watching after launch.

**Code tests** (with the model mocked, as today) cover:
- reading all three answers, odd words, the old shape, and both shapes at once
- the server's double-check on the parts list
- the "not sure" screen, both ways on from it, and its order with "Is this {name}?"
- an older app getting "cat"
- a replayed answer and a "Check again" both keeping "not sure"
- photo removal clearing `photo_seen`
- no `photoSeen` in any phone response or in the API schema
- the record columns, the launch side counts, and the team tag (including that it isn't folded away)

## 8. Building it

Three parts of this change touch areas that have one owner session at a time (project rules). The build brief names an owner for each:

- the database migration (two new columns)
- the app's translations (`lib/i18n.ts`: the new screen, in English, Greek and French)
- the team pages' translations (`teamPages/strings/*.ts`: the new tag)

The order is: the test script PR first (§7), then prove the prompt, then the full change. The full change goes through draft, local tests, then ready, as usual.

## 9. Captain Sprout

Cat #32 and its sighting stay as they are until this change is live. They're the first test case. Once it ships, the team removes cat #32 the usual way. Claude confirms with Samuel before doing it.

## 10. Not in this change

- **Letting a spotter overrule a confident "not a cat"** stays parked in SYC-642. "Not sure" is the narrow middle ground. The launch measures in §6 will show whether the wider version is needed.
- **Refusing spots from outside Syros** stays in SYC-249. It would have caught this sock (taken in Philadelphia), but not one photographed on Syros.
- **SYC-632** (the server refusing "no cat" photos), when it's built, must let "not sure" spots through. A note goes on that ticket.

## 11. Decisions for Samuel

**D1. What "not sure" offers.**
- **A (recommended): "Take another photo" as the main button, "Yes, there's a cat" as a small link.**
  - Good: it nudges towards a better photo, and nobody with a real cat is stuck.
  - Risk: a determined spotter can still turn a sock into a cat, but the team can see it happened (D3).
- **B: Only "Take another photo".**
  - Good: the strictest version.
  - Risk: a real cat the check is unsure about can never be logged, however many photos are taken. That's the trap in §1.
- **C: Carry straight on, with a warning banner.**
  - Good: no extra tap.
  - Risk: spotters skip banners, so it would barely stop socks.

**D2. Points when the spotter carries on after "not sure".**
- **A (recommended): The usual points** (25 for a new cat, the usual amount for a match).
  - Good: it doesn't punish a real dark cat at night.
  - Risk: a sock that gets through earns points until the team removes it. Removing it takes them back, as with any removed cat.
- **B: Points held until the team confirms.**
  - Good: nothing is earned for a sock.
  - Risk: it needs a new "held points" state, plus team work on every "not sure" spot. That's a lot for a rare case.

**D3. What the team sees.**
- **A: The amber tag on the team cat page only.**
  - Good: cheap, and it's where the team already removes cats.
  - Risk: nobody is alerted. A sock is only found if someone opens that cat.
- **B (recommended): The tag, plus these spots in the existing "Matches to check" list on the dashboard home.** That list already holds suggestions spotters took, for the team to confirm.
  - Good: someone actually looks at every one, in a list the team already works through, and it only holds the rare "not sure" spots.
  - Risk: a little more for the team to look at, mostly real cats in bad light.
- **C: The tag, plus an item in the welfare queue.**
  - Good: it's very visible.
  - Risk: the welfare queue is for cats in trouble. This would dilute it.

**D4. Pass bar for the prompt test (§7).**
- Recommended: on the held-back half, worst of 3 runs:
  - the sock and every confirmed non-cat are caught
  - no real cat is called "not a cat"
  - at most 1 in 5 night-time cats come back "not sure"
- A lower "not sure" limit is kinder to spotters but harder to hit.

**D5. Extra non-cat photos for the test.** The test has few known non-cats: the sock, plus whatever the check has already turned away. More would make "socks get caught" a real test, not a test of one.
- **A (recommended): Samuel takes 10–15 quick phone photos, in dim light, of things that could pass for a cat.** For example a dark bag, a cushion, a shoe, a scarf, a shadow, a dog or a toy. He adds them to a folder Claude names.
  - Good: real phone photos in the conditions that matter.
  - Risk: about 10 minutes of Samuel's time.
- **B: Use only the photos the check has already turned away.**
  - Good: no work for Samuel.
  - Risk: those are the photos the old prompt already caught. They don't test the cases it misses.
