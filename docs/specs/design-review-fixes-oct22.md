# Design review fixes, 22 Oct 2026: right words for the right people, "I've spotted this cat", maps that open on the cats

**Tickets:** SYC-571 (Part 1), SYC-574 (Part 2), SYC-573 (Part 3). Parent: SYC-569.
**Source:** the design review of 22 Oct 2026 (artifact on SYC-569), checked on the live build `26c34656`.
**Status:** draft for adversarial review, then Samuel's approval.

## Contents

1. [Part 1: text for a few people, shown to everyone (SYC-571)](#part-1)
2. [Part 2: "I've spotted {name}" on the cat page (SYC-574)](#part-2)
3. [Part 3: maps open on the cats (SYC-573)](#part-3)
4. [Greek and French](#translations)
5. [Decisions](#decisions)
6. [Tests](#tests)
7. [Out of scope](#out-of-scope)

---

<a id="part-1"></a>
## Part 1: text for a few people, shown to everyone (SYC-571)

**The rule this part adds:** a line of text is shown only to the people it is about. Text that only makes sense for a rare case goes behind a link or appears only in that case.

### 1.1 "Does {name} live with you?" replaces two lines on the cat page

**Decided by Samuel, 22 Oct 2026 (option B).** This reverses one cell of the claiming spec. `claiming-a-cat.md` §4.1 put *"Got a new phone? Ask Syros Cats to remove the old owner…"* on every homed cat's page ("kept on the page, Samuel, 14 Oct 2026"). On 22 Oct Samuel said that line "doesn't make any sense to me", because it isn't relevant to the people who read it. The §4.1 table is updated as below, and §6's "copy on the cat's page and in the help" sentence is updated to point here.

| Who is looking | Before | After |
|---|---|---|
| A phone that may claim the cat | **"This is my cat"** button | Unchanged. The button's wording is SYC-572, not this spec. |
| A phone that hasn't met it, when it lives on the street | One line: *"Is this your cat? Spot Agatha with the camera first, then you can say Agatha lives with you."* | A small link: **"Does Agatha live with you?"** It opens the sheet in §1.2, showing the "street" text. |
| A phone that has met it but is in a cooldown | Nothing | Unchanged (nothing). |
| Anyone except the owner, when the cat has a home | One line under "Has a home": *"Got a new phone? …"* | The same small link, **"Does Agatha live with you?"**, under "Has a home". It opens the sheet with the "has a home" text. |
| The owner | Owner's edit sheet | Unchanged. The link isn't shown. |
| In care or died | Nothing | Unchanged (nothing). |

The link has the same quiet style as "Report an issue": text link, 44pt tap height (SYC-509). It sits where the old line sat.

### 1.2 The sheet

The sheet is a small bottom sheet, the same component family as the Report an issue sheet, with a title, the text and one close button. It doesn't change anything on the server and needs no connection.

- **Title:** "Does Agatha live with you?"
- **When the cat lives on the street:** "If Agatha lives with you, take a photo of Agatha with the Spot button first. Then come back here and you can say Agatha lives with you."
  - If Part 2 ships, the sheet also has a button, **"Spot Agatha now"**, which does the same as the cat page's spot button (§2.2).
- **When the cat has a home:** "Agatha already has a home on the app. If Agatha's yours and you've changed phone, email us at hello@catspotters.com and we'll sort it out."
  - The address is shown as selectable text, as the Help tab does it, plus a "mailto:" link.
- **Close:** "OK"

Who reads hello@catspotters.com is **unchecked**. SYC-30 adds admin@syroscats.com as a second recipient. The address matches Help & info's "Contact us".

The old keys `claimNotMetHint` and `claimNewPhone` are removed. They're replaced by `claimAskLink`, `claimAskTitle`, `claimAskStreet`, `claimAskHomed` and `claimAskSpotNow`, all in en, el and fr.

### 1.3 The ear-tip question explains itself

The question is shown to every spotter after a sighting (`SightingQuestions.tsx`), and most visitors don't know what ear-tipping is. The question, answers, example photo and "Which ear?" stay the same. Only the words change:

| Key | Before | After |
|---|---|---|
| `earTipQuestion` | "One quick thing: is {name}'s ear tip clipped?" | "One quick thing: does {name} have a clipped ear?" |
| new `earTipWhy` (shown under the question, above the photo) | — | "After sterilising a cat, the vet snips a tiny piece off the tip of one ear. It leaves a flat, straight edge." |
| `earTipExampleCaption` | "…A notch or a tear is a battle scar, not a sterilisation mark." | "A clip is a straight cut across the tip of the ear. A notch or a tear is usually an old injury." |
| `earTipCantTell` | "Can't tell" | Unchanged. It's already a full-size answer, so check it stays one. |

### 1.4 Three more lines

| Where | Key | Before | After | Who sees it, and who it's for |
|---|---|---|---|---|
| Keep my spots safe, email step | `keepSafeWarning` | "Anyone who can open this inbox can open your collection, so use an address only you (or a parent) can read." | "Use an email only you can read. Anyone who can open it can get your spots back." | Every adult reads it, but it's written for children and shared inboxes. `keepSafeUnder15` ("Under 15? Ask a parent to add theirs.") already covers children, so the parent clause goes. |
| Delete my data, done screen | `deleteDoneEmail` | "If you also asked us by email, that request is already finished; there's nothing left to wait for." | **Removed** from the done screen. | Everyone who deletes reads it, but it's for the few who also emailed. The team answers anyone who emailed. `email-capture.md` §6.3's quoted block is updated to match. |
| Cat report, stuck on the safety check | `reportCheckBlocked` | "Your report is saved. A content blocker may be stopping the safety check: allow challenges.cloudflare.com for this page, or use the Cat Spotters app." | "Your report is saved. Something on your phone, often an ad blocker, is stopping it sending. Turn it off for this page and try again." | Anyone whose report is stuck reads it, but the old wording was for a developer. |

### 1.5 Dashboard: the map privacy note

`sites.mapHint` and `new.mapNote` ("Our server fetches the map pictures, so your browser never tells a map company where you are looking.") show on every map page. They move behind a `<details>` element: **"Why does the map work like this?"**, with the same text inside. That needs no script, so it works on the no-script pages. The dashboard is English-only today (`LIVE_LANGUAGES = ["en"]`), so only `en.ts` changes. The el and fr dashboard strings are updated the same way, so they stay in step.

---

<a id="part-2"></a>
## Part 2: "I've spotted {name}" on the cat page (SYC-574)

### 2.1 What the spotter sees

On a cat's page, a primary button, **"I've spotted {name}"**, sits under the status lines and above "This cat needs help". It is the page's most prominent button; claiming stays secondary (`claiming-a-cat.md` §4.1).

It **is shown** to anyone looking at a cat whose life status is street or homed, including the owner.

It **isn't shown** when:
- the cat is in care;
- the cat has died (the server refuses a resolve to a deceased cat, `sightings.ts` resolve guard);
- the phone has no name yet. That can't happen on the cat page anyway, because onboarding gates the app.

With no connection, it still works. Spotting works offline today: the spot is kept on the phone and matched when there's signal (§2.4).

### 2.2 What it does

Tapping it opens the Spot tab with that cat as a **hint**: `router.push({ pathname: '/spot', params: { for: String(cat.id) } })`. The hint is local to the phone. It is **never** sent with `POST /api/sightings`, whose body stays pinned to its existing fields (`sightingPayload.ts`, SYC-166 tests 6a and 6b).

On the Spot screen, a hint shows as a slim banner above the camera: **"Spotting {name}"**, with the cat's small photo and a ✕. The ✕ drops the hint and gives the ordinary Spot screen.

The hint is dropped when:
- the spotter taps ✕;
- the spotter leaves the Spot tab without taking a photo;
- the spot is sent and reviewed.

Taking or choosing the photo, the map pin, extra photos and photo tips all work exactly as today.

### 2.3 After the photo: "Is this {name}?"

The review screen (`app/review.tsx`) gets the hint through the route data: a new optional `hintCatId` field in `ReviewRouteData`, built by `buildReviewParams`. When there is a hint, the review screen shows one question first, above the usual look-alikes:

> **Is this {name}?** [ {name}'s photo ]
> **[ Yes, it's {name} ]** · **[ No, a different cat ]**

- **Yes** calls the existing `resolveSighting(sightingId, { deviceId, catId: hintCatId, pickedFrom: 'cat_page' })`. The server treats it exactly as it treats any choice today:
  - if the cat was among the stored suggestions at or above 0.4, it counts as a suggestion;
  - otherwise it's a hand pick, subject to the 1.5 km nearby rule (`choose-a-different-cat.md` §4.8);
  - points are the same as either (15).
  - If the server refuses with `NOT_NEARBY`, the screen shows the existing hand-pick refusal and falls back to the ordinary review: look-alikes, picker, new cat.
- **No** hides the question and shows the ordinary review screen unchanged.

**What the question must never reveal:**
- The question is the same whatever the matcher said. It is shown even if the hinted cat isn't among the candidates, and the hinted cat isn't reordered, highlighted or removed in the look-alike list.
- So the screen leaks nothing about whether, or how confidently, the matcher found that cat. This keeps `DECISIONS.md`'s rules: no ordering by true distance, and low-confidence candidates never expose an id or name.
- The hinted cat's name and photo are already public: the spotter came from its page.

**If the photo isn't a cat** (`isCatPhoto` false), the existing "not a cat" path runs and the hint is dropped, with no question.

**If matching failed** (`matchCheck` failed), the question is still shown. Yes resolves as above, through the hand-pick path.

### 2.4 Offline and the queue

If there's no signal, the spot goes into the queue as today. The queued item (`PendingSighting`, `lib/offlineQueue.ts`) gets a new optional field, `hintCatId?: number`. It is written by `queuedSighting` and read when the queued item reaches review (`reviewPending`, `spot.tsx`). Old items without it load as today, because items aren't validated on load.

The field is never sent to the server. `OfflineContext`'s replay builds the request from the pinned fields only, and the existing pinning test covers that.

### 2.5 `pickedFrom: 'cat_page'`

A new value for `pickedFrom` lets the team tell "picked from the cat's page" apart from the picker's `nearby`, `search` and `name_prompt`. That needs:
- `openapi.yaml`'s enum;
- the shared `PICKED_FROM` list;
- a migration that widens the `sighting_matches_picked_from_ck` check constraint (`lib/db/src/schema/sightingMatches.ts:84`).

`pickedFrom` only describes the phone's own screen. The server never uses it to decide what counts as a suggestion (`choose-a-different-cat.md` §4.6), so the new value changes no rule.

**Deploy order:**
1. Run the migration on production **before** Samuel republishes. The server would refuse 'cat_page' against the old constraint (the migrate-before-republish rule, SYC-497).
2. Until the migration is live, old servers reject the new value with 400. The new app only sends it once the new server is live, because they ship together. A phone still running old code never sends it.

Whether this is worth a migration is decision D3 below.

### 2.6 Abuse

Picking a famous cat to fill a collection is an accepted harm (`choose-a-different-cat.md`:119). It is bounded by the 1.5 km nearby rule, the 20-per-15-minute match limit and the team's hand-pick flags. The button makes a hand pick quicker, but not more possible. Anyone can already search for the cat in the picker.

The team's existing flag, "a cat already picked by hand several times recently", catches repeated "Yes" from the cat page in the same way. The new `pickedFrom` value lets the team see where those picks came from.

A resolved spot counts as "met" for claiming (`claiming.ts` `MET_MATCH_CHOICES`), just as a hand pick does today. That changes nothing about who can claim.

---

<a id="part-3"></a>
## Part 3: maps open on the cats (SYC-573)

### 3.1 The app's Cat-alogue map

**Opening view.** Today the map opens centred on Syros, or on the phone's position, at a span of 0.06°. The cats are 250 m squares, so they're hard to see at that size. Instead the map opens **fitted to the cats being shown**: the bounding box of every visible cat's published cell, with a margin of one cell on each side.

- **Zoom cap:** if all cats sit in one cell, or are very close together, the zoom is capped at a span of 0.01° (about 1 km). That way a single square never fills the screen and reads as a pin.
- **Location:** the phone's own position is still shown as the dot, but it doesn't change the opening view. "Near me" stays the way to see cats around you.
- **No cats** (for example, a filter with no matches): the island view, as today.
- **Filters:** changing a filter (All, Has a home, Not spotted yet, search) refits the map to the new set.

How it's built:
- A pure function, `regionForCells(cells, { marginCells: 1, minSpanDeg: 0.01 })`, in `lib/cellShape.ts`, returns `{ latitude, longitude, latitudeDelta, longitudeDelta }`. Both platforms use it: web through `zoomForDelta` and native through `initialRegion`.
- `AppMap.web.tsx` re-derives zoom and centre when the region changes, not only on mount, and `cats.tsx` remounts the map on a filter change.
- No new data: fitting uses only the published cell centres and sizes the map already has. `cat-record-data-spine.md` §6.2 and §10.7 are unaffected, because cells are still drawn as cells.

**Counts on shared squares.** When more than one cat shares a square, the square shows a small label: **"3 cats"**. A square with one cat has no label, as today.

The count comes from `groupByCell`, which the map already runs, so it publishes nothing new. The spine (§6.2, line 273) already accepts that published points can be counted and averaged.

The cat page's own map keeps its "Somewhere in here" label. The Cat-alogue map has never labelled squares, so "3 cats" doesn't clash with it.

**Tapping a shared square.** Today, tapping a square with several cats opens the first cat's page, which hides the others. Instead, on web, tapping a shared square filters the photo strip under the map to just those cats, with a "Show all" chip to undo. On native, where there's no strip, it opens the first cat as today, plus a "3 cats here" sheet listing them. The native sheet can come later; see decision D4.

### 3.2 The dashboard's island map (`/api/team/cats?view=map`)

The Leaflet map opens with `map.fitBounds(ISLAND)`, the whole island. Instead, once `/api/team/cats/positions` answers, it fits to the cats returned for the current filters:
- `fitBounds(catBounds.pad(0.15), { maxZoom: 16 })`;
- the existing focused-cat trail fit is unchanged;
- with no cats, it stays on the island view.

This map is already full page width (`main.wide`, 1120px) and draggable. The no-script button map keeps opening on the island, unchanged.

### 3.3 The dashboard's "Map" menu item (`/api/team/map`)

This is the tap-to-place map for feeding sites. Its small fixed size is deliberate: tiles are never shrunk, so a tap converts to an exact position (`map.ts:35-37`, `feeding-sites-and-colonies.md`:140). It shows no cats, by design.

The review's "small map with arrow buttons and no cats" finding was really about the menu sending people to this map when they expected the cats map. That's SYC-522 ("Map" opens a page called "Cats"). This spec **doesn't change `/api/team/map`**; it leaves the menu question to SYC-522.

---

<a id="translations"></a>
## Greek and French

Every new or changed app string ships in en, el and fr, with Claude's draft Greek and French marked for native review.

The copy freeze for Johnny's pack (SYC-346) is today, 22 Oct. Strings from this spec land after the freeze, so they go in the **short second pack** that SYC-346 already provides for "any string added after 22 Oct", flagged as such.

The rules SYC-346 settles apply: French *tu*, and Greek capitals without accents (SYC-159). See decision D1.

<a id="decisions"></a>
## Decisions

Each comes with a recommendation.

| # | Question | Options | Recommendation |
|---|---|---|---|
| D0 | What replaces the "new phone" and "is this your cat" lines? | A: Help only · **B: one link plus a sheet** · C: reworded line · D: keep | **B. Decided by Samuel, 22 Oct.** |
| D1 | Greek and French for these strings | Second pack after the freeze (as SYC-346 allows) · rush into today's pack · English only until reviewed | **Second pack.** It's what SYC-346 already provides. Shipping English-only would show English to Greek and French users. |
| D2 | Should "Is this {name}?" show even when the matcher didn't find that cat? | **Always** · only when the cat is among the candidates | **Always.** Showing it only sometimes would tell the spotter what the matcher thought, which DECISIONS.md forbids. Asking always costs one tap. |
| D3 | A new `pickedFrom: 'cat_page'` value, which needs a small migration | **New value plus migration** · reuse `search` · send none | **New value.** The team's hand-pick flags then show where repeat picks come from. The cost is one migration, run before the republish. Reusing `search` would mislabel the picks. |
| D4 | Tapping a square with several cats | **Web: filter the strip. Native: keep "opens first cat" for now** · do native too | **Web now, native later.** The native app isn't in the stores yet (SYC-323), so the web is what testers and launch use. |
| D5 | Should the Cat-alogue map open on the phone's position when it's known? | Centre on the phone · **fit to the cats** | **Fit to the cats.** The point of the map is to show where cats are. "Near me" already exists for the other case, and an empty map near a hotel looks broken. |

<a id="tests"></a>
## Tests

Each item is tested before its PR opens, with the affected suites run locally (vitest with the esbuild workaround) and the UI checked at 390px and 1280px in the browser pane, with data. The tests are:

**Part 1**
- The cat page renders the link and no old line in the street and homed states.
- There's no link for the owner, or for a cat in care or that has died.
- The sheet shows the right text per state.
- The removed keys are gone from all three dictionaries, and the en/el/fr key sets still match (the existing i18n parity test).
- `deleteDoneEmail` is gone from the done screen.
- The dashboard map pages render the `<details>`.

**Part 2**
- The button shows and hides by life status.
- The route carries `for`, and the banner and ✕ work.
- The `POST /sightings` body is unchanged (the existing pin test).
- The queued item keeps `hintCatId` and the replay body is unchanged.
- The review shows "Is this {name}?" whether or not the cat is among the candidates, and the candidate order is unchanged.
- Yes sends `pickedFrom: 'cat_page'`, and `NOT_NEARBY` falls back.
- The server accepts `cat_page`, and the migration's check constraint test passes.
- **Mutation check:** reorder the candidates when the hint is present, and the leak test must fail.

**Part 3**
- `regionForCells` gives the right result for one cell, a spread, no cells and the cap.
- The web map refits on a filter change.
- Shared squares show "N cats".
- Tapping a shared square on web filters the strip.
- The dashboard map script calls `fitBounds` on the positions with a `maxZoom` of 16, with the island as the fallback.

<a id="out-of-scope"></a>
## Out of scope

- The wider wording pass (SYC-572), including "This is my cat" becoming "{name} lives with me".
- The dashboard menu (SYC-522).
- Native photo pins (forbidden by §10.7).
- Map tiles with Latin-letter labels (SYC-573's footnote; with SYC-288).

## Build order

**One PR for all three parts (Samuel, 22 Oct 2026).** It is opened as a draft (project rule). Inside it, there's one commit per part, in this order:

1. Part 1: copy and the sheet.
2. Part 3: the maps.
3. Part 2: the button, the hint, the review question and the migration.

Each commit keeps its own tests green, so review can follow part by part.

Because the PR carries Part 2's migration, the whole PR follows the migrate-before-republish rule (SYC-497):
1. After merge, run `db-ops migrate` on production.
2. Then run `verify-history`.
3. Only then does Samuel republish.

Claude says "don't republish yet" until the migration is confirmed.
