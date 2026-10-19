# Show every cat, stamp the ones you've spotted

**Status:** Draft for Samuel's approval. Adversarial review pending (§10).
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

**The stamp.** A small pill on the photo's top-left corner: a tick icon and the word **"Spotted"**, white text on the app's olive green (`palette.olive*`), with enough contrast on any photo (a solid pill, not text over the photo). It sits in the same 8px inset as the house badge opposite it, so the two never touch. It isn't tappable; the whole card still opens the cat's page.

**Wording, in the app's three languages** (for Johnny's pack, SYC-346):

| Key | English | Greek | French |
|---|---|---|---|
| `catSpottedStamp` | Spotted | Το είδες | Repéré |
| `catCardA11y` (screen reader label, see §3.4) | {name}. Spotted by you. / {name}. Not spotted yet. | {name}. Το είδες. / {name}. Δεν το έχεις δει ακόμα. | {name}. Repéré par toi. / {name}. Pas encore repéré. |

The Greek uses the neuter "το" so it doesn't assume the cat is female. French uses "tu", as the rest of the French app does (SYC-154 tracks the "tu"/"vous" question).

### 3.2 Home

**Before the first sighting** (`catsSpotted` is 0):

- The greeting row is unchanged.
- In place of the big "0" and the "of 18 cats spotted" bar, the blue hero shows one line, **"18 cats live near you. Can you spot one?"** (or **"18 cats are waiting to be spotted"** when the phone's location isn't known), and a large **"Spot your first cat"** button that opens the Spot tab.
- The three stat tiles stay, showing 0, 0 and 0. They're honest and they show where points will go.
- The cat strip below shows **photos**, nearest first, under its existing heading ("Nearby to collect", or "To collect" without location).

**After the first sighting** (`catsSpotted` is 1 or more): Home is exactly as today ("2 of 19 cats spotted" with the progress bar), except the strip's cards show photos and stamps instead of padlocks.

**While the profile hasn't loaded** (offline on a phone that never loaded it, or a slow first load): no button, no bar. The hero shows the same dash it shows today, and the strip shows photos with no stamps. This keeps today's rule that "unknown" never pretends to be "zero" (`index.tsx`, the `hasCollectionData` comment).

**Wording:**

| Key | English | Greek | French |
|---|---|---|---|
| `homeFirstSpotLineNearby` | {n} cats live near you. Can you spot one? | {n} γάτες ζουν κοντά σου. Μπορείς να δεις μία; | {n} chats vivent près d'ici. Tu en repères un ? |
| `homeFirstSpotLine` | {n} cats are waiting to be spotted | {n} γάτες περιμένουν να τις δεις | {n} chats attendent d'être repérés |
| `homeFirstSpotCta` | Spot your first cat | Βρες την πρώτη σου γάτα | Repère ton premier chat |

"{n}" is the same total the progress bar uses today (`totalCats`). "Near you" is only used when the phone's location is known, matching the strip heading's existing rule.

### 3.3 Cat-alogue list

Same card as Home (§3.1). The order is unchanged: by distance with location, otherwise most recently seen. No new filter (see D4).

### 3.4 Screen readers

Each cat card gets a label, so a screen reader says "Tigris. Spotted by you." or "Nefeli. Not spotted yet." followed by its existing text. Without the profile it just says the name. The stamp itself is hidden from screen readers so it isn't read twice. The card gets the "button" role. (The rest of SYC-509 stays in SYC-509.)

### 3.5 What doesn't change

- The cat's own page, the map and its photo strip, and the "Which cat is it?" picker: they already show photos.
- What counts as spotted: a **resolved** sighting by this phone, which is what `spottedCatIds` already contains. A sighting still waiting to send (offline queue) or waiting for "Which cat is it?" doesn't stamp the cat until it resolves, the same as every count in the app (`SPEC.md` §4: "Only resolved sightings count anywhere").
- Points, badges, streaks, the leaderboard and "of N cats spotted" after the first sighting.

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

---

## 5. Edge cases

