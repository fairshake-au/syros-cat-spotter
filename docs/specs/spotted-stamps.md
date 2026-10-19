# Show every cat, stamp the ones you've spotted

**Status:** Ready for Samuel's approval. One adversarial review done and folded in (§10).
**Owner:** Samuel
**Covers:** SYC-505. The direction was decided by Samuel on 19 Oct 2026 ("agree w SYC-505"): show cat photos everywhere and mark the cats a spotter has spotted, instead of padlocking the rest.
**Related:** `docs/SPEC.md` §5.1 Home and §5.2 Cat-alog (both change, §9) · SYC-501 (the UX review this came from) · SYC-509 (accessibility pass; this spec fixes the cat card's label only) · SYC-502 (the first sighting's success screen) · SYC-6 (desktop layout, untouched here).

---

## 1. The short version

Every cat card shows its photo, for everyone. A cat **you** have spotted gets a small **"Spotted"** stamp in the top-left corner of its photo. Nothing is padlocked or darkened any more.

Home changes in one more way. A spotter who hasn't spotted a cat yet sees a big **"Spot your first cat"** button where the "0 of 18 cats spotted" bar sits today. After their first sighting the bar comes back as it is now, and the button is gone for good.

No server or data changes. The app already receives the list of cats each spotter has spotted (`spottedCatIds` on the profile).

---

## 2. Why

From the 18 Oct UX review (SYC-501, screenshots 06–08):

- **A new spotter's first two screens look empty.** Home is "0 of 18 cats spotted" and four dark padlocks. The Cat-alogue is a grid of identical dark padlocks.
- **The padlock hides nothing.** The same photos are shown openly in the Cat-alogue map's photo strip, on every cat's page and in the "Which cat is it?" picker. Tapping a locked card already opens the cat's page with its photo.
- **The photo is what makes people go looking.** A tourist recognises Mavros on the harbour steps from his photo, not from his name.
- **The padlock reads as a reward to chase**, which sits awkwardly next to onboarding's "Look, don't touch". A stamp still rewards collecting, but quietly.

---

## 3. What a spotter sees

### 3.1 A cat card (Home and the Cat-alogue list)

| | Today | After |
|---|---|---|
| Photo | Hidden under a dark overlay, unless spotted | Always shown |
| Padlock and "Spot to unlock" | On every cat not yet spotted | Gone |
| Spotted mark | None (spotted cats just aren't locked) | A **"Spotted"** stamp, top-left of the photo |
| "Has a home" house badge | Top-right of the photo | Unchanged, top-right |
| Name, sightings count, distance, "Discovered by" | Shown | Unchanged |

**The stamp.** A small pill on the photo's top-left corner: a tick icon and the word **"Spotted"**, white text on the darkest olive green (`palette.olive700`, #5f6f36). White on that green measures 5.51:1, above the 4.5:1 standard. The two lighter olives fail (3.4:1 and 2.34:1), so the pill uses olive700 in **both** light and dark mode rather than the theme's "success" colour, which is the lighter olive in dark mode. Because the pill is solid, it stays readable over any photo, including a white cat. It sits in the same 8px inset as the house badge opposite it, so the two never touch. It isn't tappable; the whole card still opens the cat's page.

**Wording, in the app's three languages** (for Johnny's pack, SYC-346):

| Key | English | Greek | French |
|---|---|---|---|
| `catSpottedStamp` | Spotted | Εντοπίστηκε | Repéré |
| `catCardA11ySpotted` (screen reader, see §3.4) | {name}. Spotted by you. | {name}. Την έχεις εντοπίσει. | {name}. Repéré par toi. |
| `catCardA11yNotSpotted` | {name}. Not spotted yet. | {name}. Δεν την έχεις εντοπίσει ακόμα. | {name}. Pas encore repéré. |

The Greek uses the app's own "spot" verb (the Spot tab is "Εντόπισε") and the feminine "την", which agrees with the word γάτα rather than with the cat's sex. That is grammatical Greek, but Johnny should confirm it. French uses "tu", as the rest of the French app does (SYC-154 tracks the "tu"/"vous" question).

### 3.2 Home

**The rule for which Home a spotter sees** is one check: has the profile loaded, and how many cats has this phone spotted?

