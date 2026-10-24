# SYC-524: onboarding in three screens, location asked at the first photo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new spotter reaches the camera after three screens, and the app asks for location only at the first camera photo, after explaining why, with the map always available.

**Architecture:** One `LocationProvider` replaces the four separate `useLocation()` instances. It reads permission without asking and exposes `askAndLocate()`, the only way the Spot screen brings up the phone's box. Pure rules live in `lib/` (`locationPermission.ts`, `locationChoice.ts`, `locationAsk.ts`, `mapStart.ts`) and are unit-tested by value. Screens under `app/` are checked by the source-reading tests the repo already uses (`lib/__tests__/spotMapStart.test.ts` pattern), because `app/` is outside vitest's render paths. Onboarding becomes `welcome → safety → name`. The name screen adds the email first, then claims the name.

**Tech Stack:** Expo / React Native (web + iOS + Android), expo-location, AsyncStorage, vitest + @testing-library/react (jsdom), pnpm.

**Spec:** `docs/specs/onboarding-fewer-screens.md` (approved 24 Oct 2026; DECISIONS.md Part 2s). Review: `docs/specs/reviews/onboarding-fewer-screens-review.md`.

## Global Constraints

- Copy rules: "spotter" never "snapper"; "cat guardian" never "colony carer". French uses *tu*. Every new key exists in `en`, `el` and `fr` in `lib/i18n.ts`, and goes into Johnny's pack (SYC-346).
- No new words on the onboarding screens apart from `safetyDontFeedBody`, which is today's `howStepDontFeedBody` minus its last sentence, in all three languages.
- Safety text (`howSafety*`) is used word for word. The safety screen has no Skip.
- Welcome and the safety screen fit 390×844 without scrolling in en, el and fr. The name screen may scroll; **Start spotting** is pinned and visible with the keyboard open.
- Nothing brings up the phone's or browser's location box on mount, except `app/report.tsx`.
- Timeouts unchanged: a cached fix up to 5 minutes old, a fresh fix within 15 s (native) or 10 s (web).
- Open every PR as a draft (`gh pr create --draft`). Run the affected tests locally before pushing (ESBUILD_BINARY_PATH workaround from memory `local-vitest-esbuild`). Run the full `artifacts/cat-spotter` suite before `gh pr ready`. Stacked PRs stay draft until the PR below merges.
- Build only after SYC-509's PR fairshake-au/syros-cat-spotter#301 has merged (it edits `WelcomeStep.tsx`, `SafetyStep.tsx`, `LanguageUsernameStep.tsx` and `spot.tsx`). Keep its roles and labels on the new screens.
- Commit after each task. Keep a `CHECKPOINT.md` in the worktree root (`git add -f`; `git rm` before each PR opens).

## Review Focus

1. **A name arriving by a route other than the screen's own claim** (late reconcile, recover-on-mount, relaunch after a landed claim) must never show the old keep-safe screen. The test is in Task 9; the gate backstop is in Task 10.
2. **Permission changed outside the app** (Settings, browser site settings) and the spotter comes back. The provider re-reads on foreground or visibility; the test is in Task 2.
3. **iOS "Allow Once" reset** with `'shared'` remembered skips the card and asks straight after the photo. Tests are in Tasks 4 and 5.
4. **A browser without `navigator.permissions`, or one where `query` throws.** Never crash, never prompt on mount; use the remembered `'shared'`. Tests are in Task 1.
5. **The identity changes mid-save** on the name screen ("Delete my data", a restore link). The late result is ignored. The test is in Task 9.

---

## PR 1 — SYC-308: camera photo with location off starts in Ermoupoli (prerequisite, own ticket)

### Task 0: Camera and live paths fall back to Ermoupoli

**Files:**
- Modify: `artifacts/cat-spotter/lib/mapStart.ts` (`resolveMapStart`)
- Test: `artifacts/cat-spotter/lib/__tests__/mapStart.test.ts`

