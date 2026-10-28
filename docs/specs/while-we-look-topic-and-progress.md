# While we look: a topic, a count, and "your next spot brings a new fact"

**Status:** Draft for Samuel's approval, 27 October 2026.
**Owner:** Samuel
**Ticket:** SYC-772. Builds on the waiting card (SYC-48, [`starter-facts.md`](./starter-facts.md)). Works with or without editable facts (SYC-754, [`editable-starter-facts.md`](./editable-starter-facts.md)). The facts page in Profile is SYC-773, later.

---

## 1. The short version

Two small changes make the cat facts feel like a set you're working through, not a loading message:

1. **The waiting card** shows the fact's **topic** with a small icon (for example *Reading a cat*), and **how far through the facts you are**: a thin bar and *"Cat fact 3 of 11"*.
2. **The thanks screen**, after a spot is confirmed, says once, under the points: *"Your next spot brings a new cat fact."* This shows only while there's still a fact this phone hasn't seen.

The facts, the order they come in, and when the card appears all stay exactly as they are now. There's no server change, no database change and no new setting.

---

## 2. Why

Samuel, 27 October 2026, asked to make *While we look* and the screen after it more engaging, so that people want to spot again. Three options were mocked up. Samuel chose a topic and a count on the waiting card (option A), and a line on the result screen. The facts page in Profile (option C) goes to the backlog as SYC-773.

The proposal to Syros Cats (§13, 27 August) also promised a fact *"where possible about the cat just photographed"*. Samuel decided against that here (27 October: *"let's keep it simple and not link the fact to the matched cat"*). That promise stays with Teaching in full (SYC-61).

**Why the count matters.** Today each fact appears and goes. Nothing says there's a set of them, or that spotting again shows you a different one. A count turns the facts into something to finish. The line on the thanks screen comes at the moment the spotter decides whether to carry on.

---

## 3. What spotters see

### 3.1 The waiting card

From top to bottom:

- **Eyebrow:** *While we look…* (unchanged).
- **Topic** (new): a small icon and the topic's name, in the eyebrow's muted colour, one line.
- **The ear-tip photo**, for the ear-tip fact only (unchanged).
- **The fact** (unchanged).
- **Progress** (new): a thin bar using the existing `ProgressBar` component, with *"Cat fact 3 of 11"* under it (or beside it, if it fits on one line). The bar is filled to 3/11.

The rest stays the same. There are no buttons, nothing to tap, and no transition. The card still takes the map's place only while a sighting is being sent.

**The six topics.** These are the six strands from the proposal (§13), already recorded against each fact in `lib/starterFacts.ts` (`strand`):

| Strand | Topic shown | Icon (Feather) |
|---|---|---|
| 1 | Reading a cat | `eye` |
| 2 | Life in a colony | `users` |
| 3 | Why sterilisation works | `heart` |
| 4 | Being around a street cat | `map` |
| 5 | When a cat needs help | `life-buoy` |
| 6 | You're doing science | `bar-chart-2` |

The icon is decoration: screen readers skip it (§3.4).

**A fact with no topic** (a fact the team adds once SYC-754 is built; the originals all have one) shows no topic line. Everything else is the same.

### 3.2 How the count works

- **The total** is the number of facts currently switched on. On the test site today, that's **11**: the 9 waiting for Syros Cats' yes are hidden (checked at `apptest.catspotters.com/api/app-settings`, 27 October 2026). When Syros Cats approve them, the total becomes 20 on its own. If the team adds or deletes facts (SYC-754), the total follows.
- **The number** is how many of those switched-on facts this phone has seen, counting the one on screen. The phone already keeps this list (`everSeen`, starter-facts.md §3.4). So the first fact a phone sees reads *1 of 11*.
- **A fact cut short** (the result arrived in under 3 seconds) isn't marked as seen, as now. The next wait shows the same fact with the same number, which is correct: it's still that fact.
- **A fact seen and later switched off** doesn't count, either in the number or the total. A fact switched back on counts again.
- **Once every switched-on fact has been seen**, the facts go round again, as now. The progress then reads *"All 11 cat facts seen"* with a full bar, on every wait, until a new fact is switched on or added.
- **No progress shown at all** when:
  - fewer than 2 facts are switched on (a count of one is meaningless);
  - the wait shows the feeding nudge, or the empty card (every fact switched off);
  - the phone's record couldn't be read (starter-facts.md §3.4). The card shows a fact and nothing else, as now.

