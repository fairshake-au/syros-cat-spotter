# While we look: a topic, a count, and "your next spot brings a new fact"

**Status:** Approved by Samuel, 27 October 2026 ("Spec approved as written"). An independent adversarial review (Sonnet, 27 October) found 4 major and 6 minor issues. All are folded in below, and how each was handled is in §10. Updated the same day for Samuel's animated cat pictures (Decision 2).
**Owner:** Samuel
**Ticket:** SYC-772. Builds on the waiting card (SYC-48, [`starter-facts.md`](./starter-facts.md)). Works with or without editable facts (SYC-754, [`editable-starter-facts.md`](./editable-starter-facts.md)). The facts page in Profile is SYC-773, later.

---

## 1. The short version

Two small changes make the cat facts feel like a set you're working through, not a loading message:

1. **The waiting card** shows the fact's **topic** with a cute animated cat picture (for example, a ginger cat swishing its tail for *Reading a cat*). It also shows **how far through the facts you are**: a progress bar with a little cat walking along it, and *"Cat fact 3 of 11"*. Once every fact has been seen, the cat curls up asleep at the end.
2. **The thanks screen**, after a spot is confirmed, says under the points: *"Your next spot brings a new cat fact."* It shows only when that's true.

When the card appears, what it says, and the order of the facts all stay as they are, with one exception. A fact this phone has never seen now comes before a repeat (§3.5). This only makes a difference once the team adds a fact or switches one back on after a phone has seen them all.

There's no server change, no database change and no new setting.

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
- **Topic** (new): one row with the topic's cat picture (48 × 48) on the left and the topic's name beside it, in the eyebrow's muted colour.
- **The ear-tip photo**, for the ear-tip fact only (unchanged).
- **The fact** (unchanged).
- **Progress** (new): the app's usual progress bar (`ProgressBar`), filled to 3/11, with a small walking cat (about 24 points tall) standing on the bar at the end of the filled part. *"Cat fact 3 of 11"* sits under it.

There are still no buttons and nothing to tap. The card itself still appears without a transition; only the pictures inside it move. The card still takes the map's place only while a sighting is being sent.

**The six topics and their pictures.** The topics are the six strands from the proposal (§13), already recorded against each fact in `lib/starterFacts.ts` (`strand`). The first set of pictures is in [`assets/while-we-look/`](./assets/while-we-look/). Samuel will refine them with Gemini (see "The pictures" below).

| Strand | Topic shown | The picture, and how it moves |
|---|---|---|
| 1 | Reading a cat | A ginger cat with its tail held up (a friendly hello); the tail swishes, and it blinks slowly |
| 2 | Life in a colony | A grey cat and a ginger kitten side by side; they nod in turn |
| 3 | Why sterilisation works | A black-and-white cat with a clipped left ear tip; a small heart rises beside the ear |
| 4 | Being around a street cat | A ginger-and-white cat beside a water bowl; its tail sways and the water ripples |
| 5 | When a cat needs help | A grey cat with a bandaged front paw; a first-aid sign pulses and an ear twitches |
| 6 | You're doing science | A black cat peering through a magnifying glass that glides across its face |

With today's 11 facts switched on, *Reading a cat* comes up 6 times out of 11. That's expected: strand 1 has the most facts that don't need Syros Cats' yes.

**A fact with no topic.** A fact the team adds once SYC-754 is built has no topic; the originals all have one. Such a fact shows no topic row, so no picture and no name. Everything else is the same.

**The walking cat.**

- **Where it stands:** its front paws are at the end of the filled part of the bar. It never sticks out past either end of the bar: near the start or the end, it stops at the edge.
- **How it moves:** when the card appears, the bar's fill and the cat move together, from the previous fact's place to this one's, in about a second. For example, on the third fact both go from 2/11 to 3/11. The cat then walks on the spot.
- On a phone's first fact, both start from the beginning of the bar.
- A fact cut short is still unseen, so next time the same step is walked again.
- After §3.5, a fact the phone has already seen only comes up once all have been seen, and then the sleeping cat shows. So the walking cat always has a step to walk.
- **Once every fact has been seen** (*"All 11 cat facts seen"*), the walking cat is replaced by a **sleeping cat**, curled up at the end of a full bar, breathing gently while a small "z" drifts up.
- When no progress is shown (§3.2), there's no cat either.

#### The pictures: how they're made and how they move