**Interfaces:**
- Produces: `resolveMapStart` returns `town()` for `source: 'camera' | 'live'` when `phone.denied` is true, or when `waitedMs >= MAP_START_WAIT_MS` with no coords. A phone fix off Syros on the camera path stays as the phone (unchanged; only library checks `isOnSyros`).

- [ ] **Step 1: Write the failing tests** in `mapStart.test.ts`:
  - `it('camera: refused location starts in Ermoupoli')` → `resolveMapStart({ source: 'camera', phone: { coords: null, denied: true, loading: false }, waitedMs: 0 })` equals `{ status: 'ready', coords: ERMOUPOLI, origin: 'town' }`.
  - The same for `'live'`.
  - `it('camera: still searching after the wait starts in Ermoupoli')`, with `waitedMs: MAP_START_WAIT_MS`.
  - `it('camera: still searching before the wait waits')`, with `waitedMs: 0` and `denied: false` → `{ status: 'waiting' }`.
- [ ] **Step 2:** Run `pnpm exec vitest run lib/__tests__/mapStart.test.ts`. Expected: the 3 new Ermoupoli cases fail.
- [ ] **Step 3:** Change the `source !== 'library'` branch: coords → phone; else `phone.denied || waitedMs >= MAP_START_WAIT_MS` → `town()`; else waiting. Update the file comment ("The camera is unchanged" becomes SYC-308).
- [ ] **Step 4:** Run `mapStart.test.ts` and `spotMapStart.test.ts`. Expected: all pass.
- [ ] **Step 5:** In the web preview at 390px, with location blocked in the browser, take a live-view photo. The map appears in Ermoupoli with `mapStartedInTown`, and **Check for matches** is enabled. Save the screenshot to `docs/screenshots/syc-308/`.
- [ ] **Step 6:** Commit `SYC-308: camera photo with location off starts the map in Ermoupoli`. Open a draft PR; it can go into the 26 Oct store build (no new words).

---

## PR 2 — one location state that never asks on mount

### Task 1: Read permission without asking

**Files:**
- Create: `artifacts/cat-spotter/lib/locationPermission.ts`, `artifacts/cat-spotter/lib/locationChoice.ts`
- Test: `artifacts/cat-spotter/lib/__tests__/locationPermission.test.ts`, `lib/__tests__/locationChoice.test.ts`

**Interfaces:**
- Produces:
  - `type LocationPermission = 'granted' | 'denied-can-ask' | 'denied-final' | 'not-asked'`
  - `mapNativePermission(r: { status: 'granted' | 'denied' | 'undetermined'; canAskAgain: boolean }): LocationPermission`
  - `mapWebPermission(state: 'granted' | 'denied' | 'prompt' | null, choice: LocationChoice): LocationPermission`, where `null` means the API is missing or threw
  - `getLocationPermission(choice: LocationChoice): Promise<LocationPermission>`, which never prompts
  - `type LocationChoice = 'map' | 'shared' | null`
  - `LOCATION_CHOICE_KEY = 'cat-spotter/location-choice'`
  - `readLocationChoice(storage): Promise<LocationChoice>`, `writeLocationChoice(storage, c: 'map' | 'shared')`, `clearLocationChoice(storage)`

- [ ] **Step 1: Write the failing tests.**
  - Native:
    - `granted` → `'granted'`
    - `undetermined` (either `canAskAgain`) → `'not-asked'`
    - `denied` + `canAskAgain: true` → `'denied-can-ask'`
    - `denied` + `false` → `'denied-final'`
  - Web:
    - `granted` → `'granted'`; `denied` → `'denied-final'`; `prompt` → `'not-asked'`
    - `null` with choice `'shared'` → `'granted'`; `null` with `'map'` or `null` → `'not-asked'`
  - `getLocationPermission` on web:
    - with `navigator.permissions` undefined → not-asked, and `getCurrentPosition` is never called;
    - with `query` rejecting → not-asked, no throw.
  - Choice:
    - round-trips `'map'` and `'shared'`;
    - an unknown stored value reads as `null`;
    - `clearLocationChoice` removes the key.
