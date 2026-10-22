# Design review fixes, 22 Oct 2026: right words for the right people, "I've spotted this cat", maps that open on the cats

**Tickets:** SYC-571 (Part 1), SYC-574 (Part 2), SYC-573 (Part 3). Parent: SYC-569.
**Source:** the design review of 22 Oct 2026 (artifact on SYC-569), checked on the live build `26c34656`.
**Status:** revised after the adversarial review (`docs/reviews/design-review-fixes-oct22-adversarial-review.md`; all 17 findings addressed, see the [record](#review-record)). All decisions made by Samuel on 22 Oct. Waiting for his approval of the spec.

## Contents

1. [Part 1: text for a few people, shown to everyone (SYC-571)](#part-1)
2. [Part 2: "I've spotted {name}" on the cat page (SYC-574)](#part-2)
3. [Part 3: maps open on the cats (SYC-573)](#part-3)
4. [Greek and French](#translations)
5. [Decisions](#decisions)
6. [Tests](#tests)
7. [Out of scope](#out-of-scope)
8. [Build and deploy](#build)
9. [Review record](#review-record)

---

<a id="part-1"></a>
## Part 1: text for a few people, shown to everyone (SYC-571)

**The rule this part adds:** a line of text is shown only to the people it is about. Text that only makes sense for a rare case goes behind a link or appears only in that case.

### 1.1 "Does {name} live with you?" replaces two lines on the cat page

**Decided by Samuel, 22 Oct 2026 (option B).** This reverses one cell of the claiming spec. `claiming-a-cat.md` §4.1 put *"Got a new phone? Ask Syros Cats to remove the old owner…"* on every homed cat's page ("kept on the page, Samuel, 14 Oct 2026"). On 22 Oct Samuel said that line "doesn't make any sense to me", because it isn't relevant to the people who read it. The §4.1 table and §6's sentence about "the copy on the cat's page and in the help" are updated to point here.

| Who is looking | Before | After |
|---|---|---|
| A phone that may claim the cat | **"This is my cat"** button | Unchanged. Its wording is SYC-572. |
| A phone that hasn't met it, when it lives on the street | One line: *"Is this your cat? Spot Agatha with the camera first…"* | A small link: **"Does Agatha live with you?"** It opens the sheet in §1.2, showing the "street" text. |
| A phone that has met it but is in a cooldown | Nothing | Unchanged. |
| Anyone except the owner, when the cat has a home | One line under "Has a home": *"Got a new phone? …"* | The same link, under "Has a home". It opens the sheet with the "has a home" text. |
| The owner | Owner's edit sheet | Unchanged, with no link. |
| In care or died | Nothing | Unchanged. |

The link has the same quiet style as "Report an issue": a text link with a 44pt tap height. Its `accessibilityRole` is "button", and its label is the link text.

### 1.2 The sheet

A small bottom sheet, from the same component family as the Report an issue sheet. It changes nothing on the server and needs no connection.

- **Title:** "Does Agatha live with you?"
- **Street:** "If Agatha lives with you, first take a photo of Agatha with the Spot button. Then come back here and you can say Agatha lives with you."
  - Part 2 adds a button here, **"Spot Agatha now"**, which does the same as the cat page's spot button (§2.2).
- **Has a home:** "Agatha already has a home on the app. If Agatha's yours and you've changed phone, email us at hello@catspotters.com and we'll help."
  - The address is selectable text plus a mailto link, as on the Help tab.
  - Who reads hello@catspotters.com is **unchecked** (see SYC-30).
  - The person who emails is helped by the team's existing "Remove owner" (`claiming-a-cat.md` §7). That promise needs Syros Cats' OK, which Samuel will check (§5, note N1).
- **Close:** "OK"

The sheet traps screen-reader focus while open and returns it to the link when closed, following the pattern from SYC-483.

**Keys:** `claimNotMetHint` and `claimNewPhone` are removed. `claimAskLink`, `claimAskTitle`, `claimAskStreet`, `claimAskHomed` and `claimAskSpotNow` are added in en, el and fr.

### 1.3 The ear-tip question explains itself

The question is shown to every spotter after a sighting, in `SightingQuestions.tsx`. That component is used by the review screen and by `MoreToAdd` on the cat page. The new order is:

1. **Question** (`earTipQuestion`): "One quick thing: does {name} have a clipped ear?"
2. **Why** (new `earTipWhy`, which replaces the separate `earTipUsuallyLeft` line): "After sterilising a cat, the vet snips a tiny piece off the tip of one ear, usually the left. It leaves a flat, straight edge."
3. **Example photo** (unchanged).
4. **Caption** (`earTipExampleCaption`): "A clip is a straight cut across the tip of the ear. A notch or a tear is usually an old injury, not a sterilisation mark."
5. **Answers:** unchanged, with "Can't tell" kept as a full-size answer.

The `earTipUsuallyLeft` key is removed from all three languages. `fact.earTip` ("On Syros it's usually the left ear") stays consistent.

### 1.4 Three more lines

| Where | Key | Before | After | Why |
|---|---|---|---|---|
| Keep my spots safe, email step (same `<Text>` as `keepSafeUnder15`, `KeepSafeScreen.tsx:100`) | `keepSafeWarning` | "Anyone who can open this inbox can open your collection, so use an address only you (or a parent) can read." | "Use an email only you, or a parent, can read. Anyone who can open it can get your spots back." | "Collection" isn't an app word, and the sentence led with the risk. The parent clause stays because "Under 15? Ask a parent to add theirs." sits in the same paragraph. `email-capture.md` lines 143 and 548 are updated to match. |
| Delete my data, done screen | `deleteDoneEmail` | "If you also asked us by email, that request is already finished; there's nothing left to wait for." | **Removed.** | Everyone who deletes reads it, but it's for the few who also emailed. `email-capture.md` §6.3's quote is updated. No test pins it. |
| A report, either "This cat needs help" or "Report an issue" (`ReportIssueSheet.tsx:320`), stuck on the safety check | `reportCheckBlocked` | "Your report is saved. A content blocker may be stopping the safety check: allow challenges.cloudflare.com for this page, or use the Cat Spotters app." | "Your report is saved, but something in this browser (often an ad blocker) is stopping it sending. Turn it off for this page, then send again. If that doesn't help, allow challenges.cloudflare.com." | The first sentence is for everyone. The domain stays, last, for the person who needs it. It says "browser", not "phone", because computers get this too. "Send again" names the screen's existing send button; the build checks both screens have one and adjusts the wording if not. `ReportAdvice.test.tsx:225` still finds the domain. |

### 1.5 Dashboard: the map privacy note

Three places carry it: `sites.mapHint` (`en.ts:460`), `new.mapNote` (`en.ts:527`) and the hard-coded `teamOnlyHint()` in `catMapPage.ts:244-248`.

- **"This map is only for the team."** stays visible, because it's a warning people must see.
- The rest ("Our server fetches the map pictures…") moves inside a `<details>` element labelled **"Why does the map work like this?"**. The dashboard already uses `<details>`, and no test pins the text.
- `teamOnlyHint()` moves into `strings/en.ts` as part of this, so all three read from one place.
- el and fr dashboard strings are updated to keep them in step. They aren't live yet (`LIVE_LANGUAGES = ["en"]`).

---

<a id="part-2"></a>
## Part 2: "I've spotted {name}" on the cat page (SYC-574)

### 2.1 The button

On a cat's page, a primary button, **"I've spotted {name}"**, sits under the status lines and above "This cat needs help". It is the page's most prominent button. Claiming stays secondary, as `claiming-a-cat.md` §4.1 requires.

- **Shown:** for cats that live on the street or have a home, to every phone, including the owner's.
- **Hidden:** for a cat in care or one that has died. The server refuses to resolve a sighting to a dead cat (`sightings.ts:925-936`). It has no such guard for "in care", so for that status only the app hides the button.
- **Offline:** taking the photo works with no signal, as all spotting does: the spot waits on the phone. Answering "Is this {name}?" needs signal, so the question appears when the waiting spot is checked (§2.4).

### 2.2 The hint

Tapping the button opens the Spot tab with that cat as a **hint**: `router.push({ pathname: '/spot', params: { for: String(cat.id) } })`. As soon as the Spot screen reads `for`, it copies the id into its own state and clears the route param with `router.setParams({ for: undefined })`. That way the hint never comes back when you return through the tab bar or the browser history.

The hint lives only on the phone. **It is never sent with `POST /api/sightings`**, whose body stays pinned (`sightingPayload.test.ts` tests 6a and 6b, and the exact-body assertion at `OfflineContext.test.tsx:620`).

**The banner.** On the Spot screen, a hint shows as a slim banner above the camera: **"Spotting {name}"**, with the cat's small photo and a ✕.
- The ✕ has the accessibility label "Stop spotting {name}".
- Long Greek or French names wrap to two lines at 390px rather than being cut off.
- It uses theme tokens only, so it works in dark mode.

**How long the hint lasts.** The hint belongs to the photo the spotter is about to take or has staged.

| Situation | What happens |
|---|---|
| Arriving with a hint and no photo staged | The banner shows. The next photo carries the hint. |
| Arriving with a hint when a photo is already staged | The staged photo keeps its place, and the hint applies to it. |
| Leaving the tab with no photo staged | The hint is dropped. |
| Leaving the tab with a photo staged | The hint stays with the photo, as the staged photo does today. |
| ✕, "Start again" or discarding the photo | The hint is dropped. |
| The spot is sent | The hint goes with it to review (online) or onto the queued item (offline), then the Spot screen clears it. |

### 2.3 After the photo: "Is this {name}?" is its own first step

`app/review.tsx` is four screens: couldn't check, not a cat, naming and matches (`review.tsx:201-206`, `:754`). With a hint, a new **first step** comes before whichever of those the result would open:

> **Is this {name}?**
> [ your photo ] [ {name}'s photo ], side by side
> **[ Yes, it's {name} ]** · **[ No, it's a different cat ]**

Both photos are shown so the spotter compares rather than just agrees. That's the mitigation for primed answers (§2.6). Both buttons have accessibility labels that name the cat.

- **Not a cat** (`isCatPhoto` false): no question. The hint is dropped and the not-a-cat screen opens as today.
- **Every other result** (matches, no candidates, matching failed): the question is shown, identically, whatever the matcher returned.
- **Yes** calls the existing `resolveSighting(sightingId, { deviceId, catId: hintCatId, pickedFrom: D3 })`. The server labels the choice exactly as for any choice today: a suggestion if the cat was stored at 0.4 or above, otherwise a hand pick, subject to the 1.5 km nearby rule. Points are 15 either way.
  - **Success:** the usual success screen.
  - **`NOT_NEARBY` or another refusal:** the message shows **on the question step itself**, under the buttons. That step has its own message slot; it doesn't use `confirm()`'s picker or send slots (`review.tsx:266`). The Yes button is replaced by **"Carry on"**, which goes to the screen the result would have opened.
- **No:** goes to the screen the result would have opened. `openedOn` and `useResultNudge` record that screen, not the question step.

**What the question must never reveal.** The question is the same whatever the matcher said. In the look-alike list that follows a "No", the hinted cat isn't reordered, highlighted or removed.

The adversarial review checked this against the server:
- a resolve succeeds or fails only on published cells and the dead-cat guard (`sightings.ts:900-938`);
- the response is the same either way (15 points, and no choice field, `:1121-1149`).

So "Yes" adds no new way to probe the matcher. The hinted cat's name and photo are already public, because the spotter came from its page.

### 2.4 Plumbing

**Online send.** `ReviewRouteData` gets an optional `hintCatId`, added to both `buildReviewParams` and the field list `parseReviewParams` keeps (`reviewParams.ts:178-190`). The parser accepts it only if `Number.isInteger(x) && x > 0`.

**Queued spot.** The hint is stored on the queued item **outside** `queuedSighting`. The Spot screen sets `hintCatId` on the `PendingSighting` after `queuedSighting` builds it, so test 6b's pinned key set stays true.

**Every way into review.** There are three:
- `spot.tsx:1049` (online send);
- `spot.tsx:1121` (`reviewPending`);
- `ReviewReadyBanner.tsx:36-45`.

For queued items, `review.tsx` reads `hintCatId` from the queue item it already looks up by `localId`. The route only carries `hintCatId` for online sends. So `reviewPending` and the banner need no change, and can't drop the hint.

**Replay.** The replay in `OfflineContext.tsx:494-503` builds the request body field by field, and its exact-body test (`OfflineContext.test.tsx:620`) proves `hintCatId` never reaches the server.

### 2.5 Recording where the pick came from (decision D3)

`pickedFrom` today is recorded only on hand picks. When the chosen cat was a stored suggestion, `labelChoice` writes `choice: 'suggested'` and drops `pickedFrom` (`sightings.ts:522-528`). No team screen reads `picked_from` yet: `review_hand_picks` is only declared (`capabilities.ts:107`).

The first draft of this spec said an existing team flag would use the new value. **That was wrong, and it's withdrawn.**

So the real choice is between two options.

**Option R: record it.**
- Add `'cat_page'` to `pickedFrom`, and record it on **every** pick from the question step, suggestion or not.
- The value is a separate fact from the choice label. The label rules don't change, and the server still decides what counts as a suggestion.
- This keeps primed "Yes" answers (§2.6) separable when matcher accuracy is measured (SYC-56) and when matcher-miss labels are used.
- It needs:
  - a migration widening `sighting_matches_picked_from_ck`, with a rollback of `UPDATE sighting_matches SET picked_from = NULL WHERE picked_from = 'cat_page'` before the narrow check is restored;
  - the openapi enum, then regenerating the zod schemas and the client;
  - the `labelChoice` type (`sightings.ts:502`), the app's `PickedFrom` union and the shared `PICKED_FROM`;
  - a `run_sql` check of the constraint after the migration (DEPLOYMENT.md:48).
- **If the code goes live before the migration,** the resolve still succeeds, but the label row is silently lost: the label write is best-effort and only logs (`sightings.ts:1063-1075`). It is not refused. So the migrate-before-republish order matters (§8).

**Option N: don't record it.**
- Send no `pickedFrom`. There's no migration and no API change.
- Cat-page picks can't be told apart from any other pick later.
- A ticket would be filed to add it when a hand-pick list or accuracy measurement needs it, but the picks made before then are lost for good.

**Recommendation: R.** The cost is one small migration and one deploy step, and Samuel already accepted a migration in this PR. Without it, primed answers can never be separated afterwards.

### 2.6 Risks, stated plainly

- **Primed answers.** Someone who came to spot Agatha is inclined to say "Yes" to a look-alike. A wrong Yes:
  - puts a wrong photo on Agatha's page;
  - sends Agatha's followers a notification about it;
  - attaches ear-tip answers to the wrong cat;
  - adds a wrong "same cat" label to the matcher's data.

  The 1.5 km nearby rule bounds this only weakly, because it's measured from the spotter's own pin, which they can move (`spot.tsx:419`).
  - **Mitigations:** the side-by-side photos; "No, it's a different cat" given equal weight; the team's existing "Says otherwise" and photo-hiding tools; and, with option R, the record of where each pick came from.
- **Collection-filling.** Picking a famous cat to fill a collection is an accepted harm (`choose-a-different-cat.md`:119). The button makes it quicker but not newly possible, since the picker's search already allows it. The bounds are the 20-per-15-minutes match limit and the nearby rule.
- **Claiming.** A resolved spot counts as "met" for claiming, as a hand pick does today (`claiming.ts` `MET_MATCH_CHOICES`). Who can claim doesn't change.

---

<a id="part-3"></a>
## Part 3: maps open on the cats (SYC-573)

### 3.1 The app's Cat-alogue map

**Opening view.** The map opens **fitted to the cats being shown**.
- It is sized to the map's real on-screen size, measured with `onLayout`, and uses both latitude and longitude spans. Today's `zoomForDelta` uses latitude only, with no viewport size.
- There's a margin of one cell around the cats.
- **Zoom cap:** the closest it opens is zoom 16, where a 250m square is about 160px. A single cell never fills the screen and never reads as a pin.
- **Zoom floor:** the existing `MIN_ZOOM` of 12 (`mapTiles.ts:11`). An island-wide spread opens at 12, as today. Only clusters change, and that's where the problem was.
- With no cats, it shows the island view, as today.

**What doesn't move the map:**
- **Location.** The phone's position shows as the dot but never moves the opening view. The `key={coords ? 'located' : 'default'}` remount (`cats.tsx:244`) is removed. "Near me" stays the way to see cats around you.
- **New data.** A react-query refetch doesn't move the map.
- **Typing.** Search refits only once the typed value has settled (the existing debounce, or 400ms if none). Each keystroke would otherwise pull a new set of tiles from openstreetmap.org (`mapTiles.ts:13`), against OSM's usage policy.

**What does move it:** changing a filter chip, a settled search, or opening the map view.

How it's built:
- A pure function, `fitRegion(cells, { width, height, marginCells: 1, maxZoom: 16, minZoom: 12 })`, in `lib/cellShape.ts`, returns `{ latitude, longitude, zoom }`, plus the deltas for native.
- `AppMap.web.tsx` gets a `fitKey` prop. When it changes, the map re-derives centre and zoom without remounting. It currently sets zoom only on mount.
- Native uses the deltas in `initialRegion` and `animateToRegion` on a `fitKey` change.

**Privacy.** No new data is used: only the published cell centres and sizes the map already has. Cells are still drawn as cells (spine §10.7).

**Shared squares (decision D6).** When more than one cat shares a square, should the square say **"3 cats"**? The data is already public: the strip lists every cat, and the cells overlap visibly. But a count makes the places where cats gather stand out to anyone casually browsing.
- The spine accepted that averaging published points can locate a colony only "knowingly" (§6.2, lines 273-279).
- Feeding sites are deliberately private (SYC-209).

**Samuel decided yes on 22 Oct**, knowing that it makes colonies easier to spot. So:
- the label shows only when the square is at least 40px wide on screen, so labels don't overlap at low zoom;
- it uses plural forms in el and fr.

Either way, every square gets an accessibility label. Today it has none, because `accessibilityLabel={a.label}` is undefined (`AppMap.web.tsx:120`). The label is "{name}'s area" for one cat, and "Area with 3 cats" for a shared square.

**Tapping a shared square (D4).** On web, tapping it filters the photo strip under the map to just those cats, with a **"Show all"** chip. On native, it opens the first cat as today. A native list sheet is a follow-up ticket, because the native app isn't in the stores yet (SYC-323).

### 3.2 The dashboard's island map (`/api/team/cats?view=map`)

Today the map opens with `map.fitBounds(ISLAND)` (`dashboard-map.js:140`). It will fit to the cats instead, **once**, when all of these hold:
- it's the **first** positions answer after the page loads;
- the page has **no focused cat** (`focus` unset). The focused-cat trail fit (`:764-765`) wins and runs as today;
- the user **hasn't moved the map yet**: no `movestart` from a user drag, zoom, or a "Go to" button (`:726`) since load.

The fit is `fitBounds(catBounds.pad(0.15), { maxZoom: 16 })`. With no cats, it stays on the island.

It never refits on a filter change or while typing in search (the `loadCats` debounce at `:673`). That avoids jumping, and it keeps tile use within the 300-squares-per-10-minutes budget (`rateLimit.ts:231-249`). The island tiles from the first `fitBounds(ISLAND)` are a one-off cost, the same as today.

The no-script button map is unchanged.

### 3.3 The dashboard's "Map" menu item (`/api/team/map`)

This is the tap-to-place map for feeding sites. Its small fixed size is deliberate: tiles are never shrunk, so a tap converts to an exact position (`map.ts:35-37`, `feeding-sites-and-colonies.md`:140). It shows no cats, by design.

The review finding was really that the menu sends people here when they expect the cats map. That's SYC-522. This spec leaves `/api/team/map` unchanged.

---

<a id="translations"></a>
## Greek and French

Every new or changed app string ships in en, el and fr, with Claude's draft Greek and French marked for native review. The rules SYC-346 settles apply: French *tu*, and Greek capitals without accents (SYC-159).

The copy freeze for Johnny's pack (SYC-346) is today, 22 Oct. These strings go in the **short second pack** that SYC-346 already provides for strings added after the freeze, flagged as such (D1).

<a id="decisions"></a>
## Decisions

| # | Question | Recommendation | Status |
|---|---|---|---|
| D0 | What replaces the "new phone" and "is this your cat" lines? | One link plus a sheet (B) | **Decided by Samuel, 22 Oct** |
| D1 | Greek and French for these strings | Second pack after the freeze | **Decided by Samuel, 22 Oct:** second pack |
| D2 | Should "Is this {name}?" show even when the matcher didn't find that cat? | Always | **Decided by Samuel, 22 Oct:** always |
| D3 | Record that a pick came from the cat page? | R: record it, with a migration | **Decided by Samuel, 22 Oct:** R |
| D4 | Tapping a square with several cats | Web filters the strip now; native gets a ticket | **Decided by Samuel, 22 Oct:** as recommended |
| D5 | Open the Cat-alogue map on the phone's position or on the cats? | On the cats | **Decided by Samuel, 22 Oct:** on the cats |
| D6 | Label shared squares "3 cats"? | Claude recommended no, pending Syros Cats | **Decided by Samuel, 22 Oct:** yes, label them |
| N1 | Is "email us and we'll help" a promise the team agrees to? | Ship it | **Decided by Samuel, 22 Oct:** ship it |
| D7 | One PR for all three parts | — | **Decided by Samuel, 22 Oct** |

<a id="tests"></a>
## Tests

Each part is tested before its commit. The affected suites run locally (vitest with the esbuild workaround). The UI is checked at 390px and 1280px, in light and dark, in the browser pane, with data.

**Part 1**
- The link renders in the street and homed states, with no old line.
- There's no link for the owner, or for a cat in care or that has died.
- The sheet shows the right text in each state.
- **Rewritten on purpose:** `CatPageClaim.test.tsx` lines 180, 215 and 223 use `claimNotMetHint`, and its "a cat with a home shows neither" test now expects the link.
- The i18n key-parity test passes with the removed and added keys.
- `deleteDoneEmail` is gone from the done screen.
- `ReportAdvice.test.tsx:225` still finds the domain.
- The ear-tip order is right in both of `SightingQuestions`'s hosts.
- The dashboard map pages show "only for the team" outside the `<details>` and the explanation inside it, including the cats map.

**Part 2**
- The button shows or hides by life status.
- `for` is read, then cleared, and doesn't come back through the tab bar.
- Every row of the §2.2 table, including the banner and the ✕ label.
- `POST /sightings` body tests 6a and 6b, and the replay exact-body test, are unchanged and pass.
- The queued item keeps `hintCatId`, and review reads it by `localId`, including from `ReviewReadyBanner`.
- The question shows whatever the result (except not-a-cat), and the order of the following list is unchanged.
- **Mutation:** making the question depend on the candidates, or reordering them, must fail the leak test.
- A refusal shows on the question step, with "Carry on" going to the right screen.
- The server accepts and records `cat_page` on both suggested and hand-picked rows. The migration and rollback run against a test database.

**Part 3**
- `fitRegion`: one cell, a spread, a wide east–west spread in a short box, no cells, the zoom cap and the zoom floor.
- The web map refits on a chip change and a settled search, but not on a keystroke, a refetch or a location fix.
- Squares carry accessibility labels.
- The "N cats" label hides when the square is under 40px wide.
- Tapping a shared square on web filters the strip.
- The dashboard map:
  - fits once on the first answer;
  - doesn't fit with a focus set, after a user move, or on a filter change;
  - stays on the island with no cats.

<a id="out-of-scope"></a>
## Out of scope

- The wider wording pass (SYC-572), including "This is my cat".
- The dashboard menu (SYC-522).
- Native photo pins (forbidden by §10.7).
- Latin-letter map tiles (SYC-288).
- The native "cats in this square" sheet (a follow-up ticket).
- The hand-pick list that would read `picked_from` (`review_hand_picks`; not built).

<a id="build"></a>
## Build and deploy

**One PR (Samuel, 22 Oct 2026)**, opened as a draft. It has one commit per part, in the order Part 1, Part 3, Part 2. Each commit keeps its tests green. The "Spot Agatha now" button in Part 1's sheet is added in the Part 2 commit.

If the migration number has been taken by another branch by merge time, it's regenerated on rebase (`lib/db` migrations README).

**Deploy follows migrate-before-republish (SYC-497), because of D3:**
1. Merge.
2. Run `db-ops migrate` on production.
3. Run `db-ops verify-history`.
4. Run a `run_sql` check of the widened constraint.
5. Only then does Samuel pull and republish. Claude says "don't republish yet" until step 4 passes.


<a id="review-record"></a>
## Review record

An adversarial review (Opus, read-only) of the first draft, commit 649e405e, raised 17 findings. All are addressed:

| # | Finding | Severity | How it was addressed |
|---|---|---|---|
| 1 | D3 relied on a team flag that doesn't exist; `pickedFrom` was dropped on suggested rows | Blocker | §2.5 rewritten as options R and N, recording on every pick; claim withdrawn |
| 2 | The question can't sit "above the look-alikes"; review is four screens | Blocker | §2.3: its own first step, with no-cat and naming paths defined |
| 3 | The 6b pinned keys, `parseReviewParams` and a third `/review` path | Should-fix | §2.4 |
| 4 | Refusal shown in the picker's message slot | Should-fix | §2.3: own message slot plus "Carry on" |
| 5 | Migration failure mode and rollback described wrongly | Should-fix | §2.5 and §8 |
| 6 | The route param could revive the hint | Should-fix | §2.2: `setParams` plus the lifetime table |
| 7 | Primed "Yes" answers | Should-fix | §2.6, plus side-by-side photos |
| 8 | Dashboard fit races and refits on typing | Should-fix | §3.2: first answer, no focus, no user move |
| 9 | App fit used latitude only, the zoom floor, tile churn, the coords remount | Should-fix | §3.1 |
| 10 | "N cats" draws attention to colonies; no accessibility labels | Should-fix | D6 put to Samuel; labels specified |
| 11 | "Only for the team" must stay visible; a third copy in `catMapPage` | Should-fix | §1.5 |
| 12 | The `keepSafeWarning` rewrite contradicted the under-15 line | Should-fix | §1.4 |
| 13 | `reportCheckBlocked` test, shared use, wording | Should-fix | §1.4 |
| 14 | Missing tests that break; "team answers" unchecked | Should-fix | Tests list; claim removed |
| 15 | Ear-tip order and caption | Nit | §1.3 |
| 16 | Accessibility labels, dark mode, 390px, the offline claim, "we'll help" | Nit | Throughout, and N1 |
| 17 | Build order and shared files | Nit | §8 |
