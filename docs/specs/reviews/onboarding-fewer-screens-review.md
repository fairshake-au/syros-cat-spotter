# Adversarial review: onboarding-fewer-screens.md

Reviewer: independent subagent (Sonnet), read-only, 24 Oct 2026, against the first draft of `docs/specs/onboarding-fewer-screens.md` (commit 7ecc45f7) and the code in the same worktree. How each finding was handled is in the spec's last section.

## Findings

1. **High: the spec is stale against main, and the Profile/Settings rewrite has already merged.**
   - Spec section: the header ("Checked against `356a32b5`") and "Profile reminder" ("`profile-tab-redesign.md` on its own branch", "The Profile session is told").
   - Evidence: `origin/main` is at `d8e1c2e4`, which is SYC-628 (#296). `docs/specs/profile-tab-redesign.md` and `app/settings.tsx` are on main, and `_layout.tsx` registers a `settings` route.
   - Rule 8 ("Your spots are only on this phone") is now shipped behaviour that the change must keep working.
   - Fix: re-check the spec on `origin/main`, say that Settings exists, and add a test that Profile still hides the reminder for `skipped-onboarding`.

2. **High: setting the offer state before the name doesn't, on its own, stop the old keep-safe screen flashing.**
   - Several things set `username` while `keepSafeOffer` is still null:
     - `onClaimed` calls `setUsername` (`LanguageUsernameStep.tsx:76-79`).
     - A late reconcile in `useUsernameClaim.ts:164-169`.
     - The recover-on-mount effect (`LanguageUsernameStep.tsx:88-97`).
     - A relaunch after the claim landed.
   - The gate then renders `KeepSafeScreen`, with `showDots` and `stepIndex('keepSafe')` returning -1 once that step is removed.
   - "Keep the claimed name in the screen" can't work, because `useUsernameClaim` has no point between "claimed" and "stored".
   - Fix: write the offer value before the claim is sent, or give the gate a rule for new spotters. Either way, say what happens on a relaunch and to the typed email.

3. **High: the spec contradicts itself on the default pin.**
   - It says "No pin is placed until they choose", yet an untouched Ermoupoli start can be submitted.
   - Evidence: `spot.tsx:407-421` and `:1665`. `needsHelpCoords` only guards the "needs help" handoff.
   - Fix: require the spotter to move the map from a town start, or drop the sentence and accept the risk knowingly.

4. **High: the non-asking location hook is under-specified.**
   - Four separate `useLocation` instances (`index.tsx:51`, `cats.tsx:57`, `spot.tsx:189`, `report.tsx:55`) stay mounted, so they go stale after a grant.
   - The `loading` and `denied` values for "not granted" are undefined. If `loading` stays true, "Locating…" shows forever (`spot.tsx:1791`, `:1156`).
   - `resolveMapStart` waits unless `denied` is set.
   - Fix: one shared provider exposing `{permission, coords, loading, askAndLocate()}`, with defined values for each state and a refresh on grant.

5. **Medium: the web `'unknown'` fallback is a regression.**
   - Without `navigator.permissions`, returning web users who allowed location before lose it on Home and the Cat-alogue.
   - Fix: remember a "shared" flag, and catch errors from `permissions.query`.

6. **Medium: iOS "Allow Once" and Android permission behaviour are missing.**
   - "Allow Once" and "Only this time" reset to undetermined on the next launch.
   - iOS has no "denied but can ask again" state; Android `canAskAgain` is ambiguous before the first ask; Android approximate location gives a coarse fix.
   - Fix: add these cases, and reword "never shows again".

7. **Medium: the live camera path, the timeouts and the waiting state are unspecified.**
   - The live path is `'live'` (`spot.tsx:639`).
   - The web timeout is 10 s (`useLocation.ts:30`), not 15.
   - There is no waiting UI or way out of it, and a cached fix up to 5 minutes old is accepted without comment.

8. **Medium: the combined screen has state gaps.**
   - Typed email lost when the screen flips between offline and online.
   - Back after a confirmed claim.
   - The identity changes mid-request ("Delete my data", a restore link) with no `identityGeneration` guard.
   - The server returns 200 for an address another phone already uses.
   - A 503 `not_configured` on the test site.

9. **Medium: the button placement on screen 3 is unspecified.** The email block makes the screen scroll, and the keyboard can hide the button.

10. **Medium: "Settings" is ambiguous.** The phone's Settings (`openSettings`) and the app's new Settings screen (`keepSafeOffline`) could both appear on one screen.

11. **Medium: SYC-308 on its own, with slow GPS, gives an Ermoupoli pin after 4 s** before the card exists. This is finding 3's hazard, reachable sooner.

12. **Low: `resolveMapStart` needs permission-state and choice inputs.** Say so, and test them.

13. **Low: where is `location-choice` cleared?** Name the phone wipe step, and say whether a restore keeps it.

14. **Low: copy and test gaps.**
    - `keepSafeOptionalRest` isn't mentioned.
    - The fit measurement isn't a test.
    - Extend the wording guard (`PhotoTips.test.tsx:58`) to the new keys.
    - Missing tests: Allow Once, the identity guard, late reconcile, relaunch.

## Checked and found correct

- Welcome, `HowItWorksStep` and `SafetyStep` are as described. `HowItWorksStep.tsx:41` is onboarding's only permission ask.
- Every key named for reuse exists in en, el and fr. The retire list is accurate: `locationDenied` is used only at `spot.tsx:1633` and `:1787`.
- `useLocation` asks on mount in `index.tsx`, `cats.tsx`, `spot.tsx` and `report.tsx`. Claim's "Use where I am now" asks only on tap.
- The report flow has a default pin (`ReportWizard.tsx:150-153`).
- The gate, `startedWithName` and the offline `skipped-onboarding` (`LanguageUsernameStep.tsx:214`) are as described.
- `FirstBadgeOffer` waits for `skipped-onboarding` plus a badge.
- The camera path waits for the phone (`mapStart.ts:53-55`). The library path matches SYC-166.
- `app.json`'s location text is English only.
- `POST /keep-safe/:deviceId` needs only device auth, not a username.
- No "snapper" or "colony carer" appears in `lib/i18n.ts`.