| Profile | Hero shows |
|---|---|
| Loaded, 0 cats spotted | The first-spot line and button (below) |
| Loaded, 1 or more | "2 of 19 cats spotted" and the progress bar, as today |
| Not loaded | A dash, as today. No button and no bar |

The count and the list of spotted cats come from the same profile request, so the button and the stamps always agree (except for a sighting that happens to finish in the split second between the two parts of that request, which corrects itself on the next refresh).

**Before the first sighting:**

- The greeting row is unchanged.
- In place of the big "0" and the "of 18 cats spotted" bar, the blue hero shows one line, **"18 cats live on Syros. Can you spot one?"**, and a large **"Spot your first cat"** button that opens the Spot tab. The photo tips card opens there the first time, which is exactly what a new spotter needs.
- "18" is the whole island's count, the same number the progress bar uses today. The line deliberately says "on Syros", not "near you": the count isn't filtered by distance, so "near you" would be false for anyone reading it from a hotel in Athens.
- The three stat tiles stay, showing 0, 0 and 0. They're honest and they show where points will go.
- The cat strip below shows **photos**, nearest first when the phone's location is known (see D7 for its heading).

**After the first sighting:** Home is exactly as today ("2 of 19 cats spotted" with the progress bar), except the strip's cards show photos and stamps instead of padlocks. The strip still puts cats you haven't spotted first, so it keeps pointing you at cats to look out for.

**While the profile hasn't loaded** (a phone offline since before its profile ever loaded, or a slow first load): no button, no bar, the same dash as today, and photos with no stamps. "Don't know yet" never pretends to be "zero".

**Wording:**

| Key | English | Greek | French |
|---|---|---|---|
| `homeFirstSpotLine` | {n} cats live on Syros. Can you spot one? | {n} γάτες ζουν στη Σύρο. Μπορείς να εντοπίσεις μία; | {n} chats vivent à Syros. Tu en repères un ? |
| `homeFirstSpotCta` | Spot your first cat | Εντόπισε την πρώτη σου γάτα | Repère ton premier chat |

### 3.3 Cat-alogue list

Same card as Home (§3.1). The order is unchanged: by distance with location, otherwise most recently seen. No new filter (see D4).

### 3.4 Screen readers

Each cat card gets a label, so a screen reader says "Tigris. Spotted by you." or "Nefeli. Not spotted yet." followed by its existing text. Without the profile it just says the name. The stamp itself is hidden from screen readers so it isn't read twice. The card gets the "button" role. (The rest of SYC-509 stays in SYC-509.)

### 3.5 What doesn't change

- What counts as spotted: a **finished** sighting by this phone, which is the list the app already receives. A sighting still waiting to send (offline queue) or waiting for "Which cat is it?" doesn't stamp the cat until it's finished, the same as every count in the app (`SPEC.md` §4: "Only resolved sightings count anywhere").
  - **A cat you discovered** is stamped: your first photo of it is a finished sighting.
  - **A cat that lives with you** is stamped only if you've also spotted it with the camera. Saying "This is my cat" isn't a sighting.
- Points, badges, streaks, the leaderboard and "of N cats spotted" after the first sighting.
- The cat's own page, the map's photo strip and the picker.
- **What gets downloaded.** The padlock was drawn on top of a photo the phone had already downloaded, so showing it costs no extra data. Photos the team has hidden or removed are already swapped out by the server before the list reaches the phone, so removing the padlock reveals nothing new.

---

## 4. Decisions

Each has a recommendation. The ones marked **decided** are Samuel's.

