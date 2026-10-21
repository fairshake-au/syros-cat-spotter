# First run: your language from the start, and starting without a connection

Tickets: SYC-155 (Greek and French speakers see the first screens in English), SYC-506 (a visitor without data can't get past onboarding). Parent: SYC-501, the public app review of 18 Oct 2026.
Status: draft for Samuel's approval, 21 Oct 2026. Checked against `origin/main` at `7a2d83ff`.

## The problem, as a new spotter meets it

1. **The first three screens are always in English.** The app starts in English and only offers Greek and French on screen 4 of 5, after "How it works" and the "Look, don't touch" safety guidance Syros Cats asked for. A Greek local or a French tourist reads the safety guidance in English, or not at all.
2. **No connection, no start.** Screen 4 asks for a username and refuses to continue offline ("You need to be online to pick your username"). A tourist with roaming switched off, on the ferry or up in Ano Syros, can't get into the app at all, even though a sighting taken offline already waits on the phone and sends itself later.

## What the spotter will experience

### 1. The app opens in their language

- On first open, the app looks at the phone's language list (on the web, the browser's) and picks the first one it speaks: Greek, French or English. A phone set to Greek opens in Greek. A phone set to German, with French second, opens in French. Anything else opens in English.
- A language the spotter has chosen themselves always wins, then and later. Changing the phone's language afterwards doesn't override their choice.
- Nothing is sent anywhere: this is read on the phone.

### 2. A language switch on the Welcome screen

- The Welcome screen shows a small switch at the top: **EN · ΕΛ · FR**, with the current one highlighted. One tap changes every screen after it, including "How it works" and the safety guidance.
- The full language list then leaves the name screen (it stays in the Me tab, where it is today), so the name screen asks one thing: your name.
- The name screen's subtitle changes from "Choose a language, then claim your scout name" to one about the name only.

### 3. Starting without a connection

The name screen works as today when the phone is online: live "is this name free?" checks, suggested names, and the name saved before the app opens.

When the phone is **offline**:

- The screen shows a few suggested names made on the phone (from the same cat-themed word list the server uses, e.g. *SunnyTabby*), and the spotter can also type their own.
- The button reads **Start spotting** instead of being greyed out.
- A plain note under it says: *"You're offline. We'll save your name when you're back online."*
- The app opens. The name shows as theirs on the phone straight away; in the Me tab it carries a small "not saved yet" note until it is.
- Sightings work as they do offline today (they wait on the phone and send when there's signal). Nothing else in the app changes: screens that need a connection still say so.

When the connection comes back, the app saves the name quietly in the background.

- **If the name is free**, nothing visible happens except the "not saved yet" note disappearing.
- **If someone else already has it** (or the server refuses it as unsuitable), the app saves the name with a number added (*SunnyTabby → SunnyTabby47*), or a fresh suggested name if that fails too, and shows a one-time note: *"Someone already had SunnyTabby, so you're SunnyTabby47. You can change it in Me."* The spotter is never blocked or sent back to onboarding.

What the spotter can't do until the name is saved: show up by name on the leaderboard, or change their name in the Me tab (the editor waits for a connection, as it does today). Sightings sent before the name is saved still count for them: the server already links sightings to the phone, not the name, and shows the name once it exists.

### 4. The Welcome subtitle

The subtitle's pun ("one furriend at a time", Greek *γατοπαρέα*, French *miaou-ami*) doesn't carry across languages. Replace it with a plain line, e.g. *"Spot, name and help the street cats of Syros."* in all three languages. New Greek and French go into Johnny's review pack (SYC-346); French uses *tu*, as the rest of the app does.

## Out of scope

- **When "Don't lose your spots" (the email offer) appears.** The SYC-502 work owns its timing. Note for it: with this change, a spotter who starts offline reaches that screen without a connection. It needs to cope (it can be skipped today) or wait until the name is saved.
- **The number of onboarding screens** and **asking for location on "How it works"** before the spotter has a reason to share it. Both were seen on 18 Oct and get their own ticket.
- **Weak, not absent, connections.** If the phone thinks it's online but the server doesn't answer, the name screen keeps today's SYC-211 behaviour (retry the same name; Continue isn't held up by a slow name check). Offering "start anyway" after a failed save is possible later but mixes with SYC-211's guarantee that the phone and server never disagree on the name.

## Edge cases

- **"Already a spotter? Get your spots back"** still needs a connection, as today. Restoring replaces a held name that was never saved.
- **"Delete my data"** clears a held name with everything else.
- **Two phones, same held name offline.** Whoever's phone reconnects first gets it; the other gets the numbered name and the note.
- **The app is closed before the name is saved.** The held name is kept on the phone and saved on the next open with a connection.
- **Language switch on the name screen while a claim is in flight** no longer applies (the list moves off that screen). The SYC-212 bug about error messages keeping the old language stays open.

## Copy (English; Greek and French drafted for Johnny's pack)

| Where | English |
|---|---|
| Welcome subtitle | Spot, name and help the street cats of Syros. |
| Name screen subtitle | Pick the name other spotters will see. |
| Offline note | You're offline. We'll save your name when you're back online. |
| Offline button | Start spotting |
| Me tab, held name | Not saved yet: we'll save it when you're online. |
| Name clash note | Someone already had {old}, so you're {new}. You can change it in Me. |
| Welcome switch (screen reader) | Language |

The existing `landingOffline` string ("You need to be online to pick your username") is retired.

## How we'll know it works

- Unit tests: the language picked from a phone language list (Greek, French, English, unknown, regional forms like `fr-BE`, a saved choice winning); the phone-made suggestions follow the server's rules (3–24 characters, allowed characters); the background save on reconnect (free, taken then numbered, refused, offline again mid-save, app reopened).
- Component tests: Welcome switch changes the next screens; name screen offline shows suggestions, "Start spotting" and the note, and opens the app.
- In the browser at 390px and desktop, in English, Greek and French: a fresh first run on a Greek and a French browser; a first run with the local server stopped (offline), then started again, watching the name get saved; the clash case with a name already taken.