1. **Profile never loaded** (offline first run on a phone that later went offline, or the profile request fails): photos, no stamps, no first-spot button, the hero shows a dash. Same as §3.2.
2. **An older server** returns a profile without `spottedCatIds`: treated as "not loaded" for stamps, as today (`hasCollectionData`). The first-spot button depends on `catsSpotted`, not the list, so it can still show.
3. **The spotter deletes their data** (Delete my data): they start again as a new spotter, so Home shows the first-spot button again. Correct.
4. **"Get your spots back" on a new phone:** the restored profile carries its `spottedCatIds`, so stamps appear once it loads.
5. **A sighting is moved to a different cat by the team** (SYC-150, later): the stamp follows `spottedCatIds`, so it moves on the next profile load.
6. **A hidden or removed main photo:** the card shows whatever `photoUrl` the list returns today, including any placeholder. No change.
7. **Very long Greek or French on the button** ("Repère ton premier chat"): the button is full width in the hero, so it wraps to two lines rather than cutting off.
8. **The first-spot button and the "Don't lose your spots" offer** (SYC-502): unrelated, but SYC-502 should land first or alongside, so a new spotter's first success isn't swallowed straight after this screen invites them to make it.

---

## 6. Accessibility

- Stamp: solid pill, white on olive, contrast at least 4.5:1 (check the exact token in both themes during implementation).
- Stamp text doesn't scale past its pill: it uses the app's existing 2xs/xs size with `maxFontSizeMultiplier` capped so it never covers the cat's face. The card label (§3.4) carries the same meaning for screen readers and very large text.
- The first-spot button is the standard large primary button, 48pt tall.

---

## 7. What gets built

All in `artifacts/cat-spotter`:

1. **`components/CatCard.tsx`**: a new optional `spotted?: boolean` prop. `true` shows the stamp, `false` or `undefined` doesn't. Adds the accessibility label and role (§3.4); the label's spotted/not-spotted part is only used when `spotted` is a boolean that came from a loaded profile.
2. **`app/(tabs)/index.tsx`** (Home): remove the lock overlay and its styles; pass `spotted` to each card; add the first-spot state to the hero (§3.2).
3. **`app/(tabs)/cats.tsx`** (Cat-alogue): remove the lock overlay and its styles; pass `spotted` to each card.
4. **`lib/i18n.ts`**: add the keys in §3.1 and §3.2 in all three languages; remove `homeSpotToUnlock` once nothing uses it (the key-parity test will catch a half-removal).
5. **`docs/SPEC.md`** §5.1 and §5.2: the edits in §9.

No API, database or OpenAPI change.

---

## 8. How we'll know it works

**Tests (vitest, alongside the existing component tests):**
- CatCard shows the stamp when `spotted` is true, and not when it's false or missing.
- CatCard's accessibility label says "Spotted by you", "Not spotted yet", or just the name, for true, false and missing.
- Home with `catsSpotted: 0` shows the first-spot button and no progress bar; with `catsSpotted: 2` shows the bar and no button; with no profile shows neither.
- Home and the Cat-alogue render no lock overlay in any state.
- The first-spot button opens the Spot tab.
- i18n key parity still passes for the new keys.

**Checked in the browser before the PR opens** (Samuel's rule): Home as a brand-new spotter, Home after one sighting, and the Cat-alogue list, each at 390px and 1280px, in English and Greek, and the first-spot button tapped through to Spot.

---

## 9. Edits to other documents

`docs/SPEC.md`:
- §5.1 Home: replace "Cats the device has personally spotted are shown collected; the rest render as **"spot to unlock"**." with "Every cat shows its photo; cats the device has personally spotted carry a **"Spotted"** stamp. Before a spotter's first sighting, the progress readout is replaced by a **"Spot your first cat"** button."
- §5.2 Cat-alog: replace "Same collected-vs-locked treatment." with "Same photo-and-stamp treatment."

---

## 10. Review

Adversarial review: pending. Findings and how they were handled will be listed here.
