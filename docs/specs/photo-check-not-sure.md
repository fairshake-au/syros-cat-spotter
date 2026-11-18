# When the photo check isn't sure it's a cat

**Ticket:** SYC-866 (a sock became cat #32, "Captain Sprout"). **Related:** SYC-642 (letting a spotter overrule "no cat", parked), SYC-632 (server refuses "no cat" photos, backlog), SYC-249 (refuse off-island spots, backlog), SYC-503 (when the check fails).
**Status:** draft for Samuel's approval, 18 Nov 2026. Fix direction chosen by Samuel, 18 Nov: "Prompt + can't tell".
**Builds on:** [`when-the-photo-check-fails.md`](./when-the-photo-check-fails.md) (the "couldn't check" screen), [`photo-tips-and-extra-photos.md`](./photo-tips-and-extra-photos.md) (the "not a cat" screen and multi-photo spots).

## 1. The problem

On 17 Nov Samuel photographed a black sock lying on a floor at night. The photo check said "yes, there's a cat", and with no known cats nearby the app went straight to naming, so the sock became a new cat, "Captain Sprout".

What the live record shows (Neon, read-only, 18 Nov): the check **worked** (`matcher_failed = false`) and answered **cat** (`no_cat_in_any_photo = false`). It compared against no cats (`compared_cat_ids` empty), and the spotter chose "new cat". The photo is a dark crumpled sock on a pale floor, taken from above at night. It honestly looks like a small black cat curled up.

Why the check said yes: the instructions we send the vision model lean towards yes.

1. They open with "You are an expert at identifying individual street cats", which tells the model the photo is a cat before it's asked.
2. "Is there a cat?" is a side task with only yes or no. The model isn't asked what it actually sees, isn't asked to point to cat features, and can't say "I can't tell".
3. With no known cats nearby, the instructions still say "The following 0 images are known cats, in order: ." The whole request is about matching a cat.

**Unchecked:** the check hasn't been re-run on this photo. The AI keys exist only inside Replit. §6 is how we'll prove the cause and the fix.

**The trap to avoid.** Real cats photographed at night, half-hidden or curled up are just as hard to tell apart as this sock, and spotters often take exactly those photos. A stricter "yes or no" would block socks but would also turn real cats away at a dead-end screen. So the check gets a third answer, **"not sure"**, and the spotter decides only in that case.

## 2. What the spotter sees

The check now gives one of three answers: **cat**, **not a cat**, or **not sure**.

- **Cat:** unchanged. Look-alikes, or the naming screen when there are none.
- **Not a cat:** unchanged. The existing dead-end screen ("No cat found", photo tips, "Take another photo"). The model only says this when it can see what the photo shows instead, such as a sock, a wall, a dog or a shadow.
- **Not sure:** a new screen.

> **[their photo]**
> **Is there a cat in this photo?**
> We couldn't see a cat clearly. A closer or brighter photo helps us match it to the right cat.
>
> **[ Take another photo ]** — main button, back to the Spot tab, as on "No cat found"
> *Yes, there's a cat* — a plain text link, carries on to the look-alikes or the naming screen
> *(photo tips, compact, as on "No cat found")*

- **Take another photo** is the main button because it gives the best outcome either way: a sock gets dropped, and a real cat gets a photo that matches better.
- **Yes, there's a cat** carries on exactly as a "cat" answer would have. If the check found look-alikes, they show. If not, the naming screen shows. The look-alikes were already worked out in the same call, so this costs no second check and no wait.
- **Close (×)** leaves the spot in the review list, as for every other result. Opening it again shows this screen again.
- **Points:** the usual points apply once the spotter carries on (decision D2).
- **No feeding nudge** on this screen, as on "No cat found" and "couldn't check". If the spotter carries on, the nudge follows the result screen they land on, as today.

The screen uses the spotter's own photo, as the "couldn't check" screen does. With several photos (first, face, body), it shows the first.

## 3. What the check is asked

The vision call is rewritten so the cat question comes first and is asked neutrally. The matching part is unchanged.

1. **A neutral opening.** The "expert at identifying street cats" framing moves to the matching task, after the cat question.
2. **Say what you see first.** The model first writes what the new photo shows in a few words (for example "a black sock on a wooden floor" or "a tabby cat on a wall"). Only then does it answer the cat question. This short description is kept in the team-only record (§5).
3. **Three answers.** "cat" only when the model can point to at least one part of a cat it can actually see: face, eyes, ears, whiskers, paws, tail or fur. "not_cat" when what's shown is clearly something else. "unsure" for everything in between: too dark, too blurry, too far away, or a shape that could be a cat.
4. **Several photos:** "cat" if any photo clearly shows a cat. "not_cat" only if every photo clearly shows something else. Otherwise "unsure". The "more than one cat?" question is unchanged.
5. **No known cats nearby:** the "known cats" sentence and the matching task are left out entirely, rather than saying "the following 0 images".
6. **Reading an old-shaped answer:** an answer that still uses the old yes/no field is read as before (yes → cat, no → not a cat). An unreadable answer is a failed check, as today (SYC-503).

## 4. What the phone and the team see

- **The phone is told the three-way answer** alongside today's fields. For "not sure", the old "is it a cat" field still says yes, so an older app that doesn't know the new answer behaves exactly as it does today and goes straight on to the look-alikes or naming. Only the new app shows the "not sure" screen.
- **Spots waiting to be finished** (the review list, the "ready to review" banner, spots sent from the offline queue) carry the new answer, so the "not sure" screen shows whichever way the spotter opens the result.
- **Check again** (SYC-503) only runs after a failed check. A "not sure" answer is a check that worked, so it is final for that spot, like the other two.
- **Team "find from photo" page:** a "not sure" answer is treated as a cat. The team are looking at the photo themselves and can judge it. Only "not a cat" stops the search, as today.
- **Team cat page:** a sighting whose check said "not sure" and where the spotter chose "Yes, there's a cat" gets a short line under it: "Photo check wasn't sure this was a cat. The spotter said it was." Then a sock that gets through is easy to find and remove (decision D3).

## 5. What's recorded

The team-only match record for each spot (`sighting_matches`) gets two new columns. Both are empty for spots before this change and when the check failed.

- **`cat_check`**: `cat`, `not_cat` or `unsure`.
- **`photo_seen`**: the model's few-word description of the photo (at most 120 characters, trimmed). It describes the photo, not the spotter. It's never shown to the public or the phone, and it's removed whenever the photo's other details are removed (the existing redaction, `redacted_at`).

`no_cat_in_any_photo` is still written so nothing that reads it changes: true only for `not_cat`, false for `cat` and `unsure`.

**Launch measures** (SYC-760): the match groups in `launchMeasures.ts` gain "not sure, carried on" and "not sure, retook". That tells us after launch how often the third answer comes up, and whether to look at SYC-642 again.

This needs one database migration. Migrations have one owner session at a time (project rules), so the build will need that ownership named.

## 6. How we prove it works

The prompt can only be judged by running it on real photos, and the AI keys exist only in Replit.

- **A test set from the live database:** photo #62 (the sock), every photo the check has called "not a cat" so far, and about 20 real cats. The real cats are picked to be hard: the darkest, night-time, half-hidden and curled-up ones, chosen by eye by Claude from the team pages and listed by photo number in the PR.
- **A small team-only script** runs the old and new instructions over the set and prints, for each photo, the old answer, the new answer and the description. No photo, name or position is printed, only photo numbers and answers. Claude runs it from the Replit workspace through the Replit connector. Samuel doesn't have to.
- **Pass bar:** the sock comes back `not_cat` or `unsure`. **No** real cat comes back `not_cat`. At most 1 in 5 real cats in the hard set comes back `unsure`. If the new instructions miss the bar, we tune them and run the script again before anything ships.
- **Code tests** (with the model mocked, as today) cover reading the three answers and the old shape, the "not sure" screen and its two ways on, the older-app fallback, the record columns, launch measures, and the team page line.

## 7. Captain Sprout

Cat #32 and its sighting stay as they are until this change is live. They're the first test case. Once it ships, the team removes cat #32 the usual way, and Claude confirms with Samuel before doing it.

## 8. Not in this change

- **Letting a spotter overrule a confident "not a cat"** stays parked in SYC-642. "Not sure" is the narrow middle ground. The launch measures in §5 will show whether the wider version is needed.
- **Refusing spots from outside Syros** stays in SYC-249. It would have caught this sock (taken in Philadelphia), but not one photographed on Syros.
- **SYC-632** (the server refusing "no cat" photos), when it's built, must let "not sure" spots through. A note goes on that ticket.

## 9. Decisions for Samuel

**D1. What "not sure" offers.**
- **A (recommended): "Take another photo" as the main button, and "Yes, there's a cat" as a small link.** Good: it nudges towards a better photo, and nobody with a real cat is stuck. Risk: a determined spotter can still turn a sock into a cat, but now the team can see that it happened (D3).
- **B: Only "Take another photo".** Good: the strictest version. Risk: a real cat that the check is unsure about can never be logged, however many photos are taken. That's the trap in §1.
- **C: Carry straight on with a warning banner.** Good: no extra tap. Risk: spotters skip banners, so it would barely stop socks.

**D2. Points when the spotter carries on after "not sure".**
- **A (recommended): The usual points** (25 for a new cat, the usual amount for a match). Good: it doesn't punish a real dark cat at night. Risk: a sock that gets through still earns points until the team removes it, which takes them back as with any removed cat.
- **B: Points held until the team confirms.** Good: nothing is earned for a sock. Risk: it needs a new "held points" state and team work for every unsure spot, which is a lot for a rare case.

**D3. What the team sees.**
- **A (recommended): One line on the team cat page** under that sighting (§4). Good: cheap, and it's where the team already removes cats. Risk: nobody is alerted, so the team only spots it if they open the cat.
- **B: A line, plus a "photo check wasn't sure" item in the team's welfare queue.** Good: someone actively looks at every one. Risk: more team work, mostly on real cats.

**D4. Pass bar for the prompt test (§6).** Recommended: the sock is caught, no real cat is called "not a cat", and at most 1 in 5 hard real cats come back "not sure". A lower "not sure" limit is safer for spotters but harder to hit.
