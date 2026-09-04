# Syros Cats' standard reply to a cat-in-distress enquiry

**Source:** Susan, Syros Cats. Provided by Samuel 3 September 2026.
**Status:** canonical. This replaces the placeholder in `team-access-and-welfare-queue.md` §5.
**Do not paraphrase the substance.** The app's capacity messaging must say the same things this says, in the app's own voice.

---

## The reply, verbatim

Hello,

Thank you for your concern for this cat. Because we are a private sanctuary and not an emergency service, we are unable to provide immediate rescue or collection. Our small team is currently at full capacity caring for the residents already at the sanctuary.

The most effective way to help this cat right now is for you to intervene directly. In Syros, our local veterinarians are very supportive. You can visit any of the clinics listed below to borrow a transport cage. Once the cat is in the cage, please take them directly to the vet for an assessment.

**Local Veterinary Services in Syros:**

* **Symviosis (Vorrisis Manolis)** – Talanta (Opposite Shell petrol station)
  Map: https://maps.app.goo.gl/kX7H8Y8Z8P6u5j7z9
  Contact: +30 22810 77929 / +30 6970 055012
* **Dermitzaki Irini** – Lazareta
  Map: https://maps.app.goo.gl/U6W9b1wN7Bv3Lp9Z7
  Contact: +30 22813 06720 / +30 6986 705837
* **George Maragkos** – Mana (Opposite AVIN petrol station)
  Map: https://maps.app.goo.gl/S4m7T8u7L7v4R9K7A
  Contact: +30 22810 79439 / +30 6937 252802

**Important Steps:**

1. **Borrow a Cage:** Call the nearest vet above and ask to borrow a "trap" or "carrying cage" (metaforas).
2. **Secure the Cat:** Use strong-smelling food (sardines or wet food) to lure the cat into the cage if you cannot handle the cat.
3. **Medical Assessment:** The vet can check for a microchip and assess injuries.

Under Greek law, the Municipality of Syros-Ermoupoli (Contact: +30 2281 361000) is ultimately responsible for the care of strays. If the vet confirms the cat needs long-term care, you should also notify the local municipality animal welfare office. They might be able to help financially, but please be aware that this is typically on a case-by-case basis depending on their current funding.

Thank you for being the person on the scene who can make a difference today.

Best wishes,
Susan

---

## What this changes in the specs

### 1. The injured-cat guidance is now wrong and must be rewritten

`team-access-and-welfare-queue.md` §5 currently leads with **"drop a towel over it, never bare hands"**. Susan's actual advice is different and safer:

- **Primary route: borrow a transport cage from a vet.** Call the nearest clinic and ask for a "trap" or "carrying cage" (*metaforas*). This is the mechanism the charity actually uses and it was entirely absent from the spec.
- **Lure, don't grab.** Strong-smelling food — sardines or wet food — to get the cat into the cage.
- **Handling is the fallback, not the plan.** Susan's wording is *"if you cannot handle the cat"*, so the towel advice belongs after the cage, not instead of it.

This is better than what the spec invented: it keeps hands away from a frightened animal entirely, and it routes the person to a vet who can also check for a microchip.

### 2. F1 is confirmed in the charity's own words

*"Because we are a private sanctuary and not an emergency service, we are unable to provide immediate rescue or collection. Our small team is currently at full capacity."*

The no-alarm decision (F1) and the vet-first capacity messaging are exactly right. The app's copy should echo this framing — expectation-setting up front, not an apology after a delay.

### 3. New: the Municipality is legally responsible, and the app never mentioned it

Under Greek law the **Municipality of Syros-Ermoupoli (+30 2281 361000)** is ultimately responsible for stray care, and may help financially case by case. This is a third route the specs do not have at all. It belongs in the report flow for cats needing long-term care, and it is useful for the media one-pager (SYC-27/SYC-28) as the honest answer to "why is a charity doing this?"

### 4. The vet list should live in configuration, not in the copy

Three clinics with names, areas, landmarks, two phone numbers each and a map link. Clinics change, numbers change, and a wrong number in front of someone holding an injured cat is worse than no number. Serve this from the same configuration file as the rest of the capacity copy so it is a data edit, not a release.

---

## Still open — do not ship without these

1. ~~**Out-of-hours cover is not addressed.**~~ **Answered by the verification pass, 4 September 2026 — see `syros-vets-verified.md`.** Two of the three clinics publish an out-of-hours contact on their own material: Symviosis (+30 697 005 5012) and Cyclades Vets (+30 6937 252802, advertised as 24/365). The app now names both and explicitly promises nothing, because nobody has rung them. What is left is a phone call, not a copy decision.
2. ~~**The three map links must be verified before shipping.**~~ **Resolved by replacement.** The `maps.app.goo.gl` short links were never testable and are not reused. Every link in the spec is now a plain coordinate URL that can be checked by reading it. The remaining caveat is that the coordinates are landmark-anchored to the petrol stations the clinics sit opposite — good to 50–100 m — and want ten minutes from somebody standing outside each door.
3. ~~**Phone numbers need checking** against a second source.~~ **Done. Every number in this reply checks out**, against the clinics' own sites or two independent sources. The one correction is a name, not a number: the third clinic trades as **Cyclades Vets (George Maragkos)**, not under his name alone.
4. **Translation.** This is the copy people act on, so Greek and French matter more here than anywhere else in the app.
