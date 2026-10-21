# First run: your language from the start, and starting without a connection

Tickets: SYC-155 (Greek and French speakers see the first screens in English), SYC-506 (a visitor without data can't get past onboarding). Parent: SYC-501, the public app review of 18 Oct 2026.
Status: **approved by Samuel, 21 Oct 2026**, after adversarial review (`docs/specs/reviews/first-run-language-and-offline-start-review.md`). Decisions 1–4 went with the recommendation; Decision 5 chose (b), the pun stays in English. Checked against `origin/main` at `7a2d83ff`.

## The problem, as a new spotter meets it

1. **The first three screens are always in English.** The app starts in English and only offers Greek and French on screen 4 of 5, after "How it works" and the "Look, don't touch" safety guidance Syros Cats asked for. A Greek local or a French tourist reads the safety guidance in English, or not at all.
2. **No connection, no start.** Screen 4 asks for a username and refuses to continue offline ("You need to be online to pick your username"). A tourist with roaming switched off, on the ferry or up in Ano Syros, can't get into the app at all, even though a sighting taken offline already waits on the phone and sends itself later.

## What the spotter will experience

### 1. The app opens in their language

- On first open, the app reads the phone's language (on the web, the browser's list of languages) and picks the first one it speaks: Greek, French or English. A phone set to Greek opens in Greek; a phone set to French Belgian opens in French. Anything else opens in English.
- On the web the browser's whole list counts, so a German browser with French second opens in French. On iPhone and Android the app reads the phone's main language only, without adding a new native component (that would need a new app build); see Decision 1.
- The app's guess is **not saved**: until the spotter taps a language, the app follows the phone. Once they tap one (on Welcome or in Me), that choice always wins.
- The first screen waits until the language is known, so a Greek phone never flashes English first.
- Nothing is sent anywhere: this is read on the phone.

### 2. A language switch on the Welcome screen

- The Welcome screen shows a clear switch at the top: **English · Ελληνικά · Français**, each in its own language, the current one highlighted. One tap changes every screen after it, including "How it works" and the safety guidance.
- Screen readers hear it as a set of three choices, each named in its own language, with the selected one marked.
- After Welcome, Back returns to it. Once in the app, the language lives in the Me tab, as today.
- The language list leaves the name screen, so that screen asks one thing: your name (Decision 2).

### 3. Starting without a connection

The name screen works as today when the phone is online: live "is this name free?" checks, suggested names, and the name saved before the app opens.

When the phone is **offline**:

- The screen shows a few suggested names made on the phone (from the same cat-themed word list the server uses, e.g. *SunnyTabby*), and the spotter can also type their own. The usual rules apply on the phone: 3–24 characters, letters, numbers, spaces and `_ . ' -`.
- The button reads **Start spotting** instead of being greyed out.
- A plain note says: *"You're offline. We'll save your name when you're back online."*
- The app opens. The phone greets them by that name. In the Me tab it carries a "Not saved yet" note until it is saved.

**What an offline first-time spotter can and can't do.** They can take a photo of a cat: it waits on the phone and is sent, with its matching, once there's a connection. They can't see the cat list, cat photos, the map or nearby cats unless the phone has loaded them before, which on a first run it hasn't. Those screens say they need a connection, as they do today. Before building, this is checked in the browser with the server stopped, and the spec is corrected if the Spot screen doesn't hold up on a first run.

**When the connection comes back**, the app saves the name in the background, before it sends any waiting sightings.

