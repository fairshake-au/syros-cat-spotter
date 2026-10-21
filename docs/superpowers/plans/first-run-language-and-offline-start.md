# Plan: first-run language and offline start (SYC-155, SYC-506)

Spec: `docs/specs/first-run-language-and-offline-start.md` (approved 21 Oct 2026: 1a, 2a, 3a, 4a, 5b). One draft PR. No server change, no migration.

## Key design choice

`username` in `DeviceContext` keeps its meaning: **the name the server has**. A new, separate `heldUsername` is the name kept on the phone and not yet saved. So every existing reader of `username` (restore warning, "Get your spots back", Home-screen nudge, offline queue gate, owned-cats hydration) keeps its behaviour without edits, and the spec's rules fall out:

- restore treats a held name as no spotter (it only looks at `username`);
- the offline queue waits until the name is saved (it already waits for `username`);
- the email offer waits for a saved name (the gate checks `username` for it).

Only the root gate, Home's greeting and the Me tab learn about `heldUsername`.

## Steps (commit after each)

1. **Language from the phone.** `lib/deviceLanguage.ts`: `pickLanguage(tags: readonly string[]): Language` (primary subtag, case-insensitive, first match of el/fr/en, else en) and `deviceLanguageTags()` (web: `navigator.languages`/`navigator.language`, guarded; native: `Intl.DateTimeFormat().resolvedOptions().locale`). `LanguageContext`: start from the stored choice, else the detected one; never store the detected one; `setLanguage` stores as today; expose `isLanguageReady`. `OnboardingGate` waits for it before the first screen. Tests: `lib/deviceLanguage.test.ts`, `context/LanguageContext` test (stored beats detected; detected not stored).
2. **Welcome switch.** `WelcomeStep`: three choices at the top (English · Ελληνικά · Français), `accessibilityRole="radiogroup"` / `radio` with selected state, labelled in their own language, white-on-Aegean with the selected one filled. Greek/French Welcome subtitle replaced (English keeps the pun). Test: tapping Ελληνικά makes How it works render in Greek.
3. **Held name in DeviceContext.** New key `cat-spotter/held-username` (added to `IDENTITY_KEYS`, so Delete my data, Start again and restore clear it; `adoptRestoredIdentity` and `startAgain` remove it explicitly), `heldUsername`, `holdUsername(name)`. `setUsername` (a saved name) clears the held one. New key `cat-spotter/name-note` for the rename note `{ from, to, reason: 'taken' | 'refused' }` (also an identity key), with `dismissNameNote()`.
4. **Phone-made suggestions.** `lib/usernameSuggestions.ts`: the server's word lists copied (comment pointing at `api-server/src/lib/usernames.ts`), `suggestLocalUsernames(n)`, `numberedVariant(name, attempt)` (truncate base so result ≤ 24), and a client `isValidUsername` mirroring `normalizeUsername`. Tests: rules obeyed, truncation, determinism with an injected random.
5. **Background save.** `lib/heldNameSave.ts`, a pure function with injected `read`/`claim`/`suggest`: read the server's name first (adopt it if set); else claim the held name; on 409 try up to three numbered variants, then a suggestion; on 400/offensive go straight to a suggestion; on timeout or network failure stop and report `retryLater` (read-first makes the next try safe). Returns `{ saved, note? }`. `hooks/useHeldNameSaver.ts` runs it when online with a held name and no saved name, at start and on reconnect, inside a web lock (`ifLockFree('cat-spotter-name-save')`) and registered in the shared claim lock (new `runBackgroundClaim(fn)` export in `hooks/useUsernameClaim.ts`, so `waitForUsernameClaimToSettle` and the editor see it). Mounted in `OnboardingGate` alongside the app. Tests: every outcome in the spec's list, plus "server says no name keeps the held name", "restore waits for it", mutation probe on the read-first step and on the "keep the held name on `retryLater`" branch (both are silent-failure guards).
6. **Name screen.** `LanguageUsernameStep`: language list removed; new subtitle. Offline: phone-made suggestion chips, typing allowed with local rule checks, button "Start spotting", the offline note; tapping holds the name. Online: unchanged (SYC-211 path). Tests: update the three existing `LanguageUsernameStep.*.test.tsx` files and add an offline test.
7. **Gate, Home, Me.** `OnboardingGate`: onboarding while neither `username` nor `heldUsername`; KeepSafe offer only when `username` is set. Home greeting falls back to `heldUsername`. Me tab: held name shown with "Not saved yet"; rename note card with Change it (focuses the editor); `UsernameEditor` disabled while a background save is open. Leaderboard "You" already works. Tests: gate with held name skips KeepSafe; Me shows note.
8. **Strings.** New keys in en/el/fr (French with tu); retire `landingOffline`, `makeItYoursSubtitle`, `languageTrilingualLabel`, `languageGlossGreek`, `languageGlossFrench` if unused. Add the Greek and French to SYC-346 (pack assembled 22 Oct) as a comment, flagged as new.
9. **Browser check** (390px and desktop, en/el/fr): scratch DB + local API + Expo web. Fresh first run with a Greek and a French browser language; first run with the API stopped, take a photo, start the API, watch name then sighting arrive; a held name already taken. Screenshots into the PR.
10. **Verify and open:** full cat-spotter vitest + typecheck locally; adversarial code review; fold fixes; `gh pr create --draft`; update SYC-155/SYC-506 with the PR link.

## Coordination

- SYC-502 chip (`local_09f187a8`) owns the KeepSafe timing block in `app/_layout.tsx`; messaged 21 Oct. Whoever lands second rebases; I'll check their branch before step 7.
- No overlap with Help tab (SYC-120/504), PR #240 (spot.tsx) or the dashboard chips.

## Model delegation

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Steps 1–7, 9, 10 (state, background save, UI, browser check) | Opus (this session) | Concurrency with the SYC-211/214 claim lock and identity storage; mistakes are silent (wrong name on the server) | Unit and component tests; mutation probes on read-first and keep-held-name branches; browser probe with the API stopped and restarted |
| Step 8, Greek and French drafts of the new strings | Sonnet subagent, returns text | Clear, small translation brief | Spot review by this session against existing app tone (tu, unaccented Greek capitals per SYC-159); Johnny's native review via SYC-346 |
| Adversarial code review of the diff | Opus subagent | Escalated: the risk is subtle races between the background save, the editor, restore and two web tabs, which need careful reasoning about timing | Findings re-checked by this session against the code; any test it says passes is re-run here |
