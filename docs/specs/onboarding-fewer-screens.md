# First run: three screens to the camera, and location asked at the first photo

Ticket: SYC-524 (epic SYC-605, Spotting). Parent review: SYC-501 (18 Oct 2026). Related: SYC-35 (safety guidance), SYC-155 and SYC-506 (`first-run-language-and-offline-start.md`), SYC-502 (first-badge offer), SYC-308 and SYC-575 (Spot screen location), SYC-628 (Profile tab, `profile-tab-redesign.md` on its own branch).
Status: **draft for Samuel's approval.** Decisions made by Samuel on 24 Oct 2026 and recorded on SYC-524. Decision page with today's screens and every option mocked at 390px: https://claude.ai/artifact/5B1TXn8ACr71ZGRkRxiQ7b. Checked against `origin/main` at `356a32b5`.

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
> Scraps make cats sick and draw them onto busy roads. More food also means more kittens than we can help. Local cat guardians feed them properly.

- The words are the existing `howStepDontFeed` and `howStepDontFeedBody`, already translated, so nothing new goes to Johnny.
- It is set off as a soft terracotta panel with the 🚫 icon (the colour of today's "don't feed" card), so it reads as its own piece of advice and not part of Syros Cats' paragraphs.
- **Fit:** measured on main at 390×844, today's safety text leaves about 205px spare in Greek, 270px in French and 290px in English. The block needs about 190px in Greek. The screen must fit without scrolling in all three languages at 390×844. On smaller phones or with large text it scrolls, as now, with **Continue** always visible at the bottom.

#### Screen 3: Make it yours, with "Don't lose your spots" on the same screen

One screen asks for the name and, optionally, an email.

**Top half, the name (unchanged):** "Make it yours 🐾", "Pick the name other spotters will see.", the name box, Shuffle and the suggested names, the live "is this name free?" check, and everything SYC-506 built for offline starts.

**Bottom half, the email (optional):** a thin divider, then:

- **🔒 Don't lose your spots** (`keepSafeTitle`)
- "Add your email so you can get your spots, points and badges back if you lose or change your phone." (`keepSafeBody`)
- the email box, placeholder "your@email.com" (`keepSafePlaceholder`)
- "Use an email only you, or a parent, can read. Anyone who can open it can get your spots back. **Under 15? Ask a parent to add theirs.**" (`keepSafeWarning`, `keepSafeUnder15`)
- "This is optional." (`keepSafeOptional`), next to the heading or under the box.

**One button: Start spotting** (`startSpotting`). What it does:

| The spotter… | What happens |
|---|---|
| leaves the email empty | The name is saved and the app opens. This counts as skipping the email: the app offers it once more after their first badge, as it does today (`FirstBadgeOffer`; Samuel's 28 Sep rule that skipping doesn't use up a later ask). |
| types something that isn't an email | Nothing is saved yet. "That doesn't look like an email address." (`keepSafeInvalidEmail`) shows under the box. |
| types an email | The name is saved first. Then the email is added, exactly as "Save my spots" does today: same confirmation email, same safeguards, recorded as coming from onboarding. Then the app opens. |
| types an email, the name saves, but the email doesn't | They stay on the screen with the name now saved and shown as theirs. "That didn't save. Check your connection and try again." (`keepSafeSaveFailed`) shows under the box. **Start spotting** tries the email again; emptying the box and tapping it opens the app without one (counted as skipped). |

**Offline:** the name works as SYC-506 built it (suggested names made on the phone, the name held until there's a connection). The email box is replaced by "You're offline. You can add this later in Settings." (`keepSafeOffline`), because adding an email needs a connection and a saved name. The app counts this as skipped, so the first-badge offer follows once the name is saved and the first badge arrives.

**What goes away:** the separate "Don't lose your spots" screen for new spotters. The same screen stays where it is used today: Settings' "Keep my spots safe", the one-time offer after the first badge, and the one-time offer for spotters who had a name before "keep my spots safe" existed.

### 2. The app asks for location at the first photo, and explains why first

#### Nothing asks by itself

Home, the Cat-alogue, Spot (before a photo) and onboarding never bring up the phone's "Allow location?" box. They use location only if the spotter has already said yes; otherwise:

- **Home** shows "Cats to look out for" without distances, as it does today when location isn't available.
- **The Cat-alogue** lists and maps cats without "near you" sorting, as it does today without location.
- **Spot** shows no orange "Location permission is needed…" line before a photo is taken.

On the website, the app checks whether the browser already allows location without asking (`navigator.permissions`, where the browser has it; where it doesn't, the app treats location as not yet asked).

#### The first camera photo

After the spotter takes a photo with the camera, under "Where did you see it?", and only if they haven't answered yet, a card appears in their language:

> 📍 **Use where you're standing?**
> We'll put the pin where you are now, so Syros Cats know where this cat lives. You can move it after.
> [ **Use where I am** ]  [ I'll put the pin on the map ]

- **Use where I am** brings up the phone's (or browser's) own box.
  - **Allowed:** the pin goes where they're standing and the map appears, as today. Every later photo fills in the location by itself; the card never shows again.
  - **Not allowed, or no position within 15 seconds:** the map appears, starting in Ermoupoli, with "We've started the map in Ermoupoli. Drag it to where you saw the cat." (`mapStartedInTown`). **Check for matches** works.
- **I'll put the pin on the map** shows the map straight away, starting in Ermoupoli with the same line. The phone's box is not shown, so the one ask is kept for later.
- **No pin is placed until they choose,** so a cat seen in Ano Syros isn't sent with a default pin in Ermoupoli by someone who didn't notice it.

#### Later photos

- **Location allowed:** the pin goes where they're standing, as today. No card.
- **They chose "I'll put the pin on the map" before:** the map shows straight away, starting in Ermoupoli, with a small **Use where I am** link above it. The full card doesn't come back.
- **They said no in the phone's box, and the phone will ask again** (Android's second chance): the same small link; tapping it shows the phone's box once more.
- **They said no and the phone won't ask again:**
  - on iPhone and Android, a line above the map: "Location is off for Cat Spotters. Move the pin yourself, or turn location on in Settings." with **Open Settings** (`openSettings`, which opens the phone's settings for the app);
  - on the website: "Your browser is blocking location for this site. Move the pin yourself, or allow location from the address bar."
  In both cases the map starts in Ermoupoli and **Check for matches** works.

#### Photos from the library

Choosing a photo from the library never shows the card and never brings up the phone's box: a photo from the library may not have been taken where the spotter is now. The map starts as SYC-166 set it (the phone's position if location is already allowed and it's on Syros, otherwise Ermoupoli).

#### Where else location is used

- **"This cat needs help"** keeps its own behaviour: it asks when opened, because the reason is obvious there, and it already has a default pin with "Move the pin…".
- **"Use where I am now"** when claiming a cat already asks only when tapped. Unchanged.

## How this fits with SYC-308 and SYC-575, and what goes first

1. **SYC-308 first, as its own small change.** Today, with location refused, a camera photo can't be sent at all: the map waits for a position that never comes and **Check for matches** stays grey (`lib/mapStart.ts`: the camera starts at the phone or nothing). SYC-308 makes the camera path start in Ermoupoli when there's no position, like the library path. It needs no new words (it reuses `mapStartedInTown`), so it can still make the 26 Oct store build. Section 2 above depends on it: asking later is only safe once a "no" can't strand a sighting.
2. **Then SYC-524**, this spec: the three onboarding screens, the screens that stop asking by themselves, and the location card.
3. **SYC-575 shrinks.** Its location half ("a warning before anything happens", "ask for location when the photo is taken") is done by section 2. What stays on SYC-575: the two unexplained ways to take a photo ("Show live view" and the unlabelled white circle), and the stray icon-font glyph next to "Photo tips". Its ticket is updated to say so.

## Timing

The location card adds new lines in three languages after the 22 Oct copy freeze, so this misses the 26 Oct store build. On the website it can go live once Johnny has checked the Greek and French (SYC-346). The onboarding screens need no new words, but they ship with the location change, so that no version of the app has neither the onboarding ask nor the photo ask.

## Decisions (Samuel, 24 Oct 2026)

1. **Screens before the camera.** Round 1: A keep all five, B fold "How it works" into "Look, don't touch", C B plus the email after the first sighting, D C plus an auto-picked name. Samuel asked for side-by-side mockups, then: *"let's combine the make it yours and don't lose your spots pages. I don't like the combined "how Syros Cat Spotters works" and "Look don't touch" page - give me some other options for combining these"*. Round 2: 1 the steps move onto Welcome, 2 safety becomes a card inside "How it works", 3 "How it works" moves to Help & info, 4 keep both screens. Samuel: *"1, but ensure that the "don't feed them" advice is included on the safety card too"*.
2. **Where location is asked.** A the phone's box as the photo is taken, B explain at the first photo then ask, C on opening Spot, D its own onboarding screen. Samuel chose **B**.

**Amends DECISIONS.md D5 (as amended 28 Sep 2026).** "Onboarding ends with an optional email step" becomes "onboarding's last screen offers an optional email alongside the name". Leading with not losing your spots, the warning, the under-15 line, one later offer after skipping, and the separate consent for the restore email are unchanged. The news box is still hidden until SYC-45. The equal-prominence "Save my spots" and "Skip" pair gives way to one **Start spotting** button with an optional box; leaving it empty is the skip. DECISIONS.md is updated when this spec is approved.

## The rules underneath (for the plan; Samuel can skip this section)

- **Steps.** `ONBOARDING_STEPS` becomes `welcome`, `safety`, `name`. `HowItWorksStep` is deleted, and with it the onboarding's only `requestForegroundPermissionsAsync` call. `keepSafe` leaves the step list; `KeepSafeScreen`'s `showDots` path and `stepIndex('keepSafe')` go.
- **Offer state, set with the name.** Today the root gate (`app/_layout.tsx`, `OnboardingGate`) shows `KeepSafeScreen` when `keepSafeOffer === null && username`. A new spotter must never see it after the combined screen, so the screen sets `keepSafeOffer` (`'done'` when the email was added, `'skipped-onboarding'` otherwise) **before** the name is stored, in the same way the offline path already does (`LanguageUsernameStep.tsx`, `submit`). Spotters who had a name before this version (`startedWithName`) keep the one-time offer.
- **Order of saves.** Validate the email's shape first. Then claim the name (the SYC-211/214 claim machinery and lock, unchanged). Only after a confirmed claim, call `addKeepSafe(deviceId, { email, language, surface: 'onboarding' })`. A claim that is uncertain keeps today's same-name retry and doesn't try the email. If `addKeepSafe` fails after a confirmed claim, the screen must not let the gate open the app: the name is held in local state until the spotter taps again or empties the box. The plan says how (for example, store the name only after the email step finishes, keeping the claimed name in the screen meanwhile).
- **Profile reminder.** `profile-tab-redesign.md` rule 8 hides "Your spots are only on this phone" while `keepSafeOffer === 'skipped-onboarding'`. That still holds: skipping on the combined screen sets the same value. The Profile session is told.
- **Location permission without asking.** A small `lib/locationPermission.ts`: `getLocationPermission(): 'granted' | 'denied-can-ask' | 'denied-final' | 'not-asked' | 'unknown'`. Native uses `Location.getForegroundPermissionsAsync()` (`status`, `canAskAgain`). Web uses `navigator.permissions.query({ name: 'geolocation' })` where present (`granted`/`denied`/`prompt`), else `'unknown'`, treated like `'not-asked'`. Never prompts.
- **`useLocation` splits.** Screens that only use location if allowed (Home, Cat-alogue, Spot before a photo) call a non-asking version that reads the position only when permission is `'granted'`. Asking happens only from the card's **Use where I am**, the small link, or the report flow. On the web, `getCurrentPosition` is only called after permission is `'granted'` or after the tap.
- **Remembered choice.** "I'll put the pin on the map" is stored on the phone (`cat-spotter/location-choice = 'map'`), so later photos show the small link, not the card. Cleared by "Delete my data".
- **Map start.** The camera path uses SYC-308's Ermoupoli start for "not asked yet and chose the map", "refused" and "timed out". While the card is showing, there is no pin and **Check for matches** stays disabled; the card replaces the map until a choice is made. The existing rule that an Ermoupoli start gives way to a late phone fix until the spotter moves the map (`nextMapStart`) still applies after "Use where I am".
- **Retire** `howTitle`, `howSubtitle`, `howLocationTitle`, `howLocationBody`, `howAllowContinue`, and `locationDenied` (its two uses on Spot are replaced), if nothing else uses them. `howStep*` and `howSafety*` stay.
- **iPhone purpose string.** `app.json`'s `locationWhenInUsePermission` stays English-only for now (the phone's box shows it). Localising it needs a new app build; see follow-ups.

## Copy

Reused, already translated: everything on the three onboarding screens (listed above by key), `mapStartedInTown`, `openSettings`, `startSpotting`, all `keepSafe*` lines.

New (English; Greek and French drafted for Johnny's pack, SYC-346; French uses *tu*):

| Where | English |
|---|---|
| Location card heading | Use where you're standing? |
| Location card line | We'll put the pin where you are now, so Syros Cats know where this cat lives. You can move it after. |
| Location card button, and the small link on later photos | Use where I am |
| Location card second button | I'll put the pin on the map |
| Phone won't ask again (iPhone, Android) | Location is off for Cat Spotters. Move the pin yourself, or turn location on in Settings. |
| Browser blocking location (website) | Your browser is blocking location for this site. Move the pin yourself, or allow location from the address bar. |

## Out of scope

- **The photo tips sheet** on the first visit to Spot. It stays: it appears at the camera, where it helps.
- **SYC-575's camera buttons** and the stray glyph (stay on SYC-575).
- **When "This cat needs help" asks** for location (unchanged).
- **Localising the iPhone's own location box** (follow-up ticket).
- **A "Show cats near me" button on Home** for spotters who haven't shared location. Not requested; Home works without it.

## How we'll know it works

- **Unit tests:** `getLocationPermission` for each native status and `canAskAgain`, web `granted`/`denied`/`prompt`, and no `navigator.permissions`; the remembered map choice, including after "Delete my data"; the step list and dot count (3).
- **Component tests:**
  - Welcome shows the three steps and changes them with the language switch.
  - The safety screen has the don't-feed block between "leave them be" and the hurt line, and no Skip.
  - The combined screen covers: empty email (name saved, `skipped-onboarding`, app opens, no separate keep-safe screen); invalid email (nothing saved); valid email (claim, then `addKeepSafe` with `surface: 'onboarding'`, then `done`); email failure after a claim (stays on the screen with the error, retry works, emptying the box continues); offline (`keepSafeOffline` line, held name, `skipped-onboarding`).
  - Home, the Cat-alogue and Spot never call the asking function on mount.
  - The Spot card: both buttons; allowed; refused; timed out; and later photos for each remembered state.
  - A library photo never shows the card.
- **Gate test:** a new spotter never sees `KeepSafeScreen` after the combined screen; a spotter with a name from before still gets the one-time offer.
- **In the browser** at 390px and desktop, in English, Greek and French: a full first run from a cleared browser to a sent sighting with location allowed, refused, and "I'll put the pin on the map". Welcome and the safety screen fit without scrolling at 390×844 in all three languages. The first badge offers the email for a spotter who skipped it. Browser location blocked shows the address-bar line.
- **On a phone (iPhone and Android test builds) before the store build after this one:** the phone's box appears only after **Use where I am**, and "Open Settings" opens the app's settings.
