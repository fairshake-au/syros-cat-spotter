# Adversarial review: first-run language and offline start spec

> Independent review (Sonnet subagent, read-only), 21 Oct 2026, of `docs/specs/first-run-language-and-offline-start.md` as first drafted (commit 475b7688), against `origin/main` 7a2d83ff. Saved verbatim by the parent session. How each finding was handled is in the spec's "Review findings and how they're handled" section.

## Summary (plain English)
The idea is sound and the problems it names are real. I checked them in the code: the first three screens do start in English, and the name screen does refuse to continue offline. But the design leans on one hidden assumption. It assumes that "the phone has a name" means "the server has that name", and the app is built around that. The spec doesn't say how a name the phone holds but the server doesn't know about will be stored, kept apart from a saved name, or protected from being overwritten. It also needs several things the app doesn't have yet: a way to read the phone's language, a place to keep an unsaved name, and a way to tell a saved name from an unsaved one. It does not describe how the language switch will avoid showing English first, how the number-suffix rename fits the 24-character name limit, or how this plays with the existing username-claim safeguards. None of this is fatal, but the spec should be revised before a plan is written.

## Findings

**F1 (blocking): No state exists for "held but unsaved", and the sync gate means something else.**
Evidence: `DeviceContext.tsx:299-301` `setUsername` writes the name to AsyncStorage, and the name is then treated as claimed. `app/_layout.tsx:135` leaves onboarding as soon as `username` is non-null. `OfflineContext.tsx:~517-530` pauses queue sync only while `username === null`. That check was added for SYC-3, so a fresh "Start again" spotter can't upload before naming themselves.
Scenario: a held name makes `username` non-null. Queued sightings then upload on reconnect, possibly before the background claim, and the SYC-3 purpose of that gate is silently dropped. That may be acceptable (the server links by device, `sightings.ts:~824` inserts a profile with no username), but the spec never says so. It also needs an explicit new flag, for example `pendingUsername` kept separate from `username`, persisted under its own key. If the name goes into the existing `cat-spotter/username` key, a restore, a delete or the startup read can't tell the two states apart.
Fix: the spec must define the stored shape (`{name, saved: false}`) and list every reader of `username`: the Home greeting (`index.tsx:104-107`), restore (`restore.tsx:94,161,187,198,304`), `get-spots-back.tsx:13`, the keep-safe gate, `deleteMyData.ts`, and the Me tab editor.

**F2 (blocking): Restore and the "already here" flows treat a held name as a real spotter.**
Evidence: `restore.tsx:161,187,198,304` and `get-spots-back.tsx:13-18` show `RestoreWarning` ("you'll lose @name and N spots") whenever `username` is truthy. `restore.tsx:176-199` forces a keep or delete choice.
Scenario: an unsaved offline name makes the restore warning describe a spotter that exists nowhere on the server, and demands a keep/delete decision from someone with nothing to lose.
Fix: treat held-unsaved as "no spotter" in restore, using the new flag from F1, or say explicitly what the warning shows.

**F3 (blocking): Background claim races the existing claim machinery and the startup reconcile.**
Evidence: `useUsernameClaim.ts:40-49` keeps the claim lock as module-global state (`shared`); `finishOnClaim`/`finished` are per hook instance (`:134-148`). `LanguageUsernameStep.tsx:88-97` runs a startup read, `getClaimedUsername`, that does `setUsername(result.username)` unless `hasStarted()`.
- (a) A background claim needs the SYC-211 uncertain-name lock, or an unclear failure leaves phone and server disagreeing.
- (b) A reconcile read must never clear a held name when the server says `null`.
- (c) Restore (`restore.tsx:46`, `waitForUsernameClaimToSettle`) only waits for the shared lock. A background claim must register in it, or restore replaces identity mid-claim.
- (d) Two web tabs both claim on reconnect; a clash fallback in one tab can cause a spurious rename. Use a web lock as OfflineContext's `ifLockFree(UPLOAD_LOCK)` does.
- (e) App killed mid-save: the server's claim is idempotent for the same device (`profiles.ts:119-127`), but the retry should first read `getClaimedUsername` and adopt whatever is saved.
Fix: route the background claim through `claimAndReconcile` and the shared lock, persist the in-flight marker, always read-then-claim.

**F4 (should-fix): The numeric-suffix fallback can break the rules and silently renames people.**
`normalizeUsername` rejects names over 24 characters (`usernames.ts:15-21`); a 23-character name plus two digits is 25. An offensive name plus digits is still offensive. A 400 "invalid" isn't fixed by a number. Two phones holding `Alex` end up with `Alex` and `Alex47`, and a one-time note may be missed. No loop limit is given.
Fix: truncate the base to fit before appending; on `offensive_username` or 400 go straight to a generated name; cap retries at 3; keep the note in Me until dismissed; consider "change it now".

**F5 (should-fix): Locale detection has no implementation path in the repo as specified.**
`expo-localization` is not in `package.json`. `Intl.DateTimeFormat().resolvedOptions().locale` returns one locale, not the ordered list the "German phone, French second" example needs. `expo-localization` is a native module (rebuild). Regional tags need primary-subtag matching.
Fix: name the dependency or drop the example; give the matching rule; keep a pure `pickLanguage(list)` for unit tests.

**F6 (should-fix): Flash of English and the persistence of the detected language.**
`LanguageContext.tsx:25` starts in `'en'` and reads storage asynchronously; the language read is not part of `isReady`. Static web render has no `navigator`. The spec doesn't say whether the detected language is stored.
Fix: add a language-ready flag and hold the gate; guard for no `navigator`; store only on an explicit tap.

**F7 (should-fix): Greek phones with an English UI, and reaching the switch later.**
A tourist with a Greek-language phone is switched to Greek unasked; the Welcome switch is the escape hatch, so it must be clear and not low-contrast. Once past Welcome, only Back reaches it. The screen-reader label should name each option in its own language, with radio-group semantics.

**F8 (should-fix): Removing the language list from the name screen leaves dead code and keys.**
`LanguageUsernameStep.tsx:33,42-48,57,131-183` and keys `languageTrilingualLabel`, `languageGlossGreek`, `languageGlossFrench`, `makeItYoursSubtitle`. Test impact unchecked. A clash note built at claim time can show in the wrong language; build it at display time from stored names.

**F9 (should-fix): The offline note and button overclaim in places.**
"Sightings work as they do offline today" overreaches for a first-run spotter with nothing cached: map tiles, cat photos and the cat list need a connection or an earlier download. Say what an offline first-run spotter can actually do.

**F10 (should-fix): "Don't lose your spots", deferred as out of scope, becomes a regression.**
`_layout.tsx:136-147` shows `KeepSafeScreen` straight after a held name is set, offline, for a spotter with no server profile. Gate it on "name saved" or make a minimal fix here.

**F11 (should-fix): Leaderboard and "name shows as theirs" claims need checking.**
The leaderboard returns rows with `username: null` for devices with points; `discovererUsername` can be null. Confirm what the client renders for null.

**F12 (nit): Welcome subtitle replacement.** Fine; Greek and French go through Johnny's pack.

**F13 (nit): Missing test cases.** Idempotent re-claim of the device's own name; Me-tab editor opened during a background claim; stored `fr` on a Greek phone; a held name too long after the suffix.

## Verdict
Not ready for approval. The product direction is right and the offline start is worth doing, but the spec must first define the held-name state (F1), its effect on restore and keep-safe (F2, F10), and the claim safety rules (F3). F4, F5 and F6 are design gaps that would otherwise be found in code review. After those are added, the rest are small edits.