- **Format.** Each picture is a flat SVG drawing, in the same style as the app's existing drawn cat (`components/coat/DrawnCat.tsx`): simple shapes, the same outline colour and the same coat fills. The first set includes eight drawings: the six topic cats, the walking cat and the sleeping cat.
- **Refinement.** Samuel refines the drawings with Gemini. Gemini may change the shapes, colours and details. Each file's top comment lists its moving parts, with their `id`, motion and pivot point. Gemini must keep:
  - the drawing area (`viewBox`);
  - every listed `id`;
  - each pivot.

  It may only use plain shapes with flat fills: `g`, `path`, `ellipse`, `circle`, `rect`, `polygon` and `line`. No text, gradients, filters, masks, clip paths or images, because those draw differently on iPhone, Android and the web.

  A small test checks each file in the folder: its viewBox, its listed ids, and that it uses only the allowed shapes. So a refined file that breaks a rule is caught before it's ported.
- **In the app**, each drawing becomes a small component, as `DrawnCat` is. Its named parts are moved with `react-native-reanimated`, which the app already has, following the motions in the file's comment. The SVG files' own CSS motion is only there for previewing and for Gemini; the app doesn't use it. The plan starts with a short trial to prove this works smoothly on iPhone, Android and the web (§5.1).
- **Built in.** The pictures are part of the app, so they appear with no signal, and nothing is downloaded.
- **Gentle and short.** Motions loop slowly (about 2–4 seconds), stay inside the picture, and never flash. The walking cat's steps are the exception: they're quicker, but small.
  - **All motion stops after 5 seconds** and the pictures settle in their resting pose. That's the usual accessibility limit for movement that starts by itself. Most waits are shorter than that anyway.
  - The motion also stops when the card goes.
