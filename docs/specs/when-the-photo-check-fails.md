# When the photo check fails

**Ticket:** SYC-503 (parent SYC-501, the 18 Oct 2026 app review). **Related:** SYC-59 (duplicate cats), SYC-151 (the match record), SYC-38 (points).
**Status:** draft for Samuel's approval, 21 Oct 2026. D1 decided A and D2 decided A by Samuel, 21 Oct 2026.
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
> **[ Find this cat in the cat-alogue ]** — main button, opens the "Find the cat" picker (nearby cats first, search across the island)
> **[ Check again ]** — second button, runs the look-alike check again on the photo already sent
> *It's a new cat* — a plain text link, opens the naming screen

- **Find this cat in the cat-alogue** opens the same picker as "Find it instead" today. A pick there is an ordinary hand pick: **+15 points**, "Match confirmed", the usual questions (`choose-a-different-cat.md` §3).
- **Check again** re-runs the check. If it now works, the spotter lands on exactly the screen they would have seen first time: look-alikes, the naming screen (no look-alikes), or "not a cat". If it fails again, they stay here and see a short line, "Still couldn't check. You can pick the cat yourself, or try again later." The button stays available. Each try counts against the same limits as sending a photo (20 checks per 15 minutes per phone, and the same per-address cap; `cat-record-data-spine.md` §6.3 point 2); hitting a limit shows "You've checked a lot of photos just now. Pick the cat yourself, or try again in a few minutes."
- **It's a new cat** opens the naming screen, with a changed subtitle: "We couldn't check for look-alikes, so if this cat turns out to be one we already know, the team will join them up." The "You're the first to spot this cat" line is not shown, because we don't know that.
- **Check again is only for a failed check.** Once a check has worked, its answer is final for that sighting, so nobody can re-run it until the look-alikes go away. If the photo itself has gone (removed by the team), there is nothing to re-check: the button is hidden and only the other two actions show.
- **"Not a cat" is not claimed either.** A failed check didn't look at the photo, so the "not a cat" screen never shows on a failure.
- **Close (×)** leaves the sighting in the review list as today, where it can be finished later, including "Check again".

**Every way into the naming screen follows the check, not the button.** Whether the spotter tapped "It's a new cat", or opened the picker and chose "Add it as a new cat", or arrived from the name-taken prompt, the subtitle is the "couldn't check" one whenever the check failed. The naming screen's back arrow returns to the "couldn't check" screen. The existing "Seen this cat in the app before? Find it instead" link stays on the naming screen.

**No feeding nudge on the "couldn't check" screen.** The nudge (SYC-36) and the match-wait record (SYC-48) treat this as its own outcome: no nudge, and the wait isn't counted as a result.

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
| **A. 25 as usual (decided)** | Simplest. A spotter who really found a new cat isn't short-changed. | Pays the "first find" bonus during every outage; rewards adding duplicates |
| B. 15 now, same as a match (was recommended) | The spotter still gets the reward moment and the cat still gets added. Naming no longer pays more than picking, so there's no reason to skip the picker. Simple: one rule at resolve. | A spotter who really did find a new cat gets 10 fewer points. Rare (an outage plus a truly new cat), and small. |
| C. 15 now, top up to 25 later if an automatic re-check finds no look-alike | Fair to the genuine discoverer | Needs a background re-check job, a top-up path and a notification. Real work for a rare case. |
| D. Nothing until the team confirms | Strictest | No team step exists; the reward moment is the heart of the app and "pending" feels like an accusation (`choose-a-different-cat.md` §4.2 rejected this for the same reason) |

**Decided: A** (Samuel, 21 Oct 2026; the recommendation was B). Points stay as they are: 25 for a new cat however it was named. The screen in §2 is what steers spotters towards picking a known cat. The spotter is recorded as the cat's discoverer and it counts towards their discovery badges, even if the cat later turns out to be a duplicate; merging duplicates (SYC-59) sorts that out. **Accepted, knowingly:** anyone who sees a failed check can still choose "It's a new cat" and earn 25. A spotter can't cause a failure themselves: photos are checked for size and type before the look-alike check runs.