| # | Question | Options | Recommendation |
|---|---|---|---|
| D1 | Show photos or keep padlocks? | Photos plus stamp; padlocks plus a better Home; padlock everything | **Decided (19 Oct): photos plus stamp.** |
| D2 | What does the mark look like? | (a) "Spotted" pill with a tick, top-left of the photo. (b) A tick only, no word. (c) A coloured border round the whole card. (d) Fade the cats you *haven't* spotted. | **(a).** A word is clearer than an icon for a first-time visitor, and it reads in all three languages. A border is easy to miss and colour-only (an accessibility problem). Fading puts us back where we started. |
| D3 | What does Home show before the first sighting? | (a) "Spot your first cat" button in place of the "0 of N" bar. (b) Keep "0 of N" and add the button under it. (c) No change apart from photos. | **(a).** "0 of 18" on day one reads as a score you're failing. A single clear action is friendlier, and the bar arrives with the first success, when it means something. |
| D4 | Add a "Not spotted yet" filter to the Cat-alogue? | Add it now; leave it for later | **Leave it.** The stamp already shows the difference at a glance, and three filters (All, Near me, Has a home) are enough for a phone. Easy to add later if collectors ask. |
| D5 | Keep "of N cats spotted" as Home's headline after the first sighting? | Keep; replace with something softer (e.g. "cats you've met") | **Keep.** It's the core of the game for visitors (`SPEC.md` §1), and once the padlocks are gone the pressure to chase is much lower. Revisit with Syros Cats if the "look, don't touch" message seems undermined in testing. |
| D6 | What does the house badge do if a cat is both spotted and has a home? | Both show, in opposite corners | **Both show.** They mean different things and never overlap (§3.1). |
| D7 | The Home strip's heading says "Nearby to collect" / "To collect". Keep it? | (a) Keep. (b) "Cats near you" / "Cats to look out for". | **(b).** "To collect" went with the padlocks. The strip still lists the cats you haven't spotted first, so "look out for" says what it's for. Greek: "Κοντά σου" (unchanged) / "Γάτες να εντοπίσεις". French: "Près d'ici" / "Chats à repérer". Johnny to confirm. |

---

## 5. Edge cases

1. **Profile never loaded, or offline.** The cat list is saved on the phone but the profile isn't. So a phone that has never loaded its profile shows photos with no stamps, no button and a dash. A phone that goes offline after loading it keeps showing the last stamps it had. This is a visible difference from today (padlocks used to vanish the same way), not a new problem.
2. **A profile without the spotted list** (only an out-of-date server could send one): treated as "not loaded" for both stamps and the button, so the two can never disagree.
3. **The spotter deletes their data** (Delete my data): they start again as a new spotter, so Home shows the first-spot button again. Correct.
4. **"Get your spots back" on a new phone:** the restored profile carries its `spottedCatIds`, so stamps appear once it loads.
5. **A sighting is moved to a different cat by the team** (SYC-150, later): the stamp follows `spottedCatIds`, so it moves on the next profile load.
6. **A hidden or removed main photo:** the server already replaces it before the list reaches the phone (§3.5). No change.
7. **Very long Greek or French on the button** ("Εντόπισε την πρώτη σου γάτα"): the button is full width in the hero, so it wraps to two lines rather than cutting off.
8. **Laptop width (1280px):** the hero line and button sit inside the existing hero, so they stretch with it like everything else on Home. The full-width problem itself is SYC-6 and isn't fixed here.
9. **The first-spot button and the "Don't lose your spots" offer** (SYC-502): unrelated, but SYC-502 should land first or alongside, so a new spotter's first success isn't swallowed straight after this screen invites them to make it.

---

## 6. Accessibility

- Stamp: solid pill, white on olive700, 5.51:1 in both themes (§3.1).
- Stamp text grows only a little with the phone's text-size setting (capped), so at the largest sizes it never covers the cat's face. The card's screen-reader label (§3.4) carries the same meaning for anyone using very large text or a screen reader.
- The first-spot button is the standard large primary button, 48pt tall.

---

## 7. What gets built

All in `artifacts/cat-spotter`:

1. **`components/CatCard.tsx`**: a new optional `spotted?: boolean` prop. `true` shows the stamp; `false` or missing doesn't. Adds the screen-reader label and "button" role (§3.4); the spotted / not-spotted part of the label is used only when `spotted` is a boolean (that is, the profile loaded). The `Pressable` stays the card's outermost element: `components/__tests__/PhotoViewerExcluded.test.tsx:74` taps the card's first element.
2. **`app/(tabs)/index.tsx`** (Home): remove the lock overlay and its styles; pass `spotted` to each card; add the first-spot state to the hero using the rule table in §3.2 (`profile.catsSpotted === 0` *and* the spotted list present); new heading strings (D7); update the strip's sort comment, which still talks about "Spot to unlock".
3. **`app/(tabs)/cats.tsx`** (Cat-alogue): remove the lock overlay and its styles; pass `spotted` to each card.
4. **`lib/i18n.ts`**: add the keys in §3.1, §3.2 and D7 in all three languages; remove `homeSpotToUnlock` once nothing uses it (the key-parity test catches a half-removal).
5. **`api-server/src/lib/catHelpers.ts`**: comment-only fix near line 657, which describes the list as driving "Spot to unlock".
6. **`docs/SPEC.md`** §5.1 and §5.2: the edits in §9.