- **"Reduce motion" on.** Every picture stays still in its resting pose. The bar and the cat are placed straight at their spot, without walking, and the sleeping cat doesn't breathe. The app checks this setting with Reanimated's `useReducedMotion`, as the badge celebration does.
- **Dark mode.** The pictures keep their own colours in both themes, so each sits on a small light, rounded plate (the card's light background colour), and a black cat never disappears into a dark card.
- **If a picture can't be drawn** (an unexpected error), the card shows the topic name, the bar and the words without it. The fact always shows.

### 3.2 How the count works

- **The total** is the number of facts currently switched on.
  - On the test site today that's **11**: the 9 waiting for Syros Cats' yes are hidden. (Checked at `apptest.catspotters.com/api/app-settings`, 27 October 2026.)
  - When Syros Cats approve the 9, the total becomes 20 without any change to the app. If the team adds or deletes facts (SYC-754), the total follows.
- **The number** is how many of those switched-on facts this phone has ever seen, plus one if the fact on screen is one it hasn't seen. In terms of the stored record: the switched-on facts in `everSeen`, plus 1 if the shown fact isn't in `everSeen`. So a phone's first fact reads *1 of 11*. In later rounds a repeat doesn't add one.
- **A fact cut short** (the result came back in under 3 seconds) isn't marked as seen, as now. The next wait shows the same fact with the same number. That's correct: it's still that fact.
- **A fact seen and later switched off** counts in neither the number nor the total. If it's switched back on, it counts again.
- **The last unseen fact** reads *"Cat fact 11 of 11"*, with a full bar.
- **Once every switched-on fact has been seen**, the facts go round again, as now. From the next wait, the progress reads *"All 11 cat facts seen"* with a full bar, on every wait. That lasts until a fact the phone hasn't seen is switched on or added.
- **No progress is shown at all** when:
  - the phone has never heard from the server. Until then every fact counts as switched on, so the total would read 20 and then drop to 11;
  - fewer than 2 facts are switched on, because a count of one means nothing;
  - the wait shows the feeding nudge, or the empty card (every fact switched off);
  - the phone's record couldn't be read (starter-facts.md §3.4). The card then shows a fact and nothing else, as now.

### 3.3 The thanks screen

This is the screen after a sighting is confirmed or a new cat is named: the tick, the cat's name, the points (or *"already counted today"*), any badge celebration, then *Tell us a bit more (optional)*.

**New:** one line between the points and the questions:

> ✦ Your next spot brings a new cat fact.

It's small: body text in the muted colour, with a sparkle icon. It's not a card or a button, and there's nothing to tap.

- **It appears with the questions,** once any badge celebration has finished. That way the celebration doesn't push it around.
- **It shows whatever the points say**: points earned, already counted today, or none.

**It shows only when it's true.** That means all of these hold:

- the phone's record can be read, and the phone has heard from the server at least once;
- 2 or more facts are switched on;
- at least one switched-on fact is one this phone has never seen. Because of §3.5, that fact is the one the next wait shows;
- the next wait won't show the feeding nudge. On a phone whose nudge hasn't been counted yet, the nudge comes first.

If any of these fails, the line doesn't show. For example, it disappears after the wait that showed the last unseen fact. When the team switches on or adds a fact, it comes back.

**The same rule for every thanks screen.** That covers a live send, a spot kept at send (the normal case today), and a spot saved for later and confirmed afterwards. The line always describes the phone's state when the screen opens, not one particular wait.

It doesn't appear on any other screen. The matches, naming, no-cat and couldn't-check screens are unchanged.

### 3.4 Screen readers, text size, small phones

- The card still announces only *"While we look, a cat fact"* when it appears. Focus stays on the spotter's button.
- The topic is read as plain text. The cat pictures, the walking cat and the sleeping cat are decoration, so screen readers skip them: the topic name and the progress words already say what they show.
- The bar is read as a progress bar whose words are *"Cat fact 3 of 11"* (or *"All 11 cat facts seen"*), not as a percentage. The words under it are hidden from screen readers, so they aren't read twice.
- The thanks-screen line is plain text, read in order. Its icon is hidden from screen readers.
- **Fit.** The existing rule stands: the card's top must be in view when it appears on an iPhone SE (375 × 667) at the default text size, in all three languages. The topic row (48-point picture and name) sits above the fact. The progress, with its walking cat, sits below and may scroll out of view on a long French fact, which is fine. The picture's size is fixed, not adjusted while the app runs: 48 points unless the real-phone check finds the card's top out of view, in which case it's set to 40 for everyone. The topic name wraps onto a second line beside the picture when it has to, for example a long Greek name at large text. The tallest card is the ear-tip fact with its photo, so the plan must check that one on a real small phone in all three languages. At the largest text size the screen scrolls, as now.

### 3.5 One change to the order: unseen facts first

Today, when a fact is switched on or added after a phone has finished its first round, the fact goes into the round at a random place. That could be many waits away. That would make the thanks-screen line untrue: the next spot might show a repeat.

**New rule:** when choosing a fact, any switched-on fact this phone has never seen comes before a repeat.

- **In the first round nothing changes**, because every fact is unseen. The fixed start (nudge, ear tip, milk) and the shuffle stay as they are.
- **What changes:** a fact switched on or added later comes up on the next wait. Today it comes up somewhere before the round ends, so with this rule it comes sooner (editable-starter-facts.md §3).
- **The fact seen last** still never comes straight back.

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

For "spot", the Greek and French follow the app's own words: *παρατήρηση* and *observation* (`newSpotTitle`). The topic keys are numbered by strand, not named after facts.

**Translation files have one owner at a time** (CLAUDE.md). The build brief names the session that owns `lib/i18n.ts` for this work.

---

## 5. For the builder

### 5.1 Where things live

**Counting and choosing** go in `lib/waitingCard.ts`, as pure functions, with no React, no storage and no clock. All of them work from `visibleFacts(settings)`, never from `FACT_IDS` directly, so they keep working when facts come from the server (SYC-754).

- `chooseForWait` applies §3.5. When finding the next fact, it takes the first entry in `order` that is visible and not in `everSeen`. Only if there's none does it fall back to today's rule (the first not in `seenFacts`, then a new round).
- `factProgress(record, settings, shownId)` returns `{ n, total }`, `{ done: true, total }` or `null`, as in §3.2.
- `nextSpotBringsNewFact(record, settings, ctx)` returns a boolean, as in §3.3. It uses the same "is the nudge due" test as `chooseForWait`. Both should share one small helper, so the two can't drift apart.

**The topic** comes from `factById(id)?.strand` in `lib/starterFacts.ts`. No strand means no topic row.

**The pictures** go in `components/waitingCats/`, one component per drawing (six topic cats, `WalkingCat`, `SleepingCat`), each a port of its SVG file in `docs/specs/assets/while-we-look/` (as refined by Samuel), drawn with `react-native-svg`.

- **Start with a trial (half a day to a day).** Prove that `react-native-reanimated` can smoothly animate a `react-native-svg` group's transform and opacity on iPhone, Android and the web. Cover rotate, scale, translate and skew, with this project's new architecture switched on (`app.json`). The send keeps the JavaScript side busy while the card shows, so the motion must run on the UI thread.
  - **Pivots:** a group has no CSS pivot. Each turn, scale or skew about a pivot (px, py) is written as translate(px, py), then the turn, then translate(−px, −py).
  - **If the trial fails,** each moving part becomes its own small `Svg` inside an `Animated.View` that moves instead. The drawing looks the same either way.
- Each component moves its named parts as its file's comment says. It stops all motion after 5 seconds and on unmount (`cancelAnimation`).
- Each one checks `useReducedMotion()` and holds still when it's on.
- Each one is decorative, hidden from screen readers on every platform: `accessible={false}`, `importantForAccessibility="no-hide-descendants"`, `accessibilityElementsHidden`, and `aria-hidden` on the web.
- **The bar.** `WaitingCard` wraps `ProgressBar` in a `View` that measures its width (`onLayout`). It draws the fill and the walking cat over the bar, both animated from `(n − 1) / total` to `n / total`, or placed straight at `n / total` when "reduce motion" is on. The cat's front paws sit at the fill's end, clamped so the cat stays within the bar.
  - A pure function, `catPosition(n, total, barWidth, catWidth)`, works out the cat's position, so tests don't need a real layout.
  - `SleepingCat` replaces it for *done*.
- `WaitingCard` picks the topic picture by strand.
- Ports must keep the drawings' look, so the app matches what Samuel approved.

**The waiting card** (`components/WaitingCard.tsx`) gets the progress as a new prop. The spot screen works it out in `startWaitingCard` (`app/(tabs)/spot.tsx`), from the choice and record it already has.

**The thanks screen** (`app/review.tsx`, the `if (result)` branch) gets its answer from `useResultNudge`. Don't add a second read of the phone's record.

- The hook already reads the record once, when /review opens. That's after the wait has been saved, because `settleWait` is awaited before `router.push`, which was checked at `spot.tsx:1025–1035` and `:1084`.
- The hook returns a new field, `nextSpotBringsNewFact`. It's worked out from the record the hook saves, so a nudge counted on this screen is already taken into account.
- The hook already treats a spot kept at send as a live send. The new field needs no such distinction, because §3.3 uses one rule for every thanks screen.
- The thanks screen stays read-only. A second read-and-save could overwrite the hook's save.

**The progress bar.** Using `ProgressBar` as it is with a `label` would print the label and also "3/11", and screen readers would read a percentage. Add two optional props instead:

- `hideValue`, which drops the "3/11";
- `accessibilityText`, which sets the bar's label and `accessibilityValue.text`.

Other uses of `ProgressBar` (Profile, badges, campaign card) don't pass these props, so they're unchanged.

### 5.2 What doesn't change

- When the card appears, the fixed start, the shuffle within a round, the 3-second rule, and the feeding nudge with its one-liner (`starter-facts.md` §3, `feeding-nudge.md`). The order changes only as §3.5 says.
- The record's shape. `everSeen` already exists, so there's no new storage key and no version bump.
- Nothing is sent to the server.

### 5.3 Tests that must exist

Pure (`lib/__tests__/waitingCard.test.ts`):

- *1 of 11* on a fresh phone with the 9 sign-off facts hidden. *3 of 11* after two seen. A repeat in round 2 doesn't add one. The last unseen fact gives *11 of 11*; the next wait gives *done*.
- A fact cut short keeps its number on the next wait.
- A seen fact that's then hidden drops from both the number and the total. Shown again, it counts again.
- No progress when the settings have never loaded, when fewer than 2 facts are visible, for the nudge and the empty card, and for a null record.
- An id that isn't in `STARTER_FACTS` (a server-added fact) counts in the total and has no strand.
- §3.5: after a full round, un-hiding a fact makes it the next wait's fact. Round 1 order is unchanged from today, so the existing schedule tests still pass. The fact seen last still never comes straight back.
- `nextSpotBringsNewFact` is:
  - true when an unseen fact is visible and the nudge isn't due;
  - false when the nudge is due, when everything visible has been seen, for a null record, when settings haven't loaded, and with fewer than 2 facts;
  - false straight after the wait that showed the last unseen fact.

Component:

- `WaitingCard.test.tsx`:
  - a topic name per strand, and no topic line for an id with no strand;
  - *"Cat fact 3 of 11"* and *"All 11 cat facts seen"*;
  - no progress for the nudge or the empty card;
  - the bar's accessible label and value text, with the visible words hidden from screen readers;
  - the announcement is unchanged.
- The pictures:
  - the right topic picture for each strand, and none for a fact with no strand;
  - `catPosition`: 3/11 puts the front paws at 3/11 of the width; 1/11 and 11/11 stay within the bar;
  - the fill and the cat start at 2/11 and end at 3/11;
  - all motion stops after 5 seconds, and is cancelled when the card unmounts;
  - every picture is hidden from screen readers;
  - the drawings check (Node): every file in `docs/specs/assets/while-we-look/` keeps its viewBox and listed ids, and uses only the allowed shapes;
  - the sleeping cat, and no walking cat, for *done*;
  - no cat when there's no progress;
  - with "reduce motion" on, nothing animates and the walking cat is placed straight at its spot;
  - each picture renders in the web build too.
- `ProgressBar`: `hideValue` drops "3/11", and `accessibilityText` sets the label and value text. Without them it renders as today.
- A new `ReviewScreen.nextFact.test.tsx`, where the line:
  - shows on a live send's thanks screen when an unseen fact remains;
  - shows on a kept-at-send spot (the normal path) and on a spot saved for later;
  - is absent when everything has been seen, and when the next wait would be the nudge;
  - is absent when the record can't be read;
  - is hidden during a badge celebration and appears with the questions;
  - shows with *"already counted today"* as well as with points.
- `useResultNudge`: the new field reflects the record after a nudge is counted.

Every new string is in all three languages (the existing i18n completeness test covers this).

---

## 6. Decisions, each with a recommendation

### Decision 1 · What the thanks screen says

**My call (Samuel asked for "simple" and didn't choose between these; change it here if wrong):** A.

| Option | What the spotter sees | Benefits | Risks |
|---|---|---|---|
| **A. One fixed line, shown only when true** *(recommended)* | *"Your next spot brings a new cat fact."* | One new line in three languages. It gives the "spot another" pull at the right moment, and it's never false | The same words every time get ignored after a few spots. Needs the small order change in §3.5 to stay true |
| B. Tease the actual next fact | *"Next spot: why a cat purrs when it's hurt"* | A stronger pull | A teaser for every fact: 60 new lines across three languages, plus a teaser box when the team adds facts (SYC-754). Not simple |
| C. A looser line | *"Keep spotting to see more cat facts."* | No order change needed | Weaker, and still untrue once every fact has been seen |
| D. Nothing | Only the waiting card changes | Simplest | Nothing pulls people to spot again |

### Decision 2 · Pictures on the card

**Decided by Samuel, 27 October 2026:** both of the options he was shown.

- A cute animated cat picture for each topic, in place of the plain icons.
- A cat that walks along the progress bar.

Samuel refines the first set of drawings with Gemini (§3.1, "The pictures").

### Decision 3 · When every fact has been seen

**Recommendation: A.** The sleeping cat comes from Decision 2.

| Option | What it says | Benefits | Risks |
|---|---|---|---|
| **A. "All 11 cat facts seen"** *(recommended)* | A full bar with the cat curled up asleep at the end, and those words, on every wait from then on | A small reward for finishing, and honest about repeats | The same words on every wait for heavy spotters |
| B. Hide the progress | Only the topic and the fact | Quieter | Finishing goes unmarked |

---

## 7. Syros Cats

Nothing here changes how Syros Cats work or what the facts say, so there are no questions for them before building (CLAUDE.md, "Ask Syros Cats before the spec"). The topic names are the six strands they saw in the proposal (§13).

---

## 8. Dates

- **Post-launch hold, 1–14 November 2026.** This is a new feature, so it's built during the hold only if Samuel says so for it. Otherwise it's built after 14 November.
- Greek and French wait for Johnny's review, as for the facts themselves.
- **Pictures:** Samuel refines the first set with Gemini before the build starts. The build ports whatever is in `docs/specs/assets/while-we-look/` at that point. A picture changed after that is a small follow-up, not a blocker.

---

## 9. Out of scope

- A fact chosen to match the cat (Samuel, 27 October). It stays with SYC-61.
- The facts page in Profile: SYC-773.
- Teasers for individual facts (Decision 1, B).
- Any change to when the card appears, or to the order within the first round.

---

## 10. Review

An independent adversarial review (Sonnet, read-only, 27 October 2026) checked this spec against the code. The main points were re-checked by hand. Here is how each finding was handled.

| # | Finding | Severity | Handled |
|---|---|---|---|
| 1 | The line can be false. A fact added mid-round lands at a random place, a pending nudge comes first, and a fact cut short repeats | Major | Added the order change (§3.5), the nudge check, and the rule that the line shows only when true (§3.3). A fact cut short counts as unseen, so the next wait does bring it, as the line says |
| 2 | A second read of the record on the thanks screen could race with, or overwrite, the feeding nudge's save | Major | The answer comes from `useResultNudge`'s single read, and the screen is read-only (§5.1). Timing checked by hand: the wait is saved before /review opens |
| 3 | Queued and kept-at-send spots: "the fact just shown" doesn't apply, and most live sends carry a local id | Major | One rule for every thanks screen, based on the phone's state when it opens (§3.3). Tests cover kept-at-send and saved-for-later spots |
| 4 | Count rules: unloaded settings read "of 20"; the formula for the number wasn't stated; "11 of 11" then "done" | Major | No progress until the settings have loaded. Formula stated (§3.2). "11 of 11", then "All 11 seen", chosen |
| 5 | `ProgressBar` prints "3/11" next to its label, and its screen-reader text was wrong | Minor | Two optional props (§5.1); other uses unchanged |
| 6 | Screen readers would read the bar as a percentage | Minor | `accessibilityValue.text` set (§3.4, §5.1) |
| 7 | Placement: the celebration would move the line; there's no points line on a "repeat today" | Minor | The line appears with the questions, under the points or the repeat message (§3.3) |
| 8 | The ear-tip card is the tallest and wasn't checked on a small phone | Minor | Real small-phone check required in the plan (§3.4) |
| 9 | Facts from the server (SYC-754) have no topic; counting must not read `FACT_IDS` directly | Minor | All functions work from `visibleFacts`; a test uses an id not in `STARTER_FACTS` (§5.1, §5.3) |
| 10 | "Unchanged" claims: the hook and the card gain new fields; some planned tests were trivially true | Minor | Stated in §5.1. Tests replaced with ones that can fail (§5.3) |

The builder questions the review raised are all answered above, except for two. The owner of the translation file is named in the build brief. Whether to build during the hold is Samuel's call (§8).

### 10.1 Second review: the animated pictures

A second independent review (Sonnet, read-only, 27 October 2026) checked the picture additions and the drawings. It found no blockers, 3 major issues and 9 minor ones.

| # | Finding | Severity | Handled |
|---|---|---|---|
| 1 | Animating parts of an SVG drawing with Reanimated is unproven here, and groups have no CSS pivot | Major | A trial at the start of the plan on iPhone, Android and the web, with the pivot method written out and a fallback (§5.1) |
| 2 | The cat's place on the bar wasn't defined, and the bar's fill wouldn't move with the cat | Major | Front paws at the fill's end, kept within the bar. The fill and the cat move together. A pure position function for tests (§3.1, §5.1) |
| 3 | Nothing limited what a refined drawing could contain, and pivots were only in the CSS | Major | Each file's comment lists every moving part and pivot. Allowed shapes are listed. A Node test checks every file (§3.1, §5.3) |
| 4 | The clipped ear was named "right" in the file and "left" in the spec | Minor | Renamed `ear-clipped`; the comment says it's the cat's left ear |
| 5 | The walking cat's ears were cut off when it bobbed, and its eye didn't bob | Minor | Drawing area enlarged; eye moved into the cat |
| 6–7 | The ripple's pivot was off; the sleeping cat's comment disagreed with its motion | Minor | Both fixed |
| 8 | Looping motion with no end, and the walking cat breaks the "slow" rule | Minor | All motion stops after 5 seconds and on unmount; the walking cat is named as the exception |
| 9 | "Stands still for a repeat" can't happen after §3.5 | Minor | Removed, and the reason stated |
| 10 | `accessible={false}` alone doesn't hide pictures on Android or the web; the files had screen-reader labels | Minor | Full set of hiding props listed; files marked `aria-hidden` |
| 11 | Black cats vanish on a dark card | Minor | A small light plate behind each picture |
| 12 | The small-phone size rule was vague, and long topic names could overflow | Minor | One fixed size chosen at the device check; topic names wrap |

The sleeping cat's "z" is now a drawn shape, not text.