### D3. How long the spotter waits, and retries

Today the matching call has **no time limit of its own**: the OpenAI library's default is 10 minutes, and it retries twice on connection errors and server errors. A matcher that hangs could keep the spotter on "Checking…" for a very long time.

**Recommendation:** cap each try at 60 seconds, set on the matching call itself. Retry once only when the failure was quick (the service couldn't be reached, or answered with a server error); never retry after a timeout. So the spotter waits at most about a minute before the "couldn't check" screen. The phone has no time limit of its own, so this is the only thing protecting the wait. A check compares at most 10 nearby cats, so 60 seconds is generous; how long checks take and how often they time out is logged, so the limit can be tuned.

### D4. When there are no known cats nearby

If there are no cats within 500 m to compare, a failed check couldn't have found a look-alike anyway. But the same call is also what checks the photo shows a cat. **Recommendation:** treat it like any other failure (show "couldn't check"). It is rare, it keeps one rule, and the picker can still search the whole island.

## 4. What the server returns and records

- **The answer to sending a spot** (`POST /sightings`, and its dedupe repeat) gets two new fields. `matchCheck` is `"done"` or `"failed"`. `canRecheck` is true when a failed check can be tried again (false when the photo has gone). On `"failed"`, `candidates` is empty and `isCatPhoto` is `true`, meaning "not known"; clients must read `matchCheck` first (said in the contract). The dedupe repeat whose photo has gone answers `"failed"` with `canRecheck: false`; today it silently looks like "no look-alikes".
- **Old saved answers.** A queued item saved by an older app has no `matchCheck` and is read as `"done"`, as today. Points don't depend on what the phone thinks: the server decides them (below).
- **A new request, "check again"** (`POST /sightings/{sightingId}/recheck`). Checks in the same order as resolve, so nobody can probe another phone's sighting: 404 if it doesn't exist, 403 if the device isn't its owner, then the device secret, then 409 if it's resolved **or its stored check didn't fail**, then the per-address and per-device limits (429 with Retry-After). It re-runs the check on the photos already saved, at the sighting's own stored location (never a location sent by the phone), and answers exactly as sending a spot does, nothing more. One check per sighting runs at a time; a second request while one is running gets 409. A sighting with no photo left answers `"failed"`, `canRecheck: false`, without calling the matcher or counting against the limit.
- **The match record** keeps `matcher_failed` as today; a successful re-check sets it back to false with the new compared and suggested sets, using the existing "only until a choice is made" guard. No migration.
- **Resolve is unchanged** (D2: points stay as they are).
- **The contract** is updated in `lib/api-spec/openapi.yaml` and the client regenerated.

## 5. The offline queue

A spot saved for later is sent by the queue when signal returns. The queue stores the server's answer on the item and the item shows "Needs review"; it will now also store `matchCheck` and `canRecheck`, everywhere the answer is copied: the queued item, the "ready to review" banner, and the route to the review screen (including the route builder's fallback, which today drops everything but the sighting id). Replacing a queued photo clears them, as it already clears the candidates. Opening it shows the "couldn't check" screen if the check failed, with "Check again" working the same way (which needs signal, as every choice does; without signal the button says so). A successful "Check again" updates the stored item, so reopening it later shows the new result. A sighting whose check failed stays reachable from "recent photos" exactly like any other ("Open that sighting" while it's in review).

## 6. Out of scope (filed or to be filed)

- **Showing the team which new cats were named after a failed check**, as likely duplicates. The record already holds it; surfacing it belongs with SYC-59.
- **An outage alert** to the team when checks start failing. Logs already say so; noticing them is separate work.

## 7. Tests

Server: a failed check answers `matchCheck: "failed"` with no candidates, on a fresh send and on a dedupe repeat; the photo-gone repeat answers `"failed"` with `canRecheck: false`; a working one answers `"done"`; the timeout is applied and a timeout isn't retried; "check again" works for the owner, refuses others (403), refuses a resolved sighting and a sighting whose check worked (409), refuses a second one in flight (409), counts against the limit (429), uses the stored location, and replaces the record.

App: the route builder and reader carry `matchCheck` and `canRecheck` (missing reads as done), including the builder's fallback; a failed check opens the "couldn't check" screen, never the naming screen or "not a cat"; each of the three actions goes where §2 says; "Check again" success lands on the right screen and failure shows the line; every door into the naming screen shows the "couldn't check" subtitle after a failure, and its back arrow returns to that screen; "Check again" is hidden when `canRecheck` is false; a 429 shows the "few minutes" line; no nudge, and the wait isn't counted; the naming screen shows the spotter's photo; a queued item stores and shows the failed state, and a replaced photo clears it. Copy in English, Greek and French. Checked in the browser at 390 px and desktop, in English and Greek.

## 8. Adversarial review (21 Oct 2026, Sonnet subagent, read-only against origin/main 7a2d83ff)

All findings were accepted and folded in; finding 2 became moot when D2 was decided.

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | "Check again" on a check that worked would let a spotter re-roll the matcher until no look-alikes came back, then claim 25 points, and spend paid model calls | High | Re-check only when the stored check failed; a check that worked is final (§2, §4) |
| 2 | The match record is written best-effort; if both the matcher and the write failed, resolve would find no record and pay 25 | High | Moot after D2 was decided A (resolve is unchanged) |
| 3 | A repeat send whose photo has gone already skips the check and looks like "no look-alikes"; "Check again" would fail forever there | High | That case answers "failed" with `canRecheck: false`; the button hides (§2, §4) |
| 4 | The review route's fallback and the queue's copies drop everything but the sighting id, turning "failed" back into "done" | High | Carried through every copy, including the fallback; points are decided by the server anyway (§4, §5) |
| 5 | The limit message said "today"; the real limit is 20 per 15 minutes, plus a per-address cap | Medium | Copy changed to "in a few minutes"; re-check sits behind both limits (§2, §4) |
| 6 | Other doors into the naming screen (the picker's "Add it as a new cat", the name-taken prompt) would still show "first to spot"; no way back | Medium | Subtitle follows the check, back arrow returns (§2) |
| 7 | The feeding nudge and the match-wait record would treat a failed check as a normal result | Medium | Its own outcome: no nudge, not counted (§2) |
| 8 | The queue, banner and recent photos copy the answer without the new field; replacing a photo must clear it | Medium | All named (§5) |
| 9 | Where the time limit goes was unstated; retrying after a timeout doubles the wait | Medium | Set on the matching call, 60 s, no retry after a timeout, durations logged (D3) |
| 10 | Re-check needed an explicit check order, the stored location, and protection against two at once | Medium | Specified (§4) |
| 11 | The discoverer badge still counts a cat named after a failed check; "a spotter can always choose new cat" should be stated as accepted | Medium | Stated (D2) |
| 12 | Contract should say clients read `matchCheck` first; old saved items must still parse | Low | Stated (§4) |
| 13 | French copy also needs changing; "Which cat is it?" could read as "name the cat" | Low | French added; button is "Find this cat in the cat-alogue" (§2, §7) |
| 14 | A check that works with no cats nearby correctly shows "first to spot" | Low | No change |
| 15 | Missing test cases | Low | Added (§7) |

Checked and fine by the reviewer: `matcher_failed` is already written on failure and a hand pick on a failed check is labelled neither kind of miss; the record can be replaced until a choice is made; the matching game already leaves failed checks out; resolve already returns `pointsAwarded`; the library defaults in D3 are right for the installed version (openai 6.48.0: 10 minutes, 2 retries).
