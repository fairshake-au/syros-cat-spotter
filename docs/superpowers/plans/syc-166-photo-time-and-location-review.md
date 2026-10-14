# Adversarial review: SYC-166 implementation plan

Reviewer tier: Sonnet (independent critic, own worktree, no sub-agents). Reviewed the plan against the approved spec and the tree at main plus the plan doc.

## Verdict: READY WITH FIXES

The plan is faithful, careful and mostly well-evidenced. There are no blockers. There is one wrong test fixture in the clock order, one honesty-rule gap that ships on Android, and several smaller things to tighten before Samuel approves.

## Blocker

None.

## Major

**M1. The "30 minutes off" GPS-clock fixture is wrong as described (plan lines 177, 141).** The plan says that without an own offset, a GPS clock 30 minutes off "is off the 15-minute grid by more than 3 minutes, so the GPS clock is distrusted". Thirty minutes is exactly two grid steps. The derived offset would be 2:30 or 3:30, which is on the 15-minute grid and inside -12:00 to +14:00, so rule 2 would ACCEPT it and shift the photo by 30 minutes. As written, the test either fails or hides a real gap. Fix: (a) keep the "own offset present, 30-minute-off GPS: photo wins" case as is; (b) for the no-offset case, state the real outcome of rule 2 for a 30-minute gap, and decide deliberately (a tighter plausibility rule, for example only +2:00/+3:00 when the phone is on Syros, or Decision B3); (c) use a 7- or 11-minute gap for the "off-grid so distrusted" case. Mutation probe 2 should then name the case that really goes red.

**M2. Slice 2 can show an untrue line on Android (plan lines 41, 165, 214).** The plan's own rule is "honest lines never get ahead of the code", yet slice 2 shows `photoNoTime` on every phone pick where no time is found. The Android picker may return an empty or absent `exif` for a JPEG (C4 is unconfirmed, and follow-up 5 admits the possibility). Then every Android library photo would say "doesn't say when it was taken" when it does. Fix: on phones, treat a missing or empty `exif` object as `unread` (no line, recorded as now), and show `photoNoTime` only when the picker returned a populated object with no usable time. Add the test and a mutation probe.

**M3. Slice 2W builds the website reader before the device check, against approved Decision 4 (spec lines 291, 111; plan lines 227-235).** The spec says "built after the device check". Samuel's condition (time first) supports a time-only reader, so the plan's A1 is defensible, but it is a departure from the spec text. It is surfaced as Decision A, which is right. Fix: say outright in the 2W header that this departs from spec Decision 4's wording and needs Samuel's explicit yes. Do not let the build start on "approve the plan" alone.

**M4. Off-island stop screen moved into slice 5: justified, but with a cost the plan does not state (plan lines 39, 507).** Justified: nothing reads a photo position before slice 5, so the screen cannot be built or honestly tested earlier. The cost is that Samuel's approved Decision 7 now depends on Decision G. If Samuel picks G2 or G3, the approved off-island stop screen is silently dropped, and so is the "photo not on Syros" protection for tourists. Fix: state this in the Decision G table and in slice 5's gate, and note that Decision 7 applies only where a position arrives.

**M5. Same-photo-twice has no way out for a legitimate retry (plan lines 156-158).** The list is written on any "sent", including photos the server rejects as "not a cat" or that fail matching. Re-picking the identical file then says "already logged", and the spotter can never retry the same photo. Fix: record the fingerprint only when the sighting was accepted as a cat photo, or add a quiet "Log it again" action. Add a test.

## Minor

**m1. Decision D1 is a redesign.** The approved text is "seen on Tuesday" with no cutoff. D1 (date after 6 days) is a good idea but needs Samuel's explicit yes. It is flagged as a decision, so this is only a reminder to keep the weekday as the default until he answers.

**m2. Future and unreadable times show "doesn't say when" (plan line 144).** A photo with a time that is merely in the future or malformed (`0000:00:00`) does say something. State which line shows; `photoNoTime` is acceptable but the PR should say so. Also name tests for blank or odd `OffsetTimeOriginal` values (`""`, `+0300`, `Z`).

