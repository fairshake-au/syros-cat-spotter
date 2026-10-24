# First run: three screens to the camera, and location asked at the first photo

Ticket: SYC-524 (epic SYC-605, Spotting). Parent review: SYC-501 (18 Oct 2026). Related: SYC-35 (safety guidance), SYC-155 and SYC-506 (`first-run-language-and-offline-start.md`), SYC-502 (first-badge offer), SYC-308 and SYC-575 (Spot screen location), SYC-628 (Profile tab and Settings, `profile-tab-redesign.md`, merged in #296).
Status: **approved by Samuel, 24 Oct 2026** ("approved, write the plan"), after adversarial review (`reviews/onboarding-fewer-screens-review.md`). Decisions recorded on SYC-524 and in DECISIONS.md Part 2s. Decision page with today's screens and every option mocked at 390px: https://claude.ai/artifact/5B1TXn8ACr71ZGRkRxiQ7b.

## The problem, as a new spotter meets it

Walked in the web preview at 390px on 24 Oct 2026, from a cleared browser (screenshots in `assets/onboarding-fewer-screens/`).

1. **Six steps before the first photo.** Welcome, How it works, Look don't touch, Make it yours, Don't lose your spots, then the photo tips sheet the first time Spot opens. A tourist who opened the app because a cat is in front of them has to read and tap through all of it first.
2. **Location is asked on screen 2,** on "How it works", whose only button is "Allow & continue". The spotter hasn't taken a photo and has no reason to share where they are. On iPhone the app gets one ask, and a "no" sticks until they go into Settings. Android allows a second ask, then also sticks.
3. **Every main screen asks again by itself.** Home, the Cat-alogue and Spot ask the phone for location as soon as they open (`hooks/useLocation.ts` requests permission on mount; used by `app/(tabs)/index.tsx`, `cats.tsx`, `spot.tsx`). Removing the onboarding ask on its own would just move the phone's "Allow location?" box to Home, with no explanation at all.
4. **"Don't lose your spots" asks for an email on a screen of its own,** straight after the name, before the spotter has anything to lose.

## What the spotter will experience

### 1. Three screens, then the camera

**Welcome** · **Look, don't touch** · **Make it yours** · camera. The progress dots show three steps (Welcome holds the first, with no dots shown, as today).

#### Screen 1: Welcome says what the app is for

The Welcome screen keeps everything it has: the language switch at the top (English · Ελληνικά · Français), the cat mark, the title, the subtitle, **Get started**, "Used Cat Spotters before? Get your cats back" and the Fair Shake line.

Under the subtitle it now shows the three steps that used to be on "How it works", each as one row with its icon, title and one line:

| Icon | Title | Line |
|---|---|---|
| 📍 | Spot a cat | Snap a photo when you meet a cat in the alleys. |
| 🐱 | Add it to the cat-alogue | We check if it's a new cat or one we already know. |
| ❤️ | Help them thrive | Your spots help us sterilise and vaccinate street cats. |

- These are the existing words (`howStepSpot`, `howStepSpotBody`, `howStepCatalog`, `howStepCatalogBody`, `howStepHelp`, `howStepHelpBody`), already in Greek and French. Tapping a language changes them in place.
- The rows sit on the blue Welcome background as light, translucent panels, so the screen stays the one purely brand screen.
- The screen fits a 390×844 phone without scrolling in all three languages. If Greek runs long, the cat mark gets smaller first; the steps never get cut.
- Screen readers read the title, the subtitle, then each step as "Spot a cat. Snap a photo when you meet a cat in the alleys.", then the buttons.

#### Screen 2: Look, don't touch, and please don't feed them

The safety screen keeps its four paragraphs from Syros Cats word for word (`howSafetyTitle`, `howSafetyLiveHere`, `howSafetyDistance`, `howSafetyLeaveBe`, `howSafetyHurt`), with no Skip, as SYC-35 requires.

Between "So: photograph them, admire them, leave them be." and the bold line about hurt or sick cats, it now has a **"Please don't feed them"** block, the advice that used to be card 2 of "How it works":

> 🚫 **Please don't feed them**
> Scraps make cats sick and draw them onto busy roads. More food also means more kittens than we can help.

- The title is the existing `howStepDontFeed`. The line is today's `howStepDontFeedBody` **without its last sentence**, "Local cat guardians feed them properly.", which isn't necessarily true (Samuel, 24 Oct). It becomes a new key, `safetyDontFeedBody`, cut from the existing translations:
  - el: "Τα αποφάγια αρρωσταίνουν τις γάτες και τις τραβούν σε πολυσύχναστους δρόμους. Περισσότερο φαγητό σημαίνει και περισσότερα γατάκια απ’ ό,τι μπορούμε να βοηθήσουμε."
  - fr: "Les restes rendent les chats malades et les attirent sur les routes passantes. Plus de nourriture, c’est aussi plus de chatons qu’on ne peut en aider."
  Nothing is reworded, so Johnny only needs to glance at it with the rest of the pack. `howStepDontFeedBody` is retired with "How it works".
- It is set off as a soft terracotta panel with the 🚫 icon (the colour of today's "don't feed" card), so it reads as its own piece of advice and not part of Syros Cats' paragraphs.
- **Fit:** measured on main at 390×844, today's safety text leaves about 205px spare in Greek, 270px in French and 290px in English. The block needs about 170px in Greek. The screen must fit without scrolling in all three languages at 390×844. On smaller phones or with large text it scrolls, as now, with **Continue** always visible at the bottom.

#### Screen 3: Make it yours, with "Don't lose your spots" on the same screen

One screen asks for the name and, optionally, an email.

**Top half, the name (unchanged):** "Make it yours 🐾", "Pick the name other spotters will see.", the name box, Shuffle and the suggested names, the live "is this name free?" check, and everything SYC-506 built for offline starts.

**Bottom half, the email (optional):** a thin divider, then:

- **🔒 Don't lose your spots** (`keepSafeTitle`)
- "Add your email so you can get your spots, points and badges back if you lose or change your phone." (`keepSafeBody`)
- the email box, placeholder "your@email.com" (`keepSafePlaceholder`)
- "Use an email only you, or a parent, can read. Anyone who can open it can get your spots back. **Under 15? Ask a parent to add theirs.**" (`keepSafeWarning`, `keepSafeUnder15`)
- "This is optional." (`keepSafeOptional`), next to the heading or under the box. (`keepSafeOptionalRest`, "…add it later in Settings", is not shown here: the screen already makes the email optional.)

**One button: Start spotting** (`startSpotting`), pinned at the bottom of the screen like the safety screen's Continue, and still visible with the keyboard open. The screen itself may scroll on a small phone; the button never scrolls away. What it does:

| The spotter… | What happens |
|---|---|
| leaves the email empty | The name is saved and the app opens. This counts as skipping the email: the app offers it once more after their first badge, as it does today (`FirstBadgeOffer`; Samuel's 28 Sep rule that skipping doesn't use up a later ask). |
| types something that isn't an email | Nothing is saved. "That doesn't look like an email address." (`keepSafeInvalidEmail`) shows under the box. |
| types an email | **The email is added first,** exactly as "Save my spots" does today: same confirmation email, same safeguards, recorded as coming from onboarding. Then the name is saved, and the app opens. |
| types an email, and the email doesn't save | Nothing else happens yet: no name is saved. "That didn't save. Check your connection and try again." (`keepSafeSaveFailed`) shows under the box. **Start spotting** tries again; emptying the box and tapping it saves just the name and opens the app (counted as skipped). |
| types an email that saves, then the name is taken or refused | The email box shows "✓ Saved" and isn't sent again. The name shows today's "taken" or "can't use" message; they pick another and tap **Start spotting**. |

Why the email goes first: once a name is saved, the app opens by itself (the name is what moves the app past onboarding), so an email step after the name could be cut off half way. Adding the email needs only the phone's own identity, not a name, and the "Don't lose your spots" emails never mention a name.

While saving, **Start spotting** shows it is working and Back is disabled.

**Offline:** the name works as SYC-506 built it (suggested names made on the phone, the name held until there's a connection). The email box is replaced by "You're offline. You can add this later in Settings." (`keepSafeOffline`; "Settings" is the app's own Settings screen, where "Keep my spots safe" lives). The app counts this as skipped, so the first-badge offer follows once the name is saved and the first badge arrives. If the connection comes back while the screen is open, the email box returns, keeping anything already typed.

**What goes away:** the separate "Don't lose your spots" screen for new spotters. The same screen stays where it is used today: Settings' "Keep my spots safe", the one-time offer after the first badge, and the one-time offer for spotters who had a name before "keep my spots safe" existed.

### 2. The app asks for location at the first photo, and explains why first

#### Nothing asks by itself

Home, the Cat-alogue, Spot (before a photo) and onboarding never bring up the phone's "Allow location?" box. They use location only if the spotter has already said yes; otherwise:

- **Home** shows "Cats to look out for" without distances, as it does today when location isn't available.
- **The Cat-alogue** lists and maps cats without "near you" sorting, as it does today without location.
- **Spot** shows no orange "Location permission is needed…" line before a photo is taken.

On the website, the app checks whether the browser already allows location without asking (`navigator.permissions`, where the browser has it). Where the browser can't say, the app remembers on the phone that the spotter shared their location before, and only then reads it on Home and the Cat-alogue.

The moment the spotter allows location (on the Spot card or in the phone's Settings), Home and the Cat-alogue start showing distances without the app being restarted.

#### The first camera photo

After the spotter takes a photo with the camera (the phone's camera or the in-app live view), under "Where did you see it?", and only if they haven't answered yet, a card appears in their language:

> 📍 **Use where you're standing?**
> We'll put the pin where you are now, so Syros Cats know where this cat lives. You can move it after.
> [ **Use where I am** ]  [ I'll put the pin on the map ]

- **Use where I am** brings up the phone's (or browser's) own box. While the app waits for a position, the button shows "Getting your location…" (`locating`) and **I'll put the pin on the map** stays available.
  - **Allowed:** the pin goes where they're standing and the map appears, as today. A position the phone found in the last 5 minutes counts, as today. Later photos fill in the location by themselves, with no card, for as long as location stays allowed.
  - **Not allowed, or no position in time** (15 seconds on iPhone and Android, 10 on the website, as today): the map appears, starting in Ermoupoli, with "We've started the map in Ermoupoli. Drag it to where you saw the cat." (`mapStartedInTown`).
- **I'll put the pin on the map** shows the map straight away, starting in Ermoupoli with the same line. The phone's box is not shown, so the one ask is kept for later.
- **No pin is placed while the card is showing.** Once the map shows, it behaves as library photos do since SYC-166 (Samuel's Decision 6 there): **Check for matches** is available straight away, and the line asks the spotter to drag the map to where they saw the cat. A spotter could still send an Ermoupoli pin without moving it, as with library photos today.

#### Later photos

- **Location allowed:** the pin goes where they're standing, as today. No card.
- **Allowed "once" last time** (iPhone's "Allow Once", Android's "Only this time"): the phone forgets the answer when the app closes. Because the spotter chose to share before, the app skips the card and goes straight to the phone's box after the photo.
- **They chose "I'll put the pin on the map" before:** the map shows straight away, starting in Ermoupoli, with a small **Use where I am** link above it. The full card doesn't come back.
- **They said no in the phone's box, and the phone will ask again** (Android only: it allows one more ask; iPhone never does): the same small link; tapping it shows the phone's box once more.
- **They said no and the phone won't ask again** (iPhone after any "Don't Allow"; Android after the second no):
  - on iPhone and Android, a line above the map: "Location is off for Cat Spotters. Move the pin yourself, or turn location on in your phone's Settings." with **Open Settings** (`openSettings`, which opens the phone's settings for the app);
  - on the website: "Your browser is blocking location for this site. Move the pin yourself, or allow location from the address bar."
  In both cases the map starts in Ermoupoli and **Check for matches** works.
- **Android "approximate location":** the pin starts at the rough position and the usual "check the pin" line shows (`confirmLocationHint`).

#### Photos from the library

Choosing a photo from the library never shows the card and never brings up the phone's box: a photo from the library may not have been taken where the spotter is now. The map starts as SYC-166 set it (the phone's position if location is already allowed and it's on Syros, otherwise Ermoupoli).

#### Where else location is used

- **"This cat needs help"** keeps its own behaviour: it asks when opened, because the reason is obvious there, and it already has a default pin with "Move the pin…".
- **"Use where I am now"** when claiming a cat already asks only when tapped. Unchanged.

## How this fits with SYC-308 and SYC-575, and what goes first

1. **SYC-308 first, as its own small change.** Today, with location refused, a camera photo can't be sent at all: the map waits for a position that never comes and **Check for matches** stays grey (`lib/mapStart.ts`: the camera starts at the phone or nothing). SYC-308 makes the camera path start in Ermoupoli when there's no position, like the library path. It needs no new words (it reuses `mapStartedInTown`), so it can still make the 26 Oct store build. Section 2 above depends on it: asking later is only safe once a "no" can't strand a sighting. With SYC-308 on its own, a camera photo whose GPS is slow gets the Ermoupoli start after 4 seconds, which then gives way to the phone's position when it arrives, as long as the spotter hasn't moved the map (`nextMapStart`), exactly as library photos behave today.
2. **Then SYC-524**, this spec: the three onboarding screens, the screens that stop asking by themselves, and the location card.
   The build starts after SYC-509's accessibility PR (fairshake-au/syros-cat-spotter#301) merges: it edits `WelcomeStep.tsx`, `SafetyStep.tsx`, `LanguageUsernameStep.tsx` and `spot.tsx`, which this rewrites, and its labels and roles carry over to the new screens.
3. **SYC-575 shrinks.** Its location half ("a warning before anything happens", "ask for location when the photo is taken") is done by section 2. What stays on SYC-575: the two unexplained ways to take a photo ("Show live view" and the unlabelled white circle), and the stray icon-font glyph next to "Photo tips". Its ticket is updated to say so.

## Timing

The location card adds new lines in three languages after the 22 Oct copy freeze, so this misses the 26 Oct store build. On the website it can go live once Johnny has checked the Greek and French (SYC-346). The onboarding screens need no new words, but they ship with the location change, so that no version of the app has neither the onboarding ask nor the photo ask.

## Decisions (Samuel, 24 Oct 2026)

1. **Screens before the camera.** Round 1: A keep all five, B fold "How it works" into "Look, don't touch", C B plus the email after the first sighting, D C plus an auto-picked name. Samuel asked for side-by-side mockups, then: *"let's combine the make it yours and don't lose your spots pages. I don't like the combined "how Syros Cat Spotters works" and "Look don't touch" page - give me some other options for combining these"*. Round 2: 1 the steps move onto Welcome, 2 safety becomes a card inside "How it works", 3 "How it works" moves to Help & info, 4 keep both screens. Samuel: *"1, but ensure that the "don't feed them" advice is included on the safety card too"*.
2. **Where location is asked.** A the phone's box as the photo is taken, B explain at the first photo then ask, C on opening Spot, D its own onboarding screen. Samuel chose **B**.

**Amends DECISIONS.md D5 (as amended 28 Sep 2026).** "Onboarding ends with an optional email step" becomes "onboarding's last screen offers an optional email alongside the name". Leading with not losing your spots, the warning, the under-15 line, one later offer after skipping, and the separate consent for the restore email are unchanged. The news box is still hidden until SYC-45. The equal-prominence "Save my spots" and "Skip" pair gives way to one **Start spotting** button with an optional box; leaving it empty is the skip. Recorded in DECISIONS.md Part 2s.

## The rules underneath (for the plan; Samuel can skip this section)

- **Steps.** `ONBOARDING_STEPS` becomes `welcome`, `safety`, `name`. `HowItWorksStep` is deleted, and with it the onboarding's only `requestForegroundPermissionsAsync` call. `keepSafe` leaves the step list; `KeepSafeScreen`'s `showDots` path and `stepIndex('keepSafe')` go.
- **Offer state, set before anything is saved.** Today the root gate (`app/_layout.tsx`, `OnboardingGate`) shows `KeepSafeScreen` when `keepSafeOffer === null && username`. A new spotter must never see it. So when **Start spotting** is tapped, the screen first writes `keepSafeOffer = 'skipped-onboarding'` (persisted), and upgrades it to `'done'` once the email is added. This covers every way a name can arrive: the screen's own claim, a late reconcile from an uncertain claim (`useUsernameClaim`), the screen's recover-on-mount effect, and a relaunch after a claim landed but before the app noticed. As a backstop, the gate never renders `KeepSafeScreen` for a spotter with `startedWithName === false`: a name that arrives with `keepSafeOffer === null` on a phone that started without one is treated as `'skipped-onboarding'`. Spotters who had a name before this version keep the one-time offer.
- **Order of saves.** (1) Check the email's shape. (2) Write `skipped-onboarding`. (3) If an email was typed and not already saved on this screen, call `addKeepSafe(deviceId, { email, language, surface: 'onboarding' })`; on success set `'done'` and mark the box "Saved"; on failure stop and show the error. (4) Claim the name with the SYC-211/214 machinery and lock, unchanged (an uncertain claim keeps today's same-name retry). The claim storing the name is what opens the app. The plan confirms that `POST /keep-safe/:deviceId` works for a device with no name yet (the route needs only device auth; `keepSafeTemplates.ts` mentions no username), and what a restore returns for a device that saved an email but never got a name (expected: the new phone goes through onboarding to pick one).
- **Identity changes mid-save.** If "Delete my data", "Get your spots back" or a restore link (allowed during onboarding, `_layout.tsx`) changes the phone's identity while the email or claim request is in flight, its result is ignored. Use `identityGeneration()` from `DeviceContext`, as `useHeldNameSaver` does.
- **Screen state.** The email text lives in the screen's own state, so it survives the box being hidden offline and shown again. Back is disabled while a save is running. An email already saved on this screen is not sent again if the spotter goes Back and returns (keep a "saved" flag with the address, cleared if they change the address).
- **Server answers.** `POST /keep-safe` answers success for any well-formed address, including one already used by another phone (that is the restore design). A `not_configured` answer (test site without mail) is shown as `keepSafeSaveFailed`; emptying the box gets past it.
- **Profile reminder.** On main, Profile hides "Your spots are only on this phone" while `keepSafeOffer === 'skipped-onboarding'` (`app/(tabs)/profile.tsx`, `profile-tab-redesign.md` rule 8). Skipping on the combined screen sets the same value, so this keeps working; a test covers it.
- **One shared location state.** Today four screens each hold their own `useLocation()` (`index.tsx`, `cats.tsx`, `spot.tsx`, `report.tsx`), and each asks on mount. Replace them with one `LocationProvider` in `app/_layout.tsx` exposing `{ permission, coords, loading, askAndLocate() }`:
  - `permission`: `'granted' | 'denied-can-ask' | 'denied-final' | 'not-asked'`, read without asking (`lib/locationPermission.ts`). Native: `Location.getForegroundPermissionsAsync()` (`granted`; `undetermined` → not-asked; `denied` with `canAskAgain` → denied-can-ask, else denied-final). Web: `navigator.permissions.query({ name: 'geolocation' })` in a try/catch (`granted`, `denied` → denied-final, `prompt` → not-asked); if it is missing or throws, `granted` when the remembered choice is `'shared'`, else not-asked.
  - When `permission === 'granted'`, the provider reads the position (as `useLocation` does today: cached fix up to 5 minutes, then a fresh one; 15 s native, 10 s web). Otherwise `coords = null` and `loading = false`, so nothing shows "Getting your location…" forever.
  - `askAndLocate()` is the only thing that brings up the phone's box (apart from the report flow and claim's "Use where I am now"). After it, `permission` and `coords` update for every screen.
  - Re-read `permission` when the app comes back to the foreground (the spotter may have changed it in Settings) and when the web page becomes visible again.
  - The report flow ("This cat needs help") keeps asking on open by calling `askAndLocate()` on mount.
- **Remembered choice.** `cat-spotter/location-choice`: `'map'` after "I'll put the pin on the map", `'shared'` after any successful position from **Use where I am**. `'map'` means later photos get the small link; `'shared'` means the card is skipped and `askAndLocate()` runs straight after the photo when permission has reset. It is a phone preference, not part of the spotter's identity: cleared by "Delete my data" (next to the photo-tips key in the phone wipe), kept by "Get your spots back".
- **Map start.** `resolveMapStart` gains the permission state and the remembered choice. The camera and live paths: `granted` → wait for the phone as today, then Ermoupoli after the wait (SYC-308); chose the map, refused or timed out → Ermoupoli; `not-asked` with no choice → no start yet (the card shows instead of the map; **Check for matches** stays disabled). The library path is unchanged. `nextMapStart` (an Ermoupoli start gives way to a late phone fix until the spotter moves the map) still applies.
- **Retire** `howStepDontFeedBody`, `howTitle`, `howSubtitle`, `howLocationTitle`, `howLocationBody`, `howAllowContinue`, and `locationDenied` (its two uses on Spot are replaced), if nothing else uses them. The other `howStep*` keys and all `howSafety*` keys stay.
- **iPhone purpose string.** `app.json`'s `locationWhenInUsePermission` stays English-only for now (the phone's box shows it). Localising it needs a new app build; see follow-ups.

## Copy

Reused, already translated: everything on the three onboarding screens (listed above by key), `mapStartedInTown`, `confirmLocationHint`, `locating`, `openSettings`, `startSpotting`, all `keepSafe*` lines.

New (English; Greek and French drafted in the plan for Johnny's pack, SYC-346; French uses *tu*; the wording guard test that rejects "snapper" and "colony carer" covers the new keys):

| Where | English |
|---|---|
| Safety screen, don't-feed line (`safetyDontFeedBody`) | Scraps make cats sick and draw them onto busy roads. More food also means more kittens than we can help. *(existing words, last sentence dropped)* |
| Location card heading | Use where you're standing? |
| Location card line | We'll put the pin where you are now, so Syros Cats know where this cat lives. You can move it after. |
| Location card button, and the small link on later photos | Use where I am |
| Location card second button | I'll put the pin on the map |
| Phone won't ask again (iPhone, Android) | Location is off for Cat Spotters. Move the pin yourself, or turn location on in your phone's Settings. |
| Browser blocking location (website) | Your browser is blocking location for this site. Move the pin yourself, or allow location from the address bar. |

## Out of scope

- **The feeding reminder's "Syros Cats and local cat guardians feed colonies the right food, in the right places, all year round."** (`feedNudgeInstead`) makes a similar claim to the sentence dropped above. Not changed here; filed for Samuel to decide.

- **The photo tips sheet** on the first visit to Spot. It stays: it appears at the camera, where it helps.
- **SYC-575's camera buttons** and the stray glyph (stay on SYC-575).
- **When "This cat needs help" asks** for location (unchanged).
- **Localising the iPhone's own location box** (follow-up ticket).
- **A "Show cats near me" button on Home** for spotters who haven't shared location. Not requested; Home works without it.

## How we'll know it works

- **Unit tests:**
  - `lib/locationPermission.ts`: each native status with and without `canAskAgain`; web `granted`, `denied`, `prompt`; `navigator.permissions` missing and throwing, with and without the remembered `'shared'` choice.
  - `resolveMapStart` with the new inputs: camera and live for each permission state and remembered choice; library unchanged.
  - The remembered choice: set by each button, cleared by "Delete my data", kept by a restore.
  - The step list and dot count (3).
- **Component tests:**
  - Welcome shows the three steps and changes them with the language switch.
  - The safety screen has the don't-feed block between "leave them be" and the hurt line, and no Skip.
  - The combined screen: empty email (`skipped-onboarding` written before the claim, name saved, app opens); invalid email (nothing saved); valid email (`addKeepSafe` with `surface: 'onboarding'` before the claim, then `done`, then the claim); email fails (no claim, error shown, retry works, emptying the box continues); email saved then name taken (email not re-sent, pick another name); offline (`keepSafeOffline` line, held name, `skipped-onboarding`); back online mid-screen keeps the typed email; identity changed by "Delete my data" or a restore link mid-save (result ignored); Back disabled while saving; **Start spotting** visible with the keyboard open.
  - Home, the Cat-alogue and Spot never bring up the phone's box on mount; after `askAndLocate()` succeeds on Spot, Home shows distances without a restart.
  - The Spot card: both buttons; "Getting your location…" with the map button still available; allowed; refused; timed out; live view as well as the camera; later photos for each remembered choice and permission state, including a reset "Allow Once" with `'shared'` remembered; a library photo never shows the card.
  - Profile still hides "Your spots are only on this phone" for `skipped-onboarding`.
- **Gate tests:** a new spotter never sees `KeepSafeScreen`, including a name arriving by late reconcile and a relaunch after a claim; a spotter with a name from before still gets the one-time offer.
- **In the browser** at 390px and desktop, in English, Greek and French:
  - a full first run from a cleared browser to a sent sighting, three times: location allowed, refused, and "I'll put the pin on the map";
  - Welcome and the safety screen fit without scrolling at 390×844 in all three languages (measured, as on 24 Oct);
  - the first badge offers the email to a spotter who skipped it;
  - browser location blocked shows the address-bar line.
- **On a phone** (iPhone and Android test builds) before the store build that carries this: the phone's box appears only after **Use where I am**; "Open Settings" opens the app's settings; "Allow Once" then a relaunch goes straight to the phone's box after the photo.

## Review findings and how they're handled

Independent adversarial review, 24 Oct 2026 (`reviews/onboarding-fewer-screens-review.md`).

| Finding | Handled |
|---|---|
| 1 Spec stale; Profile/Settings already merged | Re-checked on `d8e1c2e4`; Profile reminder rule kept, with a test |
| 2 Name can arrive before the offer is set; keep-safe screen flashes | Offer written before anything is saved; email added before the name; gate backstop for new spotters; relaunch covered |
| 3 "No default pin" contradicts the Ermoupoli start | Reworded: no pin while the card shows; after that, same as library photos under SYC-166 Decision 6 |
| 4 Non-asking location under-specified; stale screens after a grant | One shared `LocationProvider` with defined states; screens update on grant and on return to the app |
| 5 Web browsers without `navigator.permissions` | Remembered `'shared'` choice; query wrapped in try/catch |
| 6 iOS "Allow Once", Android second ask, approximate location | Each case stated; card skipped when the spotter shared before |
| 7 Live view, timeouts, waiting state | Live view included; 15 s native, 10 s web; "Getting your location…" with the map still available |
| 8 Combined screen gaps (offline flip, Back, identity change, server answers) | Rules for each under "The rules underneath" |
| 9 Button may scroll away with the keyboard | Pinned footer, tested |
| 10 "Settings" ambiguous | "your phone's Settings" in the location line; `keepSafeOffline`'s Settings is the app's, which now exists |
| 11 SYC-308 alone and slow GPS | Stated: behaves like library photos, gives way to a late fix |
| 12 `resolveMapStart` inputs | Listed under "Map start", with tests |
| 13 Where the remembered choice is cleared | Phone wipe next to photo tips; kept by restore |
| 14 Copy and test gaps | `keepSafeOptionalRest` not shown; wording guard covers new keys; fit is a browser acceptance check |