- [ ] **Step 2:** Run both files. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement. Native calls `Location.getForegroundPermissionsAsync()` (never `request…`). Web wraps `navigator.permissions.query({ name: 'geolocation' })` in try/catch.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 2: `LocationProvider`

**Files:**
- Create: `artifacts/cat-spotter/context/LocationContext.tsx`
- Modify: `artifacts/cat-spotter/app/_layout.tsx` (wrap inside `DeviceProvider`, next to `OfflineProvider`)
- Delete: `artifacts/cat-spotter/hooks/useLocation.ts` (once Task 3 has moved every caller)
- Test: `artifacts/cat-spotter/components/__tests__/LocationProvider.test.tsx`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `useAppLocation(): { permission: LocationPermission; coords: Coords | null; loading: boolean; denied: boolean; choice: LocationChoice; askAndLocate(): Promise<Coords | null>; chooseMap(): void }`
    - `denied` is `permission === 'denied-final' || permission === 'denied-can-ask' || lastAskTimedOut`. It is kept so `resolveMapStart` and `ReportWizard` read the same shape.
    - `loading` is true only while a read or an ask is running.
  - `askAndLocate` requests permission (native `requestForegroundPermissionsAsync`; web `getCurrentPosition`, which prompts), then reads the position as `useLocation` does today: cached fix within 5 min, a fresh fix within 15 s native or 10 s web.
    - On a fix it writes the choice `'shared'`.
    - On a timeout it returns null and sets `lastAskTimedOut`.
    - On success every consumer re-renders with `permission: 'granted'` and the coords.
  - `chooseMap()` writes `'map'`.

- [ ] **Step 1: Write the failing tests** (mock `expo-location` and `navigator.geolocation`):
  - `never asks on mount`: render the provider with permission `undetermined`. `requestForegroundPermissionsAsync` and `getCurrentPosition` are not called; `loading` is false and `coords` null.
  - `reads the position on mount when already granted`: `getCurrentPositionAsync` is called and `coords` is set.
  - `askAndLocate grants and shares with every consumer`: two consumers; after `askAndLocate()` both see the coords, and the stored choice is `'shared'`.
  - `askAndLocate refused`: `permission` becomes `'denied-final'` (mock `canAskAgain: false`), `denied` is true and `coords` stays null.
  - `askAndLocate timeout`: fake timers past 15 s → null, `denied` true.
  - `re-reads permission on return to the app` (Review Focus 2): fire AppState `active` after the mock flips to granted → `coords` set with no ask.
  - On web: fire `visibilitychange`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the provider. Move the position-reading code from `hooks/useLocation.ts` (`getWebPosition`, the cached-then-fresh race) into it unchanged, except that it never requests on mount.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 3: Move every caller to the provider

**Files:**
- Modify: `app/(tabs)/index.tsx:51`, `app/(tabs)/cats.tsx:57`, `app/(tabs)/spot.tsx:189`, `app/report.tsx:55`
- Test: `artifacts/cat-spotter/lib/__tests__/locationCallers.test.ts` (source-reading, like `spotMapStart.test.ts`)

**Interfaces:**
- Consumes: `useAppLocation` (Task 2).
- Produces:
  - Home and the Cat-alogue read `{ coords }` only.
  - `report.tsx` calls `askAndLocate()` once in a mount effect, the only screen that asks on open, and reads `{ coords, loading, denied }`.
  - Spot reads `{ coords, denied, loading, permission, choice, askAndLocate, chooseMap }`. Until Task 5 it calls `askAndLocate()` on mount, to keep today's behaviour.