**m3. Slice 4's "never replaced by a later fix" is harsh (plan line 341).** A spotter on Syros with a slow GPS (over 4 seconds) now gets Ermoupoli frozen, where today they wait for their own position. Consider letting a later on-Syros phone fix replace the start until the spotter first touches the map.

**m4. Test-to-slice mapping is inconsistent.** Line 194 says tests 6a-6d belong to slices 2W to 5, but table rows P4 and P5 assign the key-set tests to slice 2. Slice 2's mutation probes include no key-set probe. Fix: put 6a/6b in slice 2 (they are cheap) with a probe that adds a field to the request or queue item.

**m5. The XMP fix is bundled into slice 2 (plan line 173).** If sharp leaves XMP in, a real server privacy bug is fixed inside a client feature PR, and slice 2 becomes hostage to it. Ship SYC-260 as its own small server PR first (it needs nothing from slice 1). Also, SYC-260's second half (the "needs help" link carrying the photo's time) is dropped without a mention; note where it lives.

**m6. i18n "append at the end" will conflict.** Slices 2/3/4/5 and any other ticket appending at the same spot guarantee textual conflicts, not "trivial merges" (plan line 464). Say "expect a rebase" rather than promise otherwise.

**m7. Residual dedupe hole.** After storage is cleared (or reinstall), the server's exact-time repeat check still silently drops a second same-second photo and returns the first one's result. Accept it, but record it in the spec-vs-code list.

**m8. Dates.** The plan says Samuel approved on "14 October" but checks against main on "13 October" (today is 13 October). Make the dates consistent.

**m9. Small citation slip.** `useLocation.ts:23` for the web 10-second timeout is the function start; the `timeout: 10000` is a few lines later.

**m10. Model tier.** Slice 1 on Opus is not justified: ten lines, deterministic tests, five mutation probes. Run it on Sonnet and keep the probes as the assurance. For slice 5, keep Opus for the adversarial reviewer (the privacy table brief) and let Sonnet build it. The recent Opus spend makes this worth doing.

## Checked and fine

- Clock order matches the spec and Samuel's order. The own offset comes first, the GPS clock only fills a missing offset, and Athens is last. The two DST nights are correct (25 October 2026 is the last Sunday in October, and clocks go back at 04:00 summer time; 28 March 2027 is the spring jump).
- 21-day limit against the 30-day server clamp and the 30-day queue staleness: 9 days of queue life, pinned by a test. No conflict.
- Slice 1 is sufficient. I grepped the callers: the only call that passes a position is the "sent" path (`spot.tsx:487-495`). `reviewPending` (`:531-537`) and `ReviewReadyBanner.tsx:37-44` pass none. The plan's correction of SYC-258's "three call sites" is right.
- Slices 1, 3 and 4 ship alone and leave main safe. Slice 2 stands alone and is safe on the website. Slice 5 is properly gated.
- Privacy table P1-P14 is thorough, value-based, and has mutation probes. The extractor design (it returns time strings only) is the right choke point. Also checked: no analytics or error-reporting service exists in the app.
- Collisions: `reportQueue.ts` and `queueStore.ts` untouched. The `DeleteMyDataContext` single-line overlap is acknowledged. The SYC-2 branch (`origin/claude/syc-2-pr-1-2`) exists, so the diff check is real.
- Wording: no "colony carer" or "snapper". "Cat guardian" and "spotter" are used correctly. The website offline test avoids claiming a map without signal.
- Citations: I spot-checked 18 and found them accurate (`spot.tsx:290-296`, `:424`, `:449`, `:459`, `:487-495`, `:531-537`, `:854-885`; `reviewParams.ts:72-100`; `captureTime.ts:20-44`; `sightings.ts:511-521`, `:822-829`, `:868`; `offlineQueue.ts:14,56-64`; `offlineTiles.ts:19`; `notificationFanout.ts:106-127`; `cats.ts:296-307`; `catHelpers.ts:431`; `LocationPicker.tsx:30-32`).