- **If the name is free**, the "Not saved yet" note disappears. Nothing else changes.
- **If someone else already has it**, the app saves it with a number on the end (*SunnyTabby → SunnyTabby47*), shortening the name first if that would go over 24 characters. If that is taken too, it tries twice more with other numbers, then a fresh suggested name.
- **If the server refuses the name** as unsuitable or invalid, the app goes straight to a fresh suggested name (a number wouldn't fix it).
- In every renamed case the spotter sees a note in Me, kept until they dismiss it: *"Someone already had SunnyTabby, so you're SunnyTabby47."* (or *"We couldn't use SunnyTabby, so you're WhiskerPaw."*), with a **Change it** button. See Decision 4.
- The spotter is never blocked or sent back to onboarding.

Until the name is saved: they show on the leaderboard as "You" (others see "Spotter 1234", as for anyone without a name today), and the Me tab's name editor waits for a connection as it does now. Sightings count for them either way: the server links sightings to the phone, not the name.

### 4. The Welcome subtitle

The subtitle's pun ("one furriend at a time", Greek *γατοπαρέα*, French *miaou-ami*) doesn't carry across languages. English keeps it. Greek and French get a plain line, *"Spot, name and help the street cats of Syros."* (Decision 5, option b). New Greek and French go into Johnny's review pack (SYC-346); French uses *tu*, as the rest of the app does.

## The rules underneath (for the plan; Samuel can skip this section)

- **A held name is its own state.** The phone stores it under a new key, separate from the saved name. The app knows three states: no name (onboarding), held name (in the app, not yet saved), saved name. Every place that reads the name is checked against them:
  - the root gate (held counts as "past onboarding");
  - the offline queue (sends once the held name has been saved or settled, so sightings never arrive before the save is attempted);
  - Home's greeting (shows the held name);
  - "Get your spots back" and the restore link (a held name counts as **no spotter**: no "you'll lose @name" warning, no keep-or-delete choice; restoring simply replaces it);
  - "Delete my data" (clears the held name too);
  - the Me tab's name editor (disabled while a background save is running).
- **One save at a time.** The background save uses the same claim machinery and lock as the name screen and the Me editor (SYC-211, SYC-214), so restore waits for it, an unclear result is retried with the same name, and phone and server never disagree. On the web it also takes a cross-tab lock, as the offline queue does, so two tabs can't both save.
- **Read first, then save.** Before each attempt the app asks the server what name this phone already has. If it has one (an earlier attempt landed before the app was closed), the app adopts it. A server answer of "no name" never clears a held name.
- **The "Don't lose your spots" email offer waits until the name is saved.** Today it appears the moment a name exists; with a held name that would ask an offline spotter for an email to protect an account the server doesn't know yet. This spec only adds that one condition. When and where the offer appears is the SYC-502 work's call, and it will be told.
- **Notes are worded when shown, not when saved**, so a spotter who changes language sees them in the new one.
- **Language detection** is one small function (phone or browser languages in, `el`/`fr`/`en` out) matching on the language part of a tag (`fr-BE` → French, `el-CY` → Greek), case-insensitive, safe when there's no browser (`navigator` missing).

## Decisions (Samuel, 21 Oct 2026: 1a, 2a, 3a, 4a, 5b)

1. **How the phone's language is read.** (a) Main language only on iPhone/Android, full list on web, no new app build (**recommended**: covers the common case, no native rebuild before launch). (b) Add the native language component (`expo-localization`) to read the phone's full list: catches a German phone with French second, but needs a new app build.
2. **Language list on the name screen.** (a) Remove it; it's on Welcome and in Me (**recommended**: the name screen asks one thing, and the spotter already saw their language working on three screens). (b) Keep it as well: a second chance, but a longer screen and two places to do the same thing.
3. **Starting offline.** (a) Hold a name on the phone and save it later (**recommended**: they start with a real name and keep it in almost every case). (b) Start with no name, ask for one later: simpler, but "Spotter 1234" until they come back to it, and a second ask. (c) Keep requiring a connection: no change, and tourists without data still can't start.
4. **When a held name turns out to be taken.** (a) Add a number automatically and leave a note with **Change it** (**recommended**: never blocks, and the note stays until seen). (b) Ask them to pick a new name the next time they open the app: they choose, but it interrupts them mid-visit, possibly while spotting.
5. **Welcome subtitle.** (a) Plain line in all three languages (**recommended**: Johnny reviews it with the rest). (b) Keep the pun in English only, plain in Greek and French. (c) Leave it alone.

## Out of scope

- **When "Don't lose your spots" appears** (SYC-502), beyond waiting for a saved name.
- **The number of onboarding screens** and **asking for location on "How it works"** before the spotter has a reason to share it. Both seen on 18 Oct; filed as SYC-524.
- **Weak, not absent, connections.** If the phone thinks it's online but the server doesn't answer, the name screen keeps today's SYC-211 behaviour. Offering "start anyway" after a failed save mixes with SYC-211's guarantees; a later ticket if testers hit it.
- **SYC-212's** "error messages keep the old language" on the name screen: unchanged here.

## Copy (English; Greek and French drafted for Johnny's pack)

| Where | English |
|---|---|
| Welcome subtitle (Greek and French only; English unchanged) | Spot, name and help the street cats of Syros. |
| Name screen subtitle | Pick the name other spotters will see. |
| Offline note | You're offline. We'll save your name when you're back online. |
| Offline button | Start spotting |
| Me tab, held name | Not saved yet: we'll save it when you're online. |
| Me tab, renamed (taken) | Someone already had {old}, so you're {new}. |
| Me tab, renamed (refused) | We couldn't use {old}, so you're {new}. |
| Me tab, note button | Change it |
| Welcome switch (screen reader) | Language |

Retired: `landingOffline`, `makeItYoursSubtitle`, `languageTrilingualLabel`, `languageGlossGreek`, `languageGlossFrench` (if nothing else uses them).

## How we'll know it works

- **Unit tests:** language picked from lists (Greek, French, English, unknown, `fr-BE`, `el-CY`, upper case, empty, no browser), a tapped choice beating the phone, the guess not being saved; phone-made suggestions obey the server's name rules; name shortening before the number; the background save: free, taken then numbered, taken three times then suggested, refused then suggested, offline again mid-save, app reopened after a save that landed, server says "no name" (held name kept).
- **Component tests:** Welcome switch changes the next screens; name screen offline shows suggestions, "Start spotting" and the note, and opens the app; restore with a held name shows no warning; the email offer waits for a saved name; Me shows "Not saved yet", then the rename note with Change it.
- **In the browser** at 390px and desktop, in English, Greek and French: a fresh first run on Greek and French browsers; a first run with the local server stopped, a photo taken, then the server started and the name and sighting saved; the clash case with a name already taken.

## Review findings and how they're handled

| Finding | Handled |
|---|---|
| F1 no "held but unsaved" state | Own state and key; every reader listed under "The rules underneath" |
| F2 restore treats a held name as a spotter | Held name counts as no spotter in restore |
| F3 races with the claim machinery | Same lock and read-then-save; cross-tab lock on web; "no name" never clears a held name |
| F4 numbered fallback | Shortened to fit; refused names go straight to a suggestion; three tries; note kept until dismissed, with Change it |
| F5 no way to read the phone's language list | Decision 1; main language on phones, full list on web |
| F6 flash of English, guess saved or not | First screen waits for the language; the guess isn't saved |
| F7 switch reachability and screen readers | Back returns to Welcome; options named in their own language |
| F8 leftover strings | Listed as retired; notes worded when shown |
| F9 overclaiming offline | Says what a first-time offline spotter can and can't do; checked in the browser before building |
| F10 email offer offline | Waits for a saved name |
| F11 leaderboard and null names | Checked: the app shows "You" / "Spotter 1234" today (`profile.tsx:250`, `cat/[id].tsx:293`) |
| F12, F13 | Copy goes to Johnny's pack; test cases added |