- [ ] **Step 1: Write the failing source tests:**
  - no file under `app/` or `components/` imports `@/hooks/useLocation`;
  - `index.tsx` and `cats.tsx` contain `useAppLocation()` and do not contain `askAndLocate`;
  - `report.tsx` contains `askAndLocate()` inside a `useEffect`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Switch the four screens. Delete `hooks/useLocation.ts`. Remove its mocks from tests that referenced it (`grep -rn "hooks/useLocation" components/__tests__ lib/__tests__`) and point them at `@/context/LocationContext`.
- [ ] **Step 4:** Run the full suite with `pnpm exec vitest run`. Expected: PASS.
- [ ] **Step 5:** In the web preview with a cleared browser, Home and the Cat-alogue open with no browser location prompt; Spot still prompts on open (until PR 3). Commit, then open draft PR 2 stacked on PR 1.

---

## PR 3 — the location card at the first camera photo

### Task 4: What the Spot screen shows for location

**Files:**
- Create: `artifacts/cat-spotter/lib/locationAsk.ts`
- Modify: `artifacts/cat-spotter/lib/mapStart.ts`
- Test: `lib/__tests__/locationAsk.test.ts`, `lib/__tests__/mapStart.test.ts`

**Interfaces:**
- Produces:
  - `type LocationAskView = 'none' | 'card' | 'link' | 'off-native' | 'off-web' | 'auto-ask'`
  - `locationAskView(input: { source: PickSource | null; hasPhoto: boolean; permission: LocationPermission; choice: LocationChoice; platform: 'web' | 'native'; answeredThisPhoto: boolean }): LocationAskView`
  - `resolveMapStart` gains `ask: LocationAskView`. When `ask === 'card'` it returns `{ status: 'waiting' }` (no pin, **Check for matches** disabled). When the spotter chose the map on this photo (`'link'` with `answeredThisPhoto`), or the view is `'off-native'`/`'off-web'`, it returns `town()` straight away.

- [ ] **Step 1: Write the failing table test** `locationAskView` (each row one `it`):

| source | hasPhoto | permission | choice | platform | answered | → |
|---|---|---|---|---|---|---|
| null | false | not-asked | null | native | false | none |
| library | true | not-asked | null | native | false | none |
| camera | true | granted | any | native | false | none |
| camera | true | not-asked | null | native | false | card |
| live | true | not-asked | null | web | false | card |
| camera | true | not-asked | shared | native | false | auto-ask |
| camera | true | not-asked | map | native | false | link |
| camera | true | denied-can-ask | map | native | false | link |
| camera | true | denied-can-ask | null | native | false | card |
| camera | true | denied-can-ask | shared | native | false | link |
| camera | true | denied-final | any | native | false | off-native |
| camera | true | denied-final | any | web | false | off-web |
| camera | true | not-asked | null | native | true | link |

  Plus the `resolveMapStart` cases:
  - `ask: 'card'` → waiting, even with `waitedMs` past the wait;
  - `'off-native'` → town at `waitedMs: 0`;
  - `'none'` with granted coords → phone;
  - the library rows unchanged (every existing test still passes).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement `locationAskView` and the `resolveMapStart` input.
