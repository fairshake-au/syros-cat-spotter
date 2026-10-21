# When the photo check fails

**Ticket:** SYC-503 (parent SYC-501, the 18 Oct 2026 app review). **Related:** SYC-59 (duplicate cats), SYC-151 (the match record), SYC-38 (points).
**Status:** draft for Samuel's approval, 21 Oct 2026.
**Builds on:** [`choose-a-different-cat.md`](./choose-a-different-cat.md) (the "Find the cat" picker, hand picks, points), [`offline-queue-on-web.md`](./offline-queue-on-web.md) (queued spots and the review list), [`photo-tips-and-extra-photos.md`](./photo-tips-and-extra-photos.md) (the "not a cat" screen).

## 1. The problem

When a spotter sends a photo, the app asks a vision model to compare it with the known cats within 500 m. If that call errors, times out or can't be reached, the app today behaves exactly as if the model had found no look-alikes. The spotter sees **"A new furriend! 🎉 You're the first to spot this cat. Give them a name for the cat-alogue"** for what may be a well-known cat, with only a small "Seen this cat in the app before? Find it instead" link as a way out.

Every outage therefore produces duplicate cats (SYC-59) and pays 25 "new cat" points that nobody earned. The naming screen also shows an emoji cat instead of the spotter's own photo, so they are naming a cat they can't see.

Seen locally on b205c685 (18 Oct 2026) with the matcher deliberately unreachable, uploading Tigris's own photo. Behaviour during a real outage on the live site is **unchecked**, but it runs the same code.

**What already works.** The server already writes "the check failed" into the sighting's team-only match record (`sighting_matches.matcher_failed`, SYC-151), and a hand pick on such a sighting is recorded as neither kind of matcher miss. The record needs no change. What's missing is telling the phone.

## 2. What the spotter sees

When the check fails, the spotter gets a new screen instead of the naming screen:

> **[their photo]**
> **We couldn't check this photo right now**
> Our look-alike check didn't work this time, so we can't tell if this cat is already in the cat-alogue.
>
> **[ Which cat is it? ]** — main button, opens the "Find the cat" picker (nearby cats first, search across the island)
> **[ Check again ]** — second button, runs the look-alike check again on the photo already sent
> *It's a new cat* — a plain text link, opens the naming screen

- **Which cat is it?** opens the same picker as "Find it instead" today. A pick there is an ordinary hand pick: **+15 points**, "Match confirmed", the usual questions (`choose-a-different-cat.md` §3).
- **Check again** re-runs the check. If it now works, the spotter lands on exactly the screen they would have seen first time: look-alikes, the naming screen (no look-alikes), or "not a cat". If it fails again, they stay here and see a short line, "Still couldn't check. You can pick the cat yourself, or try again later." The button stays available. Each try counts against the same per-device limit as sending a photo (`cat-record-data-spine.md` §6.3 point 2); hitting the limit shows "You've checked a lot of photos today. Pick the cat yourself, or try again tomorrow."
- **It's a new cat** opens the naming screen, with a changed subtitle: "We couldn't check for look-alikes, so if this cat turns out to be one we already know, the team will join them up." The "You're the first to spot this cat" line is not shown, because we don't know that.
- **"Not a cat" is not claimed either.** A failed check didn't look at the photo, so the "not a cat" screen never shows on a failure.
- **Close (×)** leaves the sighting in the review list as today, where it can be finished later, including "Check again".