No API behaviour, database or OpenAPI change. Not in scope: analytics on the new button (the app has no analytics today).

---

## 8. How we'll know it works

**Tests (vitest):**
- CatCard (extends the existing component tests): shows the stamp when `spotted` is true, and not when it's false or missing; its screen-reader label says "Spotted by you", "Not spotted yet", or just the name for true, false and missing. `PhotoViewerExcluded.test.tsx` still passes.
- Home (**new test file**; no test mounts Home today, so it needs the profile, cat-list and router hooks mocked): with 0 spotted shows the first-spot button and no progress bar; with 2 spotted shows the bar and no button; with no profile shows neither; the button opens the Spot tab; no lock overlay in any state.
- Cat-alogue (**new test file**, same mocks): stamps on spotted cats, no lock overlay.
- i18n key parity still passes for the new keys.

**Checked in the browser before the PR opens** (Samuel's rule): Home as a brand-new spotter, Home after one sighting, and the Cat-alogue list, each at 390px and 1280px, in English and Greek, and the first-spot button tapped through to Spot.

---

## 9. Edits to other documents

`docs/SPEC.md`:
- §5.1 Home: replace "Cats the device has personally spotted are shown collected; the rest render as **"spot to unlock"**." with "Every cat shows its photo; cats the device has personally spotted carry a **"Spotted"** stamp. Before a spotter's first sighting, the progress readout is replaced by a **"Spot your first cat"** button."
- §5.2 Cat-alog: replace "Same collected-vs-locked treatment." with "Same photo-and-stamp treatment."

---

## 10. Review

One adversarial review (Sonnet, 19 Oct 2026), checked against the code at `b205c685`. Its verdict: approvable once the first four were fixed. All were folded in.

| # | Finding | Handled |
|---|---|---|
| 1 | Two of the three olive greens fail contrast with white (3.4:1, 2.34:1); dark mode uses the lightest | Fixed to olive700 (5.51:1) in both themes (§3.1, §6). Figures re-checked. |
| 2 | "{n} cats live near you" was false: {n} is the whole island's count, not filtered by distance | Re-checked in `catHelpers.ts` (`totalCatCount` counts every cat). Now "{n} cats live on Syros"; the location variant is gone (§3.2). |
| 3 | The Greek "Το είδες" used the wrong gender for γάτα and wasn't the app's "spot" verb | Replaced with "Εντοπίστηκε" and "την έχεις εντοπίσει", for Johnny to confirm (§3.1, §3.2). |
| 4 | Edge case 2 let the button show without the spotted list, contradicting "unknown isn't zero" | One rule table now governs the hero; both need the full profile (§3.2, edge case 2). |
| 5 | The count and the list are two queries in one request; a tiny race | Stated in §3.2. |
| 6 | Discovered and owned cats weren't covered | Added to §3.5. |
| 7 | The privacy and data cost of showing photos wasn't evidenced | Added: photos were already downloaded under the padlock, and hidden photos are swapped out by the server (§3.5). |
| 8 | Home and the Cat-alogue have no test harness; one existing test taps the card's first element | Test plan says the Home and Cat-alogue tests are new; the card keeps its outer element (§7, §8). |
| 9 | "To collect" headings, a sort comment and a server comment still describe padlocks | New decision D7; comments listed in §7. |
| 10 | Say that Spot's photo tips open the first time | Added to §3.2. |
| 11 | French "tu" and Greek informal register | Confirmed consistent; no change. |
| 12 | Offline, desktop and analytics unaddressed | Edge cases 1 and 8; analytics out of scope (§7). |
| 13 | Code names in the main prose | Moved to §7 where possible. |