- [ ] **Step 4:** Run `locationAsk.test.ts`, `mapStart.test.ts` and `spotMapStart.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 5: The card on the Spot screen

**Files:**
- Create: `artifacts/cat-spotter/components/spot/LocationAskCard.tsx`
- Modify: `artifacts/cat-spotter/app/(tabs)/spot.tsx` (remove the mount ask from Task 3; remove both `locationDenied` lines at today's `:1630` and `:1784`; render the card, link or "off" line above the map under "Where did you see it?"; pass `ask` to `resolveMapStart`; reset `answeredThisPhoto` with each new photo, where `resetMapStart` runs)
- Modify: `artifacts/cat-spotter/lib/i18n.ts` (new keys below; retire `locationDenied`)
- Modify: `artifacts/cat-spotter/context/DeleteMyDataContext.tsx` (`wipePhone`: `await clearLocationChoice(AsyncStorage)` next to `clearPhotoTipsSeen`)
- Test: `components/__tests__/LocationAskCard.test.tsx`, `lib/__tests__/spotLocationAsk.test.ts` (source), `lib/__tests__/deleteMyData.test.ts`

**Interfaces:**
- Consumes: Tasks 2 and 4.
- Produces: `<LocationAskCard view={'card' | 'link' | 'off-native' | 'off-web'} busy={boolean} onUse={() => void} onMap={() => void} onOpenSettings={() => void} />`
  - `'card'` shows the heading, the line and both buttons. While `busy`, the first button reads `t('locating')` and is disabled; **I'll put the pin on the map** stays enabled.
  - `'link'` shows only a **Use where I am** link.
  - `'off-native'` shows the line and **Open Settings** (`Linking.openSettings()`).
  - `'off-web'` shows the line only.

New keys (en / el / fr; el and fr are drafts for Johnny):

| Key | en | el | fr |
|---|---|---|---|
| `locAskTitle` | Use where you're standing? | Να βάλουμε το σημείο όπου βρίσκεσαι; | On utilise l'endroit où tu es ? |
| `locAskBody` | We'll put the pin where you are now, so Syros Cats know where this cat lives. You can move it after. | Θα βάλουμε την πινέζα εκεί που είσαι τώρα, για να ξέρει η Syros Cats πού ζει αυτή η γάτα. Μπορείς να τη μετακινήσεις μετά. | On place l'épingle là où tu es maintenant, pour que Syros Cats sache où vit ce chat. Tu pourras la déplacer ensuite. |
| `locAskUse` | Use where I am | Χρησιμοποίησε το σημείο μου | Utiliser ma position |
| `locAskMap` | I'll put the pin on the map | Θα βάλω εγώ την πινέζα στον χάρτη | Je place l'épingle moi-même |
| `locOffNative` | Location is off for Cat Spotters. Move the pin yourself, or turn location on in your phone's Settings. | Η τοποθεσία είναι κλειστή για το Cat Spotters. Μετακίνησε μόνος/η σου την πινέζα ή άνοιξε την τοποθεσία στις Ρυθμίσεις του κινητού σου. | La localisation est désactivée pour Cat Spotters. Déplace l'épingle toi-même, ou active la localisation dans les réglages de ton téléphone. |
| `locOffWeb` | Your browser is blocking location for this site. Move the pin yourself, or allow location from the address bar. | Ο browser σου μπλοκάρει την τοποθεσία για αυτόν τον ιστότοπο. Μετακίνησε μόνος/η σου την πινέζα ή επίτρεψε την τοποθεσία από τη γραμμή διευθύνσεων. | Ton navigateur bloque la localisation pour ce site. Déplace l'épingle toi-même, ou autorise la localisation depuis la barre d'adresse. |

- [ ] **Step 1: Write the failing tests.**
  - Card component, one test per view:
    - correct strings and buttons;
    - `busy` disables only the first button;
    - `onUse`, `onMap` and `onOpenSettings` fire.
  - Source test for `spot.tsx`:
    - no `askAndLocate()` inside a mount `useEffect`;
    - no `t('locationDenied')`;
    - `locationAskView(` is called with `answeredThisPhoto`;
    - an `'auto-ask'` view calls `askAndLocate()` from an effect keyed on the photo (Review Focus 3);
    - `resolveMapStart({` receives `ask`.
  - i18n: the six keys exist in en, el and fr; extend the existing wording guard (`PhotoTips.test.tsx:58` pattern) to them.
  - `deleteMyData.test.ts`: `wipePhone` removes `LOCATION_CHOICE_KEY`; a source check that `adoptRestoredIdentity` (`DeviceContext.tsx`) never touches it, so "Get your spots back" keeps the choice.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. `onUse` sets `answeredThisPhoto` and calls `askAndLocate()`. `onMap` calls `chooseMap()` and sets `answeredThisPhoto`.
- [ ] **Step 4:** Run the full suite. Expected: PASS.
- [ ] **Step 5: Browser check** at 390px and desktop, en/el/fr, from a cleared browser:
  - live-view photo → card → **Use where I am** → allow → pin at the browser position;
  - repeat with block → `locOffWeb` line, Ermoupoli map;
  - repeat with **I'll put the pin on the map** → map at once; the next photo shows the link.
  - Screenshots to `docs/screenshots/syc-524-location/`.
- [ ] **Step 6:** Commit, then open draft PR 3 stacked on PR 2.

---

## PR 4 — three onboarding screens

### Task 6: Steps and dots

**Files:**
- Modify: `components/onboarding/steps.ts` (`ONBOARDING_STEPS = ['welcome', 'safety', 'name']`), `OnboardingFlow.tsx`
- Delete: `components/onboarding/HowItWorksStep.tsx`
- Test: `components/__tests__/OnboardingFlow.test.tsx` (rewrite)

**Interfaces:**
- Produces: `OnboardingStep = 'welcome' | 'safety' | 'name'`. The flow is welcome → safety → name, and Back from name returns to safety. `KeepSafeScreen` loses `showDots`, and nothing calls `stepIndex('keepSafe')`.

- [ ] **Step 1:** Rewrite the tests:
  - **Get started** leads to the safety screen, whose dots show 3 with index 1 active;
  - **Continue** leads to the name screen (stubbed);
  - Back returns to safety;
  - `expo-location` is never called.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Rename the `'language'` step to `'name'`. Delete `HowItWorksStep.tsx`. Remove `showDots` from `KeepSafeScreen` and its caller in `_layout.tsx`. Retire `howTitle`, `howSubtitle`, `howLocationTitle`, `howLocationBody`, `howAllowContinue` and `howStepDontFeedBody` from all three languages, after `grep` shows no users.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 7: Welcome shows the three steps

**Files:**
- Modify: `components/onboarding/WelcomeStep.tsx`
- Test: `components/__tests__/WelcomeStep.language.test.tsx` (extend)

- [ ] **Step 1: Write the failing tests:**
  - The steps render `howStepSpot`/`howStepSpotBody`, `howStepCatalog`/`howStepCatalogBody` and `howStepHelp`/`howStepHelpBody`, in that order.
  - Switching to `el` re-renders them in Greek.
  - Each row has one accessible label, `${title}. ${body}`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - Rows go under the subtitle on the blue background: panel `rgba(255,255,255,0.12)`, radius `radii.lg`, icon tile `rgba(255,255,255,0.9)` 38×38, title `fonts.displayBold` 14.5, body `fonts.body` 12.5 / line 17.
  - Shrink the cat mark from 132 to 96.
  - Keep #301's roles and labels.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 8: Safety screen gains "Please don't feed them"

**Files:**
- Modify: `components/onboarding/SafetyStep.tsx`, `lib/i18n.ts` (add `safetyDontFeedBody` with the en/el/fr text in spec §1 "Screen 2")
- Test: `components/__tests__/SafetyStep.test.tsx` (extend)

- [ ] **Step 1: Write the failing tests:**
  - The paragraphs come in this order: LiveHere, Distance, LeaveBe, the don't-feed block (`howStepDontFeed` title + `safetyDontFeedBody`), then Hurt.
  - No text contains "feed them properly", "nourrissent correctement" or "ταΐζουν σωστά".
  - There is no Skip.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the block: panel `palette.terra100`, radius `radii.md`, padding 12/14, 🚫 before the title, body `fonts.body` 15/22.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Fit check** in the web preview at 390×844, en, el and fr. The safety screen's ScrollView `scrollHeight <= clientHeight`, and Welcome's likewise. Record the three numbers in the PR. If Greek overflows, reduce the block's body to 14/20 and re-measure; never cut words.
- [ ] **Step 6:** Commit.

### Task 9: One name-and-email screen

**Files:**
- Modify: `components/onboarding/LanguageUsernameStep.tsx` (rename the file and component to `NameStep`; update imports and tests)
- Create: `components/onboarding/useOnboardingEmail.ts`
- Test: `components/__tests__/NameStep.email.test.tsx`. Keep and rename the existing `LanguageUsernameStep.*.test.tsx` files, which must still pass.

**Interfaces:**
- Consumes: `addKeepSafe`, `looksLikeEmail`, `isInvalidEmail` (`lib/keepSafe.ts`); `setKeepSafeOffer`, `identityGeneration` (`DeviceContext`); `useUsernameClaim` (unchanged).
- Produces: `useOnboardingEmail({ deviceId, language }): { email: string; setEmail(v: string): void; savedFor: string | null; error: string | null; saving: boolean; saveIfNeeded(): Promise<'none' | 'saved' | 'failed' | 'invalid' | 'stale'> }`
  - `'stale'` when `identityGeneration()` changed during the request.
  - `savedFor` holds the address already added on this screen; a changed address clears it.
- **Start spotting** order (spec "The rules underneath"):
  1. `invalid` → stop.
  2. `setKeepSafeOffer('skipped-onboarding')`.
  3. `saveIfNeeded()`: `failed` or `stale` → stop; `saved` → `setKeepSafeOffer('done')`.
  4. The claim (online), or `holdUsername` (offline, unchanged).

- [ ] **Step 1: Write the failing tests:**
  - `empty email`: `addKeepSafe` is not called, the offer is `'skipped-onboarding'` before the claim is sent, then the claim runs.
  - `invalid email`: neither `addKeepSafe` nor the claim is called, and `keepSafeInvalidEmail` is shown.
  - `valid email`: `addKeepSafe(deviceId, { email, language, surface: 'onboarding' })` is called before the claim, the offer is `'done'`, then the claim runs.
  - `email fails`: no claim, `keepSafeSaveFailed` is shown, and a second tap retries. Emptying the box then claiming leaves the offer `'skipped-onboarding'`.
  - `email saved, name taken`: the box shows "Saved". After a new name, the second tap does not call `addKeepSafe` again.
  - `offline`: the `keepSafeOffline` line shows instead of the box, the offer is `'skipped-onboarding'` and `holdUsername` is called. Going online re-shows the box with the typed text kept.
  - `identity changes mid-save` (Review Focus 5): bump `identityGeneration` while `addKeepSafe` is pending. No claim, and no offer write after the bump.
  - `Back disabled while saving`.
  - `late reconcile` (Review Focus 1): with the email failed and the screen open, the recover effect sets the username → the offer is already `'skipped-onboarding'` (assert the stored value).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the hook and screen.
  - The layout follows spec §1 "Screen 3": name block, divider, `keepSafeTitle` + `keepSafeOptional`, `keepSafeBody`, email box, `keepSafeWarning` + bold `keepSafeUnder15`.
  - **Start spotting** goes in a footer outside the scroll view, like `SafetyStep`, inside the keyboard-aware container so it rides above the keyboard.
- [ ] **Step 4:** Run the onboarding and keep-safe test files. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 10: The gate never shows the old keep-safe screen to a new spotter

**Files:**
- Modify: `artifacts/cat-spotter/app/_layout.tsx` (`OnboardingGate`)
- Test: `components/__tests__/layoutOnboardingGate.test.tsx` (extend)

- [ ] **Step 1: Write the failing tests:**
  - `startedWithName false, name arrives with keepSafeOffer null` (relaunch after a landed claim) → the app renders, not `keep-safe-screen`, and the offer becomes `'skipped-onboarding'`.
  - `startedWithName true, keepSafeOffer null` → `keep-safe-screen` renders (the one-time offer for older spotters, unchanged).
  - `skipped-onboarding with a name` → `FirstBadgeOffer` is mounted (unchanged).
- [ ] **Step 2:** Run. Expected: the first case FAILS.
- [ ] **Step 3:** In the gate, when `keepSafeOffer === null && username && startedWithName.current === false`, call `setKeepSafeOffer('skipped-onboarding')` in an effect and render the app. Render `KeepSafeScreen` only for `startedWithName.current === true`.
- [ ] **Step 4:** Run the gate, `FirstBadgeOffer` and Profile tests (Profile hides "Your spots are only on this phone" for `skipped-onboarding`; add an assertion if none exists). Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 11: End-to-end check and PR

- [ ] **Step 1:** Run the full `artifacts/cat-spotter` suite (`pnpm exec vitest run`). Expected: all pass.
- [ ] **Step 2: Browser,** at 390px and desktop, in en, el and fr, from a cleared browser with a local API (memory `local-preview-with-planted-link` for the server setup):
  - Welcome → safety → name + email → camera, three times: location allowed; refused; "I'll put the pin on the map".
  - A sighting is sent each time.
  - A spotter who left the email empty gets the offer after their first badge.
  - The offline name screen, with the API stopped, shows the `keepSafeOffline` line.
  - Screenshots to `docs/screenshots/syc-524/`.
- [ ] **Step 3:** Remove `CHECKPOINT.md`. Open draft PR 4 stacked on PR 3. After PRs 1–3 merge: `gh pr ready`, wait for a CI run that succeeded, then a plain merge (never `--auto`).
- [ ] **Step 4:** Tell Samuel: no migration; web goes live when he pulls main in Replit and republishes. The native change rides the store build after launch. Before that build, check on iPhone and Android test builds that the phone's box appears only after **Use where I am**, that "Open Settings" works, and that Allow Once then relaunch goes straight to the box (spec "How we'll know it works").
- [ ] **Step 5:** Add the six `loc*` keys and `safetyDontFeedBody` to SYC-346 (Johnny's pack). Move SYC-524 to Done with the PRs noted. Update SYC-575 and SYC-308.

---

## Model delegation

Session model: Opus.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| PR 1, Task 0 (SYC-308) | Sonnet | small, fully specified pure-function change | the named tests; mutation probe (revert the camera branch → the Ermoupoli tests go red); browser screenshot; Opus spot review of the diff |
| PR 2, Tasks 1–3 (permission, provider, callers) | Sonnet | clear interfaces and tests in the plan | tests; mutation probe on "never asks on mount" (add a `requestForegroundPermissionsAsync` call to the provider's mount effect → the test goes red); a grep proving no `hooks/useLocation` import is left; Opus review of the provider |
| PR 3, Task 4 (`locationAskView`, `mapStart`) | Sonnet | a truth table given in full | table tests; mutation probe on the `'card'` → waiting rule (a silent wrong pin otherwise) |
| PR 3, Task 5 (card on Spot) | **Opus** | `spot.tsx` is ~1,900 lines, with several interacting map-start effects and SYC-48 waiting-card rules; a subtle mistake strands a sighting | source tests; browser check in three languages; separate Sonnet adversarial reviewer in its own worktree |
| PR 4, Tasks 6–8 (steps, Welcome, safety) | Sonnet | layout and copy with exact keys and values | tests; fit measurement in the browser; Opus spot review of the screenshots |
| PR 4, Tasks 9–10 (name + email screen, gate) | **Opus** | the claim machinery (SYC-211/214), held names (SYC-506), identity generation and the gate interact; the failure is silent (the wrong screen, a lost email) | tests including Review Focus 1 and 5; mutation probes (remove the early `skipped-onboarding` write → the late-reconcile test goes red; drop the generation check → the identity test goes red); separate Sonnet adversarial reviewer in its own worktree |
| Task 11 (end-to-end, PR, Linear) | Opus (session) | synthesis and live checks | browser probe with a real local API; CI green on a non-skipped run; main's push CI checked after merge |
| Greek and French drafts for the six `loc*` keys | Sonnet | translation drafting from the table above | Johnny's native review (SYC-346) before web publish |

Reviewers run one per worktree, never sharing (LIF-79). Delegated "tests pass" claims are re-run by the session before each PR (memory `rerun-delegated-tests`).