### 3.3 The thanks screen

This is the screen after a sighting is confirmed or a new cat is named: the tick, the cat's name, the points, then *Tell us a bit more (optional)*.

**New:** one line straight under the points (or under the badge celebration, if there is one), above the questions:

> ✦ Your next spot brings a new cat fact.

It's small: body text in the muted colour, with a sparkle icon. It's not a card or a button, and there's nothing to tap.

**When it shows:** on the thanks screen, when at least one switched-on fact is one this phone has never seen. When every fact has been seen, it doesn't show, because the next fact would be a repeat. It comes back when a new fact is switched on.

**It counts the fact just shown.** It reads the phone's record **after** the wait that led here has been saved. If the fact on screen during that wait was the last unseen one, the line doesn't show.

**It doesn't show** when the phone's record can't be read, when fewer than 2 facts are switched on, or on the screens where the feeding nudge sits (matches, naming): those screens are unchanged. It shows the same way for a sighting sent earlier from the phone's queue and confirmed later.

### 3.4 Screen readers, text size, small phones

- The card still announces only *"While we look, a cat fact"* when it appears. Focus stays on the spotter's button.
- The topic is read as plain text, without the icon. The bar is read as a progress bar with *"Cat fact 3 of 11"*, and the text under it is hidden from screen readers so it isn't read twice. *"All 11 cat facts seen"* is read the same way.
- The thanks-screen line is plain text, read in order. The icon is hidden from screen readers.
- **Fit.** The card's top must be in view when it appears on an iPhone SE (375 × 667) at the default text size, in all three languages. That's the existing rule. The topic adds one line above the fact; the progress sits below it, so it may scroll out of view on a long French fact, which is fine. At the largest text size the screen scrolls, as now.

---

## 4. The words

Greek and French are drafts for Johnny's review (as with SYC-283 / SYC-346). `{n}` and `{total}` are numbers.

| Key | English | Greek (draft) | French (draft) |
|---|---|---|---|
| `factTopic1` | Reading a cat | Πώς να «διαβάσεις» μια γάτα | Comprendre un chat |
| `factTopic2` | Life in a colony | Η ζωή στην αποικία | La vie dans une colonie |
| `factTopic3` | Why sterilisation works | Γιατί η στείρωση βοηθά | Pourquoi la stérilisation marche |
| `factTopic4` | Being around a street cat | Δίπλα σε μια γάτα του δρόμου | Côtoyer un chat des rues |
| `factTopic5` | When a cat needs help | Όταν μια γάτα χρειάζεται βοήθεια | Quand un chat a besoin d’aide |
| `factTopic6` | You're doing science | Κάνεις επιστήμη | Tu fais de la science |
| `factProgress` | Cat fact {n} of {total} | Γεγονός για γάτες {n} από {total} | Info chat {n} sur {total} |
| `factProgressDone` | All {total} cat facts seen | Είδες και τα {total} γεγονότα για γάτες | Tu as vu les {total} infos chat |
| `factNextSpot` | Your next spot brings a new cat fact. | Στην επόμενη παρατήρησή σου, ένα νέο γεγονός για γάτες. | Ta prochaine observation t’apporte une nouvelle info chat. |

The Greek and French words for "spot" follow the app's own: *παρατήρηση*, *observation* (`newSpotTitle`).

**Translation files have one owner at a time** (CLAUDE.md). The build brief names the session that owns `lib/i18n.ts` for this work.

---

## 5. For the builder

### 5.1 Where things live

- **Counting** goes in `lib/waitingCard.ts`, beside the schedule, as pure functions with no React, no storage and no clock:
  - `factProgress(record, settings, shownId)` returns `{ n, total }`, `{ done: true, total }` or `null` (§3.2).
  - `hasUnseenFact(record, settings)` returns a boolean (§3.3).
  
  Both use `visibleFacts(settings)` so they agree with the schedule about which facts count.
- **The topic** comes from `factById(id)?.strand` in `lib/starterFacts.ts`. No strand means no topic line.
- **The waiting card** (`components/WaitingCard.tsx`) gets the progress as a prop, worked out by the spot screen when it chooses the wait (`startWaitingCard` in `app/(tabs)/spot.tsx`), from the record it already loads.
- **The thanks screen** (`app/review.tsx`, the `if (result)` branch). It reads the phone's record once, when the screen opens, with `loadExistingWaitingRecord`, and decides then. Settings come from the same place `useResultNudge` reads them.

  **Order matters:** the wait's record must be saved (`settleWait`) before the thanks screen reads it. Check whether the current save can still be in flight when the screen opens. If it can, make it wait or pass the settled record across. The "fact just shown" rule (§3.3) depends on it.

