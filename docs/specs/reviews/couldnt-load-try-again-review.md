# Adversarial review: couldnt-load-try-again.md (SYC-508)

Reviewer: independent Sonnet subagent, read-only, 24 Oct 2026, against draft 29ca4ef6. Text as returned (lightly condensed); how each finding was handled is in the last section.

react-query is ^5.90.21. The app's QueryClient uses defaults (`app/_layout.tsx:55`): 3 retries, 1+2+4 s backoff.

## Findings

1. **High: the failed state may never appear on bad signal, because there's no request timeout.** `lib/api-client-react/src/custom-fetch.ts:20-34` sets timeouts only for the username and recheck routes. Catalogue, notifications and profile requests can hang, so the spinner can stay up for ever. Even a fast failure takes about 7 s of retries, and the whole catalogue walk repeats on each retry. Fix: a 15–20 s timeout and/or `retry: 1` on these queries, plus a test for the hung request.
2. **High: `loadFailed` needs a `cacheChecked` state, and an empty saved list isn't handled.** `useCatsWithCache.ts:26, :51-58` only calls `setCached` on a hit. A missing, corrupt or failed read all leave `null`, the same as "not read yet". `readCachedCatalogue` returns `[]` for a stored empty list, and an empty `query.data` gets saved, so a failure would show the real "No cats…" message. Fix: `cacheChecked` set in `.then` and `.catch`, and treat an empty saved list as nothing saved.
3. **High: "Try again always tries, even offline" is false on web.** react-query's default `networkMode: 'online'` pauses fetches while `onlineManager` says offline (`navigator.onLine` on web), and `refetch()` ignores `enabled: false` but not the pause, so the spinner never ends. Fix: `networkMode: 'always'` on these queries, drive the spinner from the awaited promise, and add a web test with `navigator.onLine` false.
4. **Medium: `refetch` returns nothing**, so the hook can't drive the button spinner or the double-press guard (`useCatsWithCache.ts:23, :65`). After an error, v5 keeps `status: 'error'` while refetching, so `isLoading` is false during a retry.
5. **Medium: Notifications `loadFailed` must be `isError && data === undefined`.** It polls every 30 s (`NotificationContext.tsx:155-161`), and a later poll error leaves `status: 'error'` with the data still there. Non-array payloads become `[]` (:189) and would read as "No notifications yet". A missing `deviceId` (query disabled) also reads as empty. The context's `refetch` returns no promise.
6. **Medium: the review `!data` cause and copy are wrong.** `parseReviewParams` (`lib/reviewParams.ts:186-206`) returns null only for missing or bad JSON or a non-numeric `sightingId`. Params live in the URL, so a reload doesn't cause it; a bad or typed link does. "It's still on the Spot tab" is wrong for a bad link. Use neutral copy. The screen has `headerShown: false` (`_layout.tsx:73`).
7. **High: "won't be added to any cat" isn't a server guarantee, and Option A leaves the sent photo behind.** The resolve route (`sightings.ts:849-1050`) doesn't check `noCatInAnyPhoto`; the sighting stays `pending`. The claim is true of the app's own flows only. Say so, and consider a server follow-up. A sent spot's `review-<id>` photo is only deleted on finish (`review.tsx:279-280`), so Take another photo must call `deleteReviewPhoto(data.sightingId)` too.
8. **Medium: Option A side effects.** No points are lost (they're awarded at resolve). `remove` deletes the saved photo files with no confirmation; say so in the risks. After removal, the same photo can be picked again (intended; test it). `/review` is a plain stack screen, so `router.replace('/spot')` can leave a second tabs instance; prefer `dismissTo` and test Back afterwards. Nothing opens the camera automatically, so say "opens the Spot tab".
9. **Medium: other places where a failure looks empty.** In the Cat-alogue, the filter and search empties (`cats.tsx:315-322`, `emptyKey`) show "No matches" on a failed load; the failed state must come before every `emptyKey`. The map view needs its own test. Also out of scope but in the family: `cats.tsx:68` profile failure (chip and stamps), the review picker (`review.tsx:221`, same `cacheChecked` fix), `CatPicker.tsx:387`.
10. **Low: Home tiles and SYC-628.** Hiding at `firstSpot` is safe. Check the gap under the hero at 390 and 320 px. SYC-628's spec gives Profile its own Try again (its table at :184); agree who builds `LoadFailed` and which PR lands first.
11. **Low: Help "no change" is justified** (`help.tsx:43-49` falls back to the donations link). Cite §3.6 and say it was checked.
12. **Low: robustness.** Home's query key changes when the location arrives, starting a new fetch. The three callers use different keys, so Try again on one doesn't refresh the others; invalidate the catalogue root instead.
13. **Medium: copy.** The Greek register is mixed: `tryAgain` 'Δοκιμάστε ξανά' and `noNotifications` are formal, while `statsUnavailable` and `homeFirstSpotLine` are informal. Flag it for Johnny. `spotTitle` already says "Spot a cat" in all three languages. "Check your signal" is wrong when the server is down; try "Check your signal, or try again in a moment."
14. **Low: accessibility.** Follow `CatPicker.tsx:430-431` (both `accessibilityLiveRegion` and `aria-live`). Use button role with a busy state, hide the icon from screen readers, and test at 200% text size.
15. **Low: citations and tests.** Several line numbers in §1 point at the `isLoading` checks, not the empty branches. Missing tests: an empty saved list; a poll error after success; the web offline hang; the timeout; failed under the map, search and filters; Greek and French length at 320 px; Back after Take another photo; `deleteReviewPhoto` for a sent spot; a double press while busy.

**Verdict (reviewer's):** the direction is sound, but the spec isn't safe to approve as written: `loadFailed` can't tell unread from missing, Try again hangs on web offline, there's no timeout, Notifications needs `data === undefined`, the review copy is partly invented, and "won't be added" is an app-side behaviour. Fix those, add the missed empty states, settle the Greek register and coordinate with SYC-628. Recommend Option A for D1.

## How each finding was handled (in the revised spec)

All 15 accepted. Spot checks: `custom-fetch.ts:32-36` (no default timeout, but a per-request `timeoutMs` option exists at :7 and :527), no `onlineManager` or `networkMode` set anywhere in the app, `readCachedCatalogue` returns `[]` for a saved empty list (`catalogue.ts:99-106`), and `spotTitle` exists in all three languages.

- 1 → §2.4 timing: 20 s per request, one retry.
- 2, 4, 12 → §3.1: `cacheChecked`, empty saved list = nothing saved, awaitable retry, Try again refreshes every cat-alogue screen.
- 3 → §2.4: `networkMode: 'always'` on these queries; spinner from the awaited retry.
- 5 → §3.3.
- 6 → §3.4: new neutral copy, cause corrected.
- 7, 8 → §5: the claim is now about the app; the sent photo is deleted; Back-stack rule; no camera claim; server follow-up ticket.
- 9 → §3.1 (filters, search and map) and §6 (the rest filed).
- 10 → §8 coordination.
- 11 → §3.5 cites and confirms.
- 13 → `spotTitle` reused; English body reworded; register flagged for Johnny in §2.3.
- 14 → §2.2.
- 15 → §1 lines fixed; §7 tests added.
