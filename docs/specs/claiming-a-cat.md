# Saying a cat lives with you ("This is my cat")

**Status:** **Draft for Samuel's review.** Not yet through adversarial review.
**Owner:** Samuel
**Covers:** SYC-130, as directed by Samuel on 7 October 2026 (Linear SYC-130).
**Related:** [`cat-record-data-spine.md`](./cat-record-data-spine.md) §6.4 (item 4, who hears about sightings straight away), §8 (deletion), §10.1 (observations), §10.2 (life status), §10.6 (Option B: an owner sees their cat's exact spot) · [`team-access-and-welfare-queue.md`](./team-access-and-welfare-queue.md) §3.3 (fixing what is wrong), §7.3 (capabilities) · [`choose-a-different-cat.md`](./choose-a-different-cat.md) §4.6 (how a sighting was matched) · [`DECISIONS.md`](./DECISIONS.md) Part 3 (spec ownership) · SYC-41 (blurring), SYC-218 (spine PR 9, the round-up), SYC-63 (deletion), SYC-232 (the "has a home" push), SYC-59 (duplicate cats), SYC-52 (confidence engine), SYC-4 (native-speaker review).

**What this document owns.** Who may say a cat lives with them, what they see when they do, and how a wrong claim is put right. It does **not** own what a claim *is* in the record, or what an owner can see:
- the `life_status: homed` observation and the owner link are the data spine's (§10.1, §10.2);
- exact location for an owner is §10.6;
- live sighting alerts for an owner are §6.4 item 4.

The team's dashboard actions belong to `team-access-and-welfare-queue.md`. Where this spec needs one, it says so and points there (§6.1). Following `DECISIONS.md` Part 3, this spec references those rules rather than restating them.

---

## 1. The short version

A cat's page offers **"This is my cat"** only to someone who has **met the cat**: their phone discovered it, or has a sighting of it that was matched by photo. Tapping it asks plainly, **"Is Agatha your cat?"**, and says what saying yes will do. Then the person says where the cat lives.

Someone who hasn't met the cat sees a quiet line instead: *"Is this your cat? Spot Agatha with the camera first, then you can say Agatha lives with you."* The server checks the same rule, so it holds outside the app too.

Nobody approves a claim. Syros Cats don't have the people to vet owners, and genuine owners shouldn't have to wait. Instead the team has **one action to remove an owner** when they notice a wrong claim, and an owner can **let go of a cat** themselves.

A cat the app already shows as having a home can't be claimed by anyone else.

---

## 2. Why claiming has to be guarded

Saying a cat lives with you changes a lot, for everyone:

- **The cat shows "Has a home".** A street cat wrongly marked as homed drops out of the charity's sight for sterilisation and welfare work.
- **The owner sees the cat's exact spot** on its page, while everyone else sees a 250 m area (data spine §10.6, Option B, confirmed by Samuel on 6 Oct 2026).
- **The owner hears about every sighting straight away.** Everyone else gets an evening round-up with no times (§6.4 item 4).
- **The owner can rename the cat**, which changes its name for everyone.
- **Everyone following the cat is told it has a home** (the push itself is SYC-232's concern).

So a claim is worth a lot to the wrong person: someone who wants to know exactly where a street cat is, and when it's seen. A careless claim matters too, such as a tourist who reads "claim" as "collect".

**Why not have Syros Cats approve claims.** It isn't workable for the team (Samuel, 7 Oct 2026), and it would make genuine owners wait for something that is theirs. Every guard in this spec works without the team doing anything routinely.

**What the guard is.** You can only say a cat lives with you once you have met it. A genuine owner meets their cat every day. Someone far away, or someone who has never seen the cat, can't claim it. That rules out most of the risk: the tourist in a hotel, the curious stranger and the mischief-maker. §9 is honest about what it doesn't stop.

---

## 3. Who can say "This is my cat"

A phone can claim a cat when **both** of these are true.

**1. The cat has no home yet.** Its derived life status (data spine §10.2) is not `homed`, and nobody is linked as its owner. A cat that already shows "Has a home" can't be claimed by anyone else (decision D3).

**2. This phone has met the cat**, in at least one of these ways:
- **it discovered the cat**: the cat began from this phone's sighting;
- **it has a sighting of the cat matched by photo**: the spotter confirmed a suggested match ("That's the one"), recorded as `choice: suggested` in the match record (`choose-a-different-cat.md` §4.6).
- **it has an older matched sighting of the cat** from before match records were kept (`choice: unlabelled`). Back then, the only way to match an existing cat was to confirm a suggestion; the build plan verifies that against the history before relying on it.

**What does not count:**
- **A hand pick** from the "Choose a different cat" list (`choice: hand_pick`). Anyone within 1.5 km can photograph any cat and pick another from the list, so a hand pick doesn't prove they met *this* cat (decision D1).
- **A sighting still waiting for Syros Cats to match it** (`awaiting_team`). It counts once the team has matched it to this cat.
- **A sighting unlinked by "Delete my data"**: it belongs to nobody (data spine §8).

**No time limit, no distance limit.** A qualifying sighting from any date counts, because owners live with their cats and the first sighting is as good as the latest. Distance doesn't matter either: a sighting matched to the cat by photo was taken where the cat was.

Only the claim itself is checked. Renaming, editing the home details and an owner's other abilities follow from being the owner, as the data spine already defines.

---

## 4. What the person sees

### 4.1 On the cat's page

| Who is looking | What they see |
|---|---|
| Someone who has met the cat, when it has no home | **"This is my cat"**, where the claim button has always been, but styled as a secondary action rather than the most prominent button on the page |
| Someone who hasn't met it, when it has no home | No button. One quiet line: *"Is this your cat? Spot Agatha with the camera first, then you can say Agatha lives with you."* (decision D2) |
| Anyone, when the cat already has a home | No button, no line. "Has a home" as usual |
| The cat's owner | Their usual owner view, plus **"Agatha doesn't live with me any more"** at the foot of the edit sheet (§6.2) |

The wording uses the cat's name rather than "he" or "she", so it never guesses.

### 4.2 Saying yes

Tapping "This is my cat" opens a sheet:

> **Is Agatha your cat?**
>
> Only say yes if Agatha lives with you. Everyone using the app will see that Agatha has a home, and people following Agatha will be told.
>
> **Where does Agatha live?** *(the existing home field, e.g. "the blue house by the church")*
>
> **[ Yes, Agatha lives with me ]** · **[ Cancel ]**

**Cancel** is the safe default and carries the visual weight. "Yes" is the deliberate choice. All the wording in this spec is a **draft for Samuel's approval**.

### 4.3 After saying yes

The cat shows "Has a home". The owner gets an owner's abilities (data spine §10.6, §6.4 item 4), and followers are told.

### 4.4 When the server says no

The app draws the page from what it already knows, which can be out of date: another phone may have claimed the cat a moment earlier. The server's answer is final, and each refusal has one plain line:

| Why | What the person sees |
|---|---|
| This phone hasn't met the cat | *"Spot Agatha with the camera first, then you can say Agatha lives with you."* |
| The cat already has a home | *"Agatha already has a home."* The page refreshes. |
| No connection | *"You need a connection to do this."* A claim is never saved to send later, because it changes what everyone sees. |

---

## 5. What a claim records

This is owned by the data spine, and this spec adds nothing to it. A claim writes `life_status: homed`, with `authority_scope: owner_of_this_cat`, and links the owner, in one transaction (§10.1, §10.2).

The "has met the cat" rule needs no new column. It is answered from records that already exist: who discovered the cat, and the match record of each sighting.

---

## 6. When a claim is wrong, or ends

### 6.1 The team removes an owner

The team corrects a cat's life status from the dashboard (`team-access-and-welfare-queue.md` §3.3). Life status follows the newest statement (data spine §10.2), so setting the cat back to "street" fixes what everyone sees. **It doesn't remove the owner**, though. The person who claimed the cat would keep its exact spot, the live alerts and the ability to rename it.

So the dashboard needs **one more action on a cat that has an owner: "Remove owner".** It:
- clears the owner link and the owner's name, as "Delete my data" does for that one cat (data spine §8);
- leaves the home note in place, for the team to edit if they want;
- asks, in the same step, what the cat's life status should be now. It pre-selects "Lives on the street" and records the choice as an ordinary team correction (§10.1), superseding the owner's `homed` statement;
- tells nobody, because a removal isn't news;
- is recorded with who did it and when, like every team action.

That action belongs to `team-access-and-welfare-queue.md`, with a new capability, `remove_owner`, given to staff (§7.3 there). This spec asks for it; that spec defines it (decision D6).

### 6.2 The owner lets go

At the foot of the owner's edit sheet: **"Agatha doesn't live with me any more"**. Tapping it asks for confirmation: *"Agatha will no longer show as having a home, and you won't be Agatha's owner in the app."*

Saying yes:
- clears the owner link and name;
- records `life_status: street` from this phone (`authority_scope: owner_of_this_cat`): the person who said the cat lived with them is the right one to say it no longer does;
- tells nobody.

This covers a cat that has moved, a mistake the person spots themselves, and someone leaving the island (decision D4).

### 6.3 Someone deletes their data

This is owned by the data spine (§8, SYC-63). The owner link and name are cleared, and the cat stays homed through its life status. Because of §3 rule 1, nobody else can then claim the cat. That is deliberate: the home is still real. If the cat later changes hands, the team puts it right (§6.1).

---

## 7. Registering a cat without spotting it

The server has a route for registering a brand-new cat as your own without spotting it (`POST /cats`, "register my cat"), but **no screen in the app uses it**; only some leftover strings refer to it. It creates a *new* cat, so it can't take over a street cat or reveal where one is.

It is, though, a second way to become an owner without meeting any cat, and it produces cats with no photo that may duplicate ones already in the app (SYC-59). With no screen relying on it, this spec removes it, along with its leftover strings (decision D7). If a "register my cat" screen is wanted later, it comes back with its own spec.

---

## 8. Words, in every language

The button and sheet are rewritten in English, Greek and French. Greek and French have so far said **"Adopt this cat"** ("Υιοθετήστε αυτή τη γάτα", "Adopter ce chat"). That's a different idea, and it's the misreading this spec exists to prevent. The new wording says "This is my cat" in each language, and goes to native-speaker review (SYC-4) before release.

---

## 9. What this does not stop, accepted

- **Someone who goes and spots the cat.** A person who photographs a street cat once can still say it lives with them, and gain its exact spot and live alerts. They have already stood where the cat was, so the exact spot tells them less than it would tell a stranger. The live alerts are a real gain, though. Samuel accepted this on 7 Oct 2026, when he chose this approach over taking the owner abilities away from claims.
- **Two people at the same cat.** The first to claim wins, and the second sees "Agatha already has a home". If that's wrong, the team removes the owner (§6.1).
- **A mistake the team never notices.** Nothing routinely asks them to look. Later, the confidence engine (SYC-52) could flag a cat whose owner and recent sightings disagree.

If these ever need tightening, two options exist, and neither needs the team:
- **owner abilities switch on over time**, once the owner has spotted the cat at the same place on several days;
- **a "reported home" status** that the cat's own evidence confirms (SYC-52).

---

## 10. What the server enforces

- **The claim route applies §3 in full**, and refuses with a distinct error for each case:
  - `NOT_MET`: this phone hasn't met the cat;
  - `ALREADY_HOMED`: the cat already has a home, by owner or by status.

  It checks the derived life status, not only the owner link, so a cat whose owner deleted their data stays protected.
- **Racing claims.** The rule is checked inside the same transaction as the claim, so two phones can't both win.
- **Letting go** (§6.2) needs the device secret, like every owner route, and only the current owner can do it.
- **"Remove owner"** (§6.1) is team-only, behind `remove_owner`, and only from the dashboard's own origin, like every dashboard write.

---

## 11. Decisions for Samuel

**D1. Does a hand pick count as having met the cat?**
- *No (recommended).* Only a sighting matched by photo, or discovering the cat, counts. A hand pick can be made by photographing any cat within 1.5 km and choosing another from the list: the very shortcut this spec closes. *Risk:* a genuine owner whose cat the app never suggests has to keep spotting until it does. That should be rare, because the matcher looks within 500 m and owners spot their cats at home.
- *Yes.* Simpler for owners. *Risk:* anyone within 1.5 km can claim any cat with one stray photo.

**D2. What does someone who hasn't met the cat see?**
- *A quiet line saying how (recommended).* Genuine owners learn what to do. It only spells out a rule anyone could work out anyway.
- *Nothing.* Cleaner. *Risk:* genuine owners don't know claiming exists until they've spotted their cat.

**D3. Can someone claim a cat that already shows "Has a home" but has no owner?** This happens after "Delete my data", or when the team recorded a cat as adopted.
- *No (recommended).* The home is real. A second person claiming a homed cat is more likely a mistake than a new owner, and the cat's exact spot is someone's home. *Risk:* a genuine new owner of such a cat can't claim it until the team sets it back to street.
- *Yes, under the same "met it" rule.* *Risk:* a stranger who spotted it once gets the exact spot of a home.

**D4. Can an owner let go of a cat themselves (§6.2)?**
- *Yes (recommended).* Cats move, people leave, people notice their own mistakes, and none of it needs the team.
- *No, the team only.* *Risk:* wrong or out-of-date claims stay until someone emails.

**D5. What happens to the 12 cats already claimed on the live site?**
- *Keep them (recommended).* Testers claimed them before this rule existed. The team can remove any wrong one (§6.1).
- *Require each owner to have met the cat, and remove the rest.* Stricter, but it removes genuine owners without telling them.

**D6. Add "Remove owner" to the team dashboard (§6.1)?**
- *Yes (recommended).* Without it, the team's correction fixes the status but leaves a wrong claimer with the cat's exact spot and live alerts. It's reactive, so there's no routine work.
- *No.* *Risk:* a wrong claim can't be fully undone.

**D7. What happens to the unused "register my cat" route (§7)?**
- *Remove it (recommended).* No screen uses it. It's a second way to become an owner without meeting a cat, and it makes photo-less cats that may duplicate real ones. Removing an unused door is the smallest safe change.
- *Keep it, unchanged.* It can't touch an existing cat. *Risk:* an unguarded way into ownership stays open for nobody's benefit.
- *Keep it and require a photo.* Only worth it if a "register my cat" screen is planned.

**Copy.** The button, the sheet, the refusal lines and the "let go" text (§4, §6.2) are drafts for approval.

---

## 12. How we'll know it works

**Server tests:**
- A phone with only a hand pick, only an `awaiting_team` sighting, or no sighting at all is refused `NOT_MET`.
- A discoverer, or a phone with a sighting matched by photo, succeeds.
- A cat that is homed with no owner (after deletion) is refused `ALREADY_HOMED`.
- Two simultaneous claims produce exactly one owner.
- "Remove owner" clears the link: that phone loses the exact spot and the live alerts, and the action records who did it.
- Letting go clears the link and records `street`.

**App tests:**
- The button shows only to a phone that has met the cat, and the line shows to one that hasn't.
- Cancel changes nothing.
- Each refusal shows its line.

**Mutation probes:**
- Remove the "met it" check: a named test fails.
- Check only the owner link, not the derived status: the after-deletion test fails.
- Remove the owner-link clearing from "Remove owner": the exact-spot test fails.

**By hand,** in the browser at 390 px and at desktop width, with real data:
- claim as a phone that has met the cat;
- try as one that hasn't;
- remove the owner from the dashboard and confirm the exact spot is gone.