### 5.2 What doesn't change

- Which fact a wait shows, the fixed start (nudge, ear tip, milk), the shuffle, the 3-second rule, the feeding nudge and its one-liner (`starter-facts.md` §3, `feeding-nudge.md`).
- The record's shape. `everSeen` already exists, so no new storage key and no version bump.
- Nothing is sent to the server.

### 5.3 Tests that must exist

Pure (`lib/__tests__/waitingCard.test.ts`):

- *1 of 11* on a fresh phone with the 9 sign-off facts hidden; *3 of 11* after two seen.
- A fact cut short keeps its number on the next wait.
- A seen fact that's then hidden drops from both the number and the total; shown again, it counts again.
- Every fact seen gives *done*; adding or showing a new fact brings the count back.
- Fewer than 2 visible facts, the nudge, the empty card and an unreadable record (null) all give no progress.
- `hasUnseenFact` is false when everything visible has been seen, true when one is unseen, and false for null or fewer than 2 facts.

Component:

- `WaitingCard.test.tsx`: topic name per strand; no topic line for an id with no strand; *"Cat fact 3 of 11"*; *"All 11 cat facts seen"*; no progress for the nudge and the empty card; the bar's accessible value and label; the announcement is unchanged.
- A new `ReviewScreen.nextFact.test.tsx`: the line shows under the points when a fact is unseen; it's absent when all are seen; it's absent when the record is unreadable; it's absent on the matches and naming screens; when the fact just shown was the last unseen one, it's absent.

Every new string is in all three languages (the existing i18n completeness test covers this).

---

## 6. Decisions, each with a recommendation

### Decision 1 · What the thanks screen says

**My call (Samuel asked for "simple" and didn't pick from the three; change it here if wrong):** A.

| Option | What the spotter sees | Benefits | Risks |
|---|---|---|---|
| **A. One fixed line** *(recommended)* | *"Your next spot brings a new cat fact."* | One new line in three languages. Gives the "spot another" pull at the right moment | The same words every time get ignored after a few spots |
| B. Tease the actual next fact | *"Next spot: why a cat purrs when it's hurt"* | A stronger pull | A teaser per fact: 60 new lines across three languages, plus a teaser box when the team adds facts (SYC-754). Not simple |
| C. Nothing | Only the waiting card changes | Simplest | Nothing pulls people to spot again |

### Decision 2 · How progress looks on the card

**Recommendation: A.**

| Option | Looks like | Benefits | Risks |
|---|---|---|---|
| **A. Thin bar plus words** *(recommended)* | ▬▬▬▭▭▭▭ *Cat fact 3 of 11* | Uses the existing `ProgressBar`; easy to read at a glance | Two elements in a small card |
| B. Words only | *Cat fact 3 of 11* | Smallest | Less feeling of progress |
| C. A dot per fact | ●●●○○○○○○○○ | Most "collectable" | Twenty dots are tight on a small phone in large text, and the number changes when facts are added |

### Decision 3 · When every fact has been seen

**Recommendation: A.**

| Option | What it says | Benefits | Risks |
|---|---|---|---|
| **A. "All 11 cat facts seen"** *(recommended)* | A full bar and those words, on every wait from then on | A small reward for finishing; honest about repeats | The same words on every wait for heavy spotters |
| B. Hide the progress | Only the topic and the fact | Quieter | Finishing goes unmarked |

---

## 7. Syros Cats

Nothing here changes how Syros Cats work or what the facts say, so there are no questions for them before building (CLAUDE.md, "Ask Syros Cats before the spec"). The topic names are the six strands they saw in the proposal (§13).

---

## 8. Dates

- **Post-launch hold, 1–14 November 2026:** this is a new feature, so it's built during the hold only if Samuel says so for it. Otherwise it's built after 14 November.
- Greek and French wait for Johnny's review, as for the facts themselves.

---

## 9. Out of scope

- A fact chosen to match the cat (Samuel, 27 October). It stays with SYC-61.
- The facts page in Profile: SYC-773.
- Teasers for individual facts (Decision 1, B).
- Any change to which fact appears or when.
