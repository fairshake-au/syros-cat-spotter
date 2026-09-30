# SYC-39: how far away should the app look for a matching cat?

**Status:** decision needed from Samuel. No code has changed.
**Date:** 30 September 2026

## Why this stopped before any code

SYC-39 asks for a simple rule: when a spotter photographs a cat, only compare it with cats within 500 m. Three documents say different things about that rule, so building it now would mean picking a winner without you.

| Source | What it says |
|---|---|
| `PRODUCT-SPEC.md` §1 and §2.3 (1 September meeting) | **500 m, confirmed** with Syros Cats. |
| The proposal Syros Cats read (§4) | The app "only compares against cats seen within about 500 metres", and asks them to say if 500 m is wrong for Syros. |
| `cat-record-data-spine.md` §6.3, the spec that owns matching | For privacy, the distance is measured between **blurred** positions (each snapped to its 250 m map square), and the distance becomes **750 m** to make up for the blurring. |
| Data spine plan, PR #23, conflict C3 | Recommends 750 m on the blurred squares, in PR 5, and closing SYC-39 as superseded. |

What is already settled, and not part of the question:

- **When no cat is close enough, the spotter goes straight to "add a new cat".** The app already does this when the list comes back empty (`artifacts/cat-spotter/app/review.tsx`, line 257). Nothing to build.
- **At most ten cats are compared, closest first, within the distance limit.** The ticket says so and nothing contradicts it. This also caps the cost of each spot, whatever the distance.
- **The privacy fix in §6.3 is not optional.** Measuring distance on exact positions lets a stranger find a cat's real location by resubmitting its photo from different spots. That has to be closed before launch (PR 5).

## What today's app does

It compares the photo with the ten nearest cats anywhere on the island, however far away. With a small catalogue that means a photo taken in Ermoupoli can be compared with a cat from Kini. The vision model still picks the match, so this mostly costs money and occasionally offers an unlikely lookalike.

## Something the 750 m figure gets wrong

Snapping each position to its 250 m square can move it by up to about 177 m (corner to centre). When both the spotter's position and the cat's are snapped, the measured distance can be out by up to about 354 m in either direction.

So "750 m on the blurred squares" means:

- every cat within about **400 m** of the photo is always compared;
- a cat **between about 400 m and 500 m** away can be missed, if the squares fall badly;
- a cat up to about **1.1 km** away can be included.

That breaks the promise Syros Cats were given ("within about 500 metres") at the edges. To guarantee that every cat within 500 m is always compared, the blurred distance needs to be about **850 m**. Because only the ten closest are compared anyway, the extra reach adds no cost per spot.

## The second open question: measured from where?

A cat has one stored position: **where it was first spotted**. You deferred a "where it usually is" position on 28 September (SYC-80). So until SYC-80 lands, any distance rule measures from the first sighting. A cat first photographed at the ferry and now living up the hill may fall outside the limit and not be offered, and the spotter may add it again as a new cat. SYC-119 (let people pick a different existing cat when matching misses) is the safety net for that.

The proposal's wording, "cats *seen* within about 500 metres", would be closer to measuring from any recent sighting. That is SYC-80's job, not this ticket's.

## Options

### A. Close SYC-39; the limit arrives with the privacy fix, at 750 m as the spec says

- **Spotters notice:** nothing until PR 5 ships. Then fewer far-away lookalikes.
- **Benefits:** no throwaway code; one change to matching instead of two; follows the approved spec and plan.
- **Risks:** the 400–500 m gap above. A cat that close can occasionally be left out and added twice. It also quietly contradicts what Syros Cats were told.

### B. Ship a 500 m limit on exact positions now, then replace it in PR 5

- **Spotters notice:** during testing, only nearby cats offered. Otherwise little.
- **Benefits:** the rule Syros Cats agreed is live during testing; slightly cheaper spots now.
- **Risks:** the code is thrown away within weeks, and it touches the same function PR #24 and PR 5 are changing. It does nothing for privacy. It tightens matching before SYC-119 exists, so more duplicates during testing.

### C. Use 500 m, but on the blurred squares (PR 5)

- **Spotters notice:** real neighbours sometimes not offered.
- **Benefits:** the number matches the one Syros Cats heard.
- **Risks:** it only guarantees cats within about 150 m. Genuine matches would be missed often, which means duplicate cats. Not recommended.

### D. Close SYC-39; in PR 5, set the blurred distance to about 850 m so every cat within 500 m is always compared (recommended)

- **Spotters notice:** nothing until PR 5. Then nearby cats are offered and cats from across the island are not.
- **Benefits:** keeps the promise to Syros Cats exactly; keeps the privacy fix; costs nothing extra because the ten-cat cap stays; one change to matching, made once, by the plan that already owns it.
- **Risks:** a cat up to about 1.2 km away can occasionally be offered as a lookalike. The vision model rules most of these out, and a far-away lookalike is a much smaller harm than a missed match, which makes a duplicate record. Until SYC-80, distance is measured from where the cat was first spotted.

## Recommendation

**D.** Keep the charity's 500 m as the promise, and make the privacy-safe version keep it: change the 750 m in data spine §6.3 and PR #23's PR 5 to "about 850 m, so that every cat within 500 m is always included", measured from the first-spotted position until SYC-80. Then close SYC-39 as superseded by PR 5. The proposal wording can stay as it is.

If you choose D, the follow-ups are: amend §6.3 and plan PR 5 (the number and the reason), and add to PR 5's tests "a cat 499 m away is always a candidate, wherever the squares fall".
