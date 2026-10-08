# Saying a cat lives with you ("This is my cat")

**Status:** **Decisions made by Samuel, 8 October 2026 (§15). Copy still awaiting approval.** One adversarial review pass done and folded in (§13); its report is [`reviews/claiming-a-cat-review.md`](./reviews/claiming-a-cat-review.md).
**Owner:** Samuel
**Covers:** SYC-130, as directed by Samuel on 7 October 2026 (Linear SYC-130).
**Related:** [`cat-record-data-spine.md`](./cat-record-data-spine.md) §3.2 (who may state a life status), §6.4 (item 4, who hears about sightings straight away), §8 (deletion), §10.1 (observations), §10.2 (life status), §10.3 (merged cats), §10.6 (Option B: an owner sees their cat's exact spot) · [`team-access-and-welfare-queue.md`](./team-access-and-welfare-queue.md) §3.3 (fixing what is wrong), §7.3 (capabilities) · [`choose-a-different-cat.md`](./choose-a-different-cat.md) §4.6 (how a sighting was matched), §8.2 (moving a sighting) · [`privacy-policy.md`](./privacy-policy.md) · [`DECISIONS.md`](./DECISIONS.md) Part 3 (spec ownership) · SYC-41 (blurring), SYC-218 (spine PR 9, the round-up), SYC-63 (deletion), SYC-232 (the "has a home" push), SYC-59 (duplicate cats), SYC-52 (confidence engine), SYC-4 (native-speaker review).

**What this document owns.** Who may say a cat lives with them, what they see when they do, how a claim ends, and how a wrong one is put right. It does **not** own what a claim *is* in the record or what an owner can see:
- the `life_status: homed` observation and the owner link are the data spine's (§10.1, §10.2);
- exact location for an owner is §10.6;
- live sighting alerts for an owner are §6.4 item 4.

Dashboard actions belong to `team-access-and-welfare-queue.md`. Where this spec needs one, it says so and points there (§7). Following `DECISIONS.md` Part 3, this spec references those rules and does not restate them. Two edits to other specs follow from it, listed in §12.

---

## 1. The short version

A cat's page offers **"This is my cat"** only to someone who has **met the cat**: their phone found it, or has photographed it and confirmed the app's suggestion that it was this cat. Tapping it asks plainly, **"Is Agatha your cat?"**, and says what saying yes will do. Someone who hasn't met the cat sees a quiet line saying how. The server checks the same rule, so it holds outside the app too.

Only a cat recorded as **living on the street** can be claimed. A cat that already has a home, is in care or has died can't be.

Nobody approves a claim. Syros Cats don't have the people to vet owners, and genuine owners shouldn't wait. A claim ends in one of two ways:
- the owner says the cat **doesn't live with them any more**;
- the team, having noticed a wrong claim, **removes the owner**.

Either way the owner's abilities stop at once.

The owner's note about where the cat lives is seen only by the owner and Syros Cats (D9).

The rule stops careless and casual claims. Someone determined could still fake a meeting from a distance. That is accepted (D8, §10).

---

## 2. Why claiming has to be guarded

Saying a cat lives with you changes a lot, for everyone:

- **The cat shows "Has a home".** A street cat wrongly marked as homed drops out of the charity's sight for sterilisation and welfare work.
- **The owner sees the cat's exact spot** on its page, where everyone else sees a 250 m area (data spine §10.6, Option B, confirmed by Samuel on 6 Oct 2026).
- **The owner hears about every sighting straight away**, where everyone else gets an evening round-up with no times (§6.4 item 4).
- **The owner can rename the cat** and change the note about where it lives, for everyone.
- **Everyone who has spotted the cat is told it has a home**, by push and by a banner in the app (SYC-232).

So a claim is worth a lot to the wrong person, and does real harm when made carelessly. Examples: someone who wants to know exactly where a street cat is and when it's seen, or a tourist who reads "claim" as "collect".

**Why not have Syros Cats approve claims.** It isn't workable for the team (Samuel, 7 Oct 2026), and it makes genuine owners wait for something that is theirs. Every guard here works without the team doing anything routinely.

**What the guard is.** You can only say a cat lives with you once you have met it. A genuine owner meets their cat every day. Someone who has never been near the cat can't claim it. That stops the tourist, the careless tap and most mischief. §10 is honest about what it doesn't stop.

---

## 3. Who can say "This is my cat"

A phone can claim a cat when **all** of these hold.

**1. The cat is living on the street.** Its derived life status (data spine §10.2) is `street`, and nobody is linked as its owner.
- A cat that has a home, is in care, or has died can't be claimed (D3).
- A claim never overwrites the team's statement that a cat is in care or has died.

**2. This phone has met the cat.** At least one of its sightings qualifies. A sighting qualifies when it is all of:
- from this phone, and not unlinked by "Delete my data" (data spine §8);
- resolved to this cat, or to a cat merged into it (data spine §10.3);
- still resolved to the cat that was chosen when it was matched. A sighting the team later moved to a different cat (`choose-a-different-cat.md` §8.2) doesn't count for the new one;
- matched to this cat by the spotter, in any of the ways the app allows:
  - confirming the app's suggestion ("That's the one", `choice: suggested`);
  - choosing it from the nearby list (`choice: hand_pick`; D1);
  - being the sighting that started the cat (`choice: new_cat`);
  - an older sighting from before match records were kept (`choice: unlabelled`).

**What does not count:** a sighting not yet matched to any cat, including one waiting for Syros Cats to match it.

**No time or distance limit.** A qualifying sighting from any date counts.

**3. The same owner asking again is not a new claim.** If this phone is already the cat's owner, the claim succeeds again quietly: no new record and no new message. This keeps a retry safe after a lost reply or a double tap.

Only the claim is checked. Renaming and editing the home note follow from being the owner, as the data spine defines.

---

## 4. What the person sees

### 4.1 On the cat's page

The server tells the app, for the phone looking (and only once it has proved who it is), whether that phone **may claim** the cat. This is one field on the cat's detail, computed by the same function the claim uses. Nothing about other people's sightings or the match records leaves the server.

| Who is looking | What they see |
|---|---|
| A phone that may claim the cat | **"This is my cat"**, where the claim button has always been, styled as a secondary action rather than the page's most prominent button |
| A phone that hasn't met it, when it lives on the street | No button. One quiet line: *"Is this your cat? Spot Agatha with the camera first, then you can say Agatha lives with you."* (D2) |
| Anyone, when the cat has a home, an owner, is in care or has died | No button and no line |
| The cat's owner | The owner's edit sheet as usual, with **"Agatha doesn't live with me any more"** at its foot (§6) |
| Anyone with no connection | The button, if shown, is disabled, with *"You need a connection to do this."* |

The wording uses the cat's name rather than "he" or "she", so it never guesses.

### 4.2 Saying yes

> **Is Agatha your cat?**
>
> Only say yes if Agatha lives with you. Everyone using the app will see that Agatha has a home.
>
> **Where does Agatha live?** *(e.g. "the blue house by the church")*
>
> *Only you and Syros Cats will see this.*
>
> **[ Yes, Agatha lives with me ]** · **[ Cancel ]**

Cancel is the safe default and carries the visual weight. All wording in this spec is a **draft for Samuel's approval**.

### 4.3 After saying yes

- The cat shows "Has a home".
- The owner gets an owner's abilities (data spine §10.6, §6.4 item 4).
- People who have spotted the cat are told, the **first time** a cat is claimed. A cat that is claimed, let go and claimed again doesn't announce itself again (§8).

### 4.4 When the server says no

The page can be out of date: another phone may have claimed the cat a moment earlier. The server's answer is final. The app reads the `code` in the refusal, not just the HTTP status.

| HTTP | `code` | Why | What the person sees |
|---|---|---|---|
| 403 | `NOT_MET` | This phone hasn't met the cat | *"Spot Agatha with the camera first, then you can say Agatha lives with you."* |
| 409 | `ALREADY_HOMED` | It has a home or an owner | *"Agatha already has a home."* The page refreshes |
| 409 | `NOT_ON_STREET` | It is in care or has died | *"Agatha can't be claimed right now."* The page refreshes |
| 429 | (rate limit) | Too many claims from this phone | *"Please try again later."* |
| — | — | No connection | *"You need a connection to do this."* A claim is never saved to send later |

---

## 5. What a claim records

This is owned by the data spine. A claim writes `life_status: homed` with `authority_scope: owner_of_this_cat` and links the owner, in one transaction (§10.1, §10.2). The rule in §3 is checked **inside that transaction**, which locks the cat's row and reads the cat's status through the same transaction, so two phones can't both win. A claim can't race a team statement either.

The rule needs no new column. It is answered from records that already exist: the sightings, their match records, and merged cats.

---

## 6. The owner lets go

At the foot of the owner's edit sheet: **"Agatha doesn't live with me any more"**. A confirmation: *"Agatha will no longer show as having a home, and you won't be Agatha's owner in the app."*

Saying yes, in one transaction:
- **withdraws the owner's own statement.** It supersedes this owner's newest `homed` observation for the cat (data spine §10.1). The cat's status then falls back to whatever stood before the claim: usually "street", or whatever the team had recorded. An owner never writes a new status of their own. That respects spine §3.2, which lets an owner state `homed` only, and team-access §3.3, which says a team statement is never overwritten. See §12 for the one-line addition to spine §3.2;
- **clears the owner link.** The exact spot, live alerts and renaming stop at once;
- **clears the home note**;
- **tells nobody.**

On this phone the cat leaves the list of cats it owns straight away. The server's list is the one that counts whenever there's a connection, so a phone never keeps owner controls for a cat it no longer owns.

**An owner on a new phone** has a new identity, so the app no longer knows them as the owner. They can't let go from the new phone. The copy on the cat's page and in the help says: *"Got a new phone? Ask Syros Cats to remove the old owner, then you can say Agatha lives with you again."*

---

## 7. The team removes an owner

The team corrects a cat's life status from the dashboard (`team-access-and-welfare-queue.md` §3.3), and life status follows the newest statement (spine §10.2). **But a status correction doesn't remove the owner.** The person who claimed the cat would keep its exact spot and live alerts, while a second person would see "Lives on the street" and be refused with "already has a home".

So:
- **The team's cat page shows whether a cat has an owner.** It shows only that it does, never who: no device id and no name.
- **"Remove owner"** is an action on a cat that has one. In one transaction it:
  - clears the owner link (all owner abilities stop at once) and the home note;
  - supersedes the owner's newest active `homed` observation. If there isn't one, for example a claim made before these observations were kept, it records a plain team `street` statement instead;
  - asks, in the same step, what the cat's status should be now, with "Lives on the street" pre-selected, and records the team's choice as an ordinary team correction;
  - is recorded with who did it and when, like every team action;
  - tells nobody.
- **Setting an owned cat to "street"**, using the ordinary life-status correction, offers "Remove owner" in the same step. A correction can't then leave the stuck state described above.
- **The capability:** `remove_owner`, given to staff, and the action also needs `set_life_status` because it records a status. Both are defined in `team-access-and-welfare-queue.md` §7.3 (D6).

---

## 8. Messages and limits

- **First claim only.** People who have spotted the cat are told the first time it is claimed, never on later claims of the same cat.
- **No note in the message.** The message never includes where the cat lives (SYC-232).
- **A limit per phone.** Claims are limited to a handful a day, as an ordinary rate limit, so a phone can't claim and let go in a loop.
- **Letting go and removal tell nobody.**

---

## 9. Registering a cat without spotting it

This spec **removes the server route for registering a cat as your own without spotting it** (`POST /cats`). It is a second way to become an owner, and of a cat with no photo. No screen in the app sits on it. Removing it means:
- deleting the route, its OpenAPI entry, both generated clients and the leftover strings;
- deleting or rewriting the tests that use it as a fixture;
- correcting the docs that mention it, including spine §11 row 4 (see §12).

If a "register my cat" screen is wanted later, it comes back with its own spec (D7).

**This doesn't stop duplicates.** A phone can still photograph a cat, call it a new cat, and then claim the cat it just created, at a place it chose. That is the duplicate-cat problem, SYC-59's, not a way into an existing cat's location.

---

## 10. What this does not stop

- **Faking a meeting from a distance.** The app trusts the location a phone sends, and every cat's photo is public. So someone could save Agatha's photo, upload it as if they were at Agatha's public map position, confirm "That's the one", and claim her. **Accepted by Samuel, 8 Oct 2026 (D8).**
- **Any cat photo, within 1.5 km.** Because hand picks count (D1), someone near a cat could photograph any cat and pick this one from the nearby list. Accepted with D1.
- **Someone who really goes and spots the cat.** A person who photographs a street cat once can claim it. Samuel accepted this on 7 Oct 2026.
- **Two people at the same cat.** The first wins, and the second sees "Agatha already has a home". The team removes a wrong owner (§7).
- **A mistake nobody notices.** Nothing routinely asks the team to look. Later, the confidence engine (SYC-52) could flag a cat whose owner and recent sightings disagree.

---

## 11. What the server enforces

- **The claim route** applies §3 in full: `NOT_MET` (403), `ALREADY_HOMED` (409), `NOT_ON_STREET` (409), and the same-owner retry (200, nothing written).
  - It reads the derived status through its own transaction and locks the cat row (§5).
  - It is rate-limited per phone (§8).
- **The "may claim" field** on a cat's detail comes from the same function, only for a phone that has proved it is that device.
- **Letting go** needs the device secret, and only the current owner can do it.
- **"Remove owner"** is team-only. It needs `remove_owner` and `set_life_status`, and only works from the dashboard's own origin.
- **The home note** is moderated like names, at claim and at every edit. It appears only in the owner's view of their cat and on the team's dashboard, never in the public cat payload or in any message (D9).

---

## 12. Edits to other documents

These follow from this spec, and are made once it's approved:
- **`cat-record-data-spine.md` §3.2:** an owner may also *withdraw* their own `homed` statement (§6). §11 row 4 loses `POST /cats` (§9).
- **`team-access-and-welfare-queue.md` §3.3 and §7.3:** the "has an owner" indicator, "Remove owner", and the `remove_owner` capability (§7).
- **`privacy-policy.md`:** say plainly that an owner sees their cat's exact spot and hears about its sightings, that where an owned cat lives is seen only by the owner and Syros Cats (D9), and that letting go or deletion ends it.
- **`DECISIONS.md` Part 3:** this document owns "who may claim a cat, the claim and let-go screens, and removing an owner".

---

## 13. Adversarial review, and what changed

One Sonnet critic reviewed the first draft against the code (`reviews/claiming-a-cat-review.md`).

| Finding | Severity | What we did |
|---|---|---|
| The "met the cat" rule can be faked from a distance with the cat's public photo and a made-up location | Blocker | **Raised as D8; Samuel accepted the gap** (§10). |
| `unlabelled` doesn't mean "confirmed a suggestion" | High | **Superseded by D1.** Hand picks count, so `unlabelled` counts too (§3). |
| The home note is public, unmoderated, pushed to everyone, and kept after removal | High | **Raised as D9: owner and team only.** It's also moderated, never pushed, and cleared on let-go and removal (§6, §7, §8, §11). |
| "Let go" wrote a `street` status from an owner, which could overwrite the team's statements | High | **Accepted.** Let-go now withdraws the owner's own statement (§6). |
| Refusing homed cats broke a safe retry by the real owner | High | **Accepted.** Same-owner retry rule (§3 rule 3). |
| A cat that's in care or has died could be claimed | Medium | **Accepted.** Only `street` cats can be claimed (§3 rule 1). |
| The app never forgets an owned cat | High | **Accepted.** The server's list counts (§6). |
| The app couldn't know "I have met this cat" | Medium | **Accepted.** A "may claim" field (§4.1). |
| Claim and let-go in a loop spams everyone | Medium | **Accepted.** First-claim-only message and a limit (§8). |
| A cat could be "street" and still have an owner | Medium | **Accepted.** The team sees "has an owner", and a street correction offers removal (§7). |
| Removing `POST /cats` was understated, and new-cat-then-claim remains | Medium | **Accepted.** §9 lists the work and the remaining duplicate case. |
| "Remove owner" was under-specified | Medium | **Accepted.** §7 says which statement is superseded, the fallback, the capabilities and visibility. |
| The "met it" check needed pinning to merged cats, moved sightings and match-time choice | Medium | **Accepted.** §3 rule 2. |
| "Followers" was really every spotter, plus a banner | Low | **Fixed** (§2). |
| Read status through the transaction and lock the row | Low | **Accepted** (§5). |
| Refusals had no HTTP status | Low | **Fixed** (§4.4). |
| English says "Claim this cat"; the offline button; privacy policy gaps | Low | **Fixed** (§4.1, §12, §14). |
| A new phone can't let go or re-claim | Low | **Accepted.** "Ask Syros Cats" copy (§6). |

---

## 14. Words, in every language

The button and sheet are rewritten in all three languages. English has said "Claim this cat"; Greek and French have said **"Adopt this cat"** ("Υιοθετήστε αυτή τη γάτα", "Adopter ce chat"). Both invite the misreading this spec exists to prevent. The new wording says "This is my cat" in each language, and goes to native-speaker review (SYC-4) before release. French uses "tu".

---

## 15. Decisions (Samuel, 8 October 2026)

| | Question | Decided |
|---|---|---|
| D1 | Does a hand pick count as having met the cat? | **Yes.** Hand picks count, and so do older `unlabelled` sightings. The 1.5 km gap this opens is accepted (§10). |
| D2 | What does someone who hasn't met the cat see? | **A quiet line saying how** (§4.1). |
| D3 | Which cats can be claimed? | **Only a cat recorded as living on the street** (§3). |
| D4 | Can an owner let go of a cat themselves? | **Yes.** It withdraws only their own statement (§6). |
| D5 | Claims made before this rule | **Not applicable.** No real person has claimed a cat yet. Any test claims left on the live site are cleared before launch, as housekeeping. |
| D6 | "Remove owner" and a "has an owner" indicator on the team dashboard | **Yes** (§7). |
| D7 | Remove the register-without-spotting route | **Yes** (§9). |
| D8 | How hard to make faking a meeting from a distance | **Accept it.** Nothing built against it; recorded in §10. The options considered were refusing copies of the cat's own photos, requiring sightings on two days, and owner abilities switching on over time. |
| D9 | Who sees where an owned cat lives | **The owner and Syros Cats only.** Everyone else sees "Has a home" (§4.2, §11). |

**Copy.** All wording in §4, §6 and §7 is still a draft for approval.

---

## 16. How we'll know it works

**Server tests:**
- **Refused `NOT_MET`:** a phone with only an unmatched sighting, a sighting of a different cat, or none.
- **Succeeds:** a phone whose sighting was confirmed from a suggestion, hand-picked, started the cat, or is an older `unlabelled` one.
- **Refused for the cat's status:** a homed cat with no owner (after deletion) gets `ALREADY_HOMED`; an in-care or dead cat gets `NOT_ON_STREET`.
- **Moved and merged sightings:** a sighting later moved to a different cat doesn't qualify for the new cat; a sighting of a cat merged into this one does.
- **Repeat claims:** the same owner claiming again gets 200, with no new record and no message. Two simultaneous claims by different phones give exactly one owner. A second claim of the same cat sends no message.
- **Letting go:** it supersedes the owner's `homed`, and an `in_care` the team recorded beneath it reappears.
- **"Remove owner":**
  - on a cat with two `homed` statements;
  - on an owner from before these statements were kept;
  - and in every case the exact spot and live alerts stop for the old owner, and the action records who did it.
- **The home note:** it is moderated; it is absent from the public cat payload and every message, present for the owner and on the team's page; and it is cleared on let-go and removal.

**App tests:**
- the button and the line show to the right phones;
- Cancel changes nothing;
- each refusal shows its line;
- the button is disabled offline;
- a cat the server stops listing as owned loses its owner controls.

**Mutation probes:**
- remove the "met it" check;
- check only the owner link instead of the derived status;
- put the home note back in the public payload;
- remove the link-clearing from "Remove owner".

Each must make a named test fail.

**By hand,** in the browser at 390 px and at desktop width, with real data:
- claim as a phone that has met the cat, and try as one that hasn't;
- let go;
- remove an owner from the dashboard and confirm the exact spot is gone.