**The naming screen shows the spotter's own photo** in place of the 🐈‍⬛ emoji, every time, failure or not. If the photo can't be loaded (an online send whose copy couldn't be kept on the phone), the emoji stays as the fallback.

## 3. Decisions

### D1. What the screen leads with

| Option | Benefits | Risks | What the spotter feels |
|---|---|---|---|
| **A. "We couldn't check", picker first, then Check again, then "It's a new cat" (recommended)** | Honest. Pushes towards the action that avoids a duplicate. Check again fixes a short outage in one tap. | One more screen in a rare case. | "Something went wrong, but I know what to do." |
| B. Today's naming screen with a warning line on top | Smallest change | Still leads with naming; people skim warnings. Duplicates continue. | "A new cat!" (wrong) |
| C. Block until the check works | No duplicates at all | A spotter during an outage can't finish anything; the sighting sits in the list. | Stuck |
| D. Retry silently a few times before showing anything | Hides short blips | The spotter already waits several seconds for a check; more waiting with no word. Covered by the timeout and the server's own retry (D3). | Long wait |

**Recommendation: A.**

### D2. Points for a new cat named after a failed check

Today a new cat earns 25 points, a match or hand pick 15. Points are paid at once, and there is no team step yet for confirming that a cat is new ("Ask Syros Cats to match it" in `choose-a-different-cat.md` §3.2 is specified but not built).

| Option | Benefits | Risks |
|---|---|---|
| A. 25 as usual | Simplest | Pays the "first find" bonus during every outage; rewards adding duplicates |
| **B. 15 now, same as a match (recommended)** | The spotter still gets the reward moment and the cat still gets added. Naming no longer pays more than picking, so there's no reason to skip the picker. Simple: one rule at resolve. | A spotter who really did find a new cat gets 10 fewer points. Rare (an outage plus a truly new cat), and small. |
| C. 15 now, top up to 25 later if an automatic re-check finds no look-alike | Fair to the genuine discoverer | Needs a background re-check job, a top-up path and a notification. Real work for a rare case. |
| D. Nothing until the team confirms | Strictest | No team step exists; the reward moment is the heart of the app and "pending" feels like an accusation (`choose-a-different-cat.md` §4.2 rejected this for the same reason) |

**Recommendation: B**, and file C as a follow-up ticket so it isn't lost. The spotter is still the cat's discoverer (they named it, and it counts towards discovery badges) because that is a fact, not a reward. The reward screen says "+15" as it does for any sighting, with no explanation; the naming subtitle (§2) has already set expectations.

### D3. How long the spotter waits, and retries

Today the matching call has **no time limit of its own**: the OpenAI library's default is 10 minutes, and it retries twice on connection errors and server errors. A matcher that hangs could keep the spotter on "Checking…" for a very long time.

**Recommendation:** cap each try at 45 seconds and allow one automatic retry (so at most about 90 seconds before the "couldn't check" screen). The spotter's own "Check again" covers anything longer.

### D4. When there are no known cats nearby

If there are no cats within 500 m to compare, a failed check couldn't have found a look-alike anyway. But the same call is also what checks the photo shows a cat. **Recommendation:** treat it like any other failure (show "couldn't check"). It is rare, it keeps one rule, and the picker can still search the whole island.

## 4. What the server returns and records

- **The answer to sending a spot** (`POST /sightings`, and its dedupe repeat) gets one new field, `matchCheck`, which is `"done"` or `"failed"`. On `"failed"`, `candidates` is empty and `isCatPhoto` is `true` (meaning "not known to be anything else"). The app must read `matchCheck` before either. An answer without the field (a queued item saved by an older app) is read as `"done"`, as today.
- **A new request, "check again"** (`POST /sightings/{sightingId}/recheck`): only the sighting's own device (device secret checked, as for resolve), only while the sighting is unresolved, counted against the per-device match limit. It re-runs the same check on the photos already saved, and answers in the same shape as sending a spot. It replaces the stored match record (already allowed until a choice is made).
- **The match record** keeps `matcher_failed` as today; a successful re-check sets it back to false with the new compared and suggested sets. No migration.
- **Resolve** awards 15 rather than 25 for a new cat when the stored record says the check failed (D2). The response's `pointsAwarded` already carries the number, so the reward screen needs no change.
- **The contract** is updated in `lib/api-spec/openapi.yaml` and the client regenerated.

## 5. The offline queue

A spot saved for later is sent by the queue when signal returns. The queue stores the server's answer on the item and the item shows "Needs review"; it will now also store `matchCheck`. Opening it shows the "couldn't check" screen if the check failed, with "Check again" working the same way (which needs signal, as every choice does; without signal the button says so). A successful "Check again" updates the stored item, so reopening it later shows the new result.

## 6. Out of scope (filed or to be filed)

- **C in D2**, an automatic later re-check with a points top-up.
- **Showing the team which new cats were named after a failed check**, as likely duplicates. The record already holds it; surfacing it belongs with SYC-59.
- **An outage alert** to the team when checks start failing. Logs already say so; noticing them is separate work.

## 7. Tests

Server: a failed check answers `matchCheck: "failed"` with no candidates, on a fresh send and on a dedupe repeat; a working one answers `"done"`; the timeout is applied; "check again" works for the owner, refuses others (403), refuses a resolved sighting (409), counts against the limit (429), and replaces the record; resolve pays 15 for a new cat after a failed check and 25 otherwise, and still pays 25 when a re-check succeeded.

App: the route builder and reader carry `matchCheck` (missing reads as done); a failed check opens the "couldn't check" screen, never the naming screen or "not a cat"; each of the three actions goes where §2 says; "Check again" success lands on the right screen and failure shows the line; the naming screen shows the spotter's photo; a queued item stores and shows the failed state. Checked in the browser at 390 px and desktop, in English and Greek.

## 8. Adversarial review

*(to be added)*
