# While We Look: Topic, Progress and Next-Fact Line — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The waiting card shows the fact's topic with an animated cat picture, and a progress bar with a cat walking along it ("Cat fact 3 of 11"; a sleeping cat once all are seen). The thanks screen says "Your next spot brings a new cat fact." only when that's true.

**Architecture:**
- **Pure rules** in `lib/waitingCard.ts`: counting, the next-fact test, and the "unseen first" change to `chooseForWait`. These are worked out once per wait in `spot.tsx`, and once per result screen in `useResultNudge`, with no new storage.
- **Drawings** become small `react-native-svg` components in `components/waitingCats/`. A shared motion helper moves their named parts with Reanimated, stops all motion after 5 seconds, and holds still under "reduce motion".

**Tech Stack:** Expo / React Native 0.81 (new architecture on), react-native-svg 15.12.1, react-native-reanimated ~4.1.1, vitest + @testing-library/react (jsdom).

**Spec:** `docs/specs/while-we-look-topic-and-progress.md` (approved by Samuel, 27 Oct 2026). Drawings: `docs/specs/assets/while-we-look/`. Ticket: SYC-772.

## Global Constraints

- **Build window:** no code merges during the post-launch hold (1–14 Nov 2026) unless Samuel says so for this feature. Otherwise start after 14 Nov.
- **Translation file owner:** one session at a time owns `artifacts/cat-spotter/lib/i18n.ts`. The coordinator names it in the brief; if it doesn't, ask Samuel before Task 5.
- **Drawings:** port whatever is in `docs/specs/assets/while-we-look/` when Task 6 starts. Samuel refines them with Gemini first.
- **PRs:** one draft PR (`gh pr create --draft`). Run the affected tests locally before pushing. Then `gh pr ready` once, and wait for a real "Test and build" pass. Never merge a draft.
- **Local tests:** run from `artifacts/cat-spotter` with `ESBUILD_BINARY_PATH=<scratchpad>/package/bin/esbuild pnpm exec vitest run <file>`. Follow the memory note "Local vitest/esbuild workaround" for setup.
- **Test data:** letters only in any test cat name; no wall clock (pass `today` and `random`; use fake timers for the 5-second cap).
- **Copy, verbatim from spec §4.** English is final; Greek and French are drafts for Johnny. Topic keys are `factTopic1`…`factTopic6`, numbered by strand:
  - `factProgress`: "Cat fact {n} of {total}"
  - `factProgressDone`: "All {total} cat facts seen"
  - `factNextSpot`: "Your next spot brings a new cat fact."
- **Motion:**
  - loops of about 2–4 s; the walking cat's steps are the exception;
  - all motion stops after **5000 ms** and on unmount;
  - none at all under `useReducedMotion()`;
  - the walk along the bar takes about **1000 ms** with easing.
- **Sizes:**
  - topic picture **48 × 48** points (40 only if Task 9's device check needs it, then for everyone);
  - walking cat about **24** points tall;
  - each picture sits on a light rounded plate (`#fbfaf6`, the drawings' white).
- **Pictures are decorative everywhere:** `accessible={false}`, `importantForAccessibility="no-hide-descendants"`, `accessibilityElementsHidden`, and `aria-hidden` on the web.
- **Allowed SVG elements:** `svg`, `style`, `g`, `path`, `ellipse`, `circle`, `rect`, `polygon`, `line`. No text, gradients, filters, masks, clip paths or images.

## Review Focus

1. **A send slower than 5 seconds.** Motion must settle into the resting pose and stay still while the card remains (Task 7 test: fake timers, advance 5100 ms).
2. **Settings arrive in the middle of a wait** (the switches load late). The card's progress is worked out once, when the wait starts, and doesn't jump (Task 8 test).
3. **"Delete my data" between the wait and the thanks screen.** The record reads as null, so the line doesn't show and nothing crashes (Task 9 test).
4. **The card unmounts during the walk** (a fast result). `cancelAnimation` runs and there's no update after unmount (Task 7 test).
5. **Greek at large text.** The longest topic name wraps beside the picture instead of overflowing (Task 8 test renders `el` strand 4; Task 10 checks it on a real phone).

---

### Task 1: Trial — Reanimated moving SVG parts on iPhone, Android and web

This is a throwaway trial. Its result decides how Task 6 builds the motion helper. **Model: Opus** (native animation debugging across three platforms; a wrong call here costs the whole picture work).

**Files:**
- Create (throwaway, not committed to main): `artifacts/cat-spotter/app/dev-trial-cats.tsx`, a route showing one animated `G`
- Create: `docs/superpowers/plans/2026-10-27-while-we-look-trial-result.md`

- [ ] **Step 1:** Build a screen with one `Svg` holding an `Animated.createAnimatedComponent(G)`. Drive it with `useAnimatedProps`:
  - rotate about a pivot, written as `translate(px py) rotate(a) translate(-px -py)`, using `topic-1`'s tail pivot 108,124;
  - scaleY about 80,56;
  - translateY;
  - skewX;
  - opacity.

  While it runs, keep the JS thread busy (a 3-second busy loop on a button) to mimic a send.
- [ ] **Step 2:** Run it on the iOS Simulator, the Android emulator (if one is installed; if not, say so in the result) and the Expo web preview. Pass means all five motions are smooth while the JS thread is busy, on each platform.
- [ ] **Step 3:** Write the result file with:
  - **A (animated `G` props work)**, or **B (fallback):** each moving part is its own small `Svg` inside an `Animated.View` that carries the transform;
  - the exact pivot recipe that worked;
  - per-platform notes.
- [ ] **Step 4:** Delete the trial route. Commit only the result file.

```bash
git add docs/superpowers/plans/2026-10-27-while-we-look-trial-result.md
git commit -m "SYC-772: trial result, Reanimated on react-native-svg parts"
```

---

### Task 2: Counting, next-fact test, and unseen-first order (pure)

**Files:**
- Modify: `artifacts/cat-spotter/lib/waitingCard.ts`
- Test: `artifacts/cat-spotter/lib/__tests__/waitingCard.test.ts`

**Interfaces:**
- Produces:
  - `export function isNudgeDue(record: WaitingRecord, ctx: Pick<ScheduleContext, 'nudgeEnabled' | 'signedInRole'>): boolean`. True when `ctx.nudgeEnabled && !record.nudgeCounted && ctx.signedInRole === null`. `chooseForWait` uses it in place of its inline test.
  - `export type FactProgress = { kind: 'count'; n: number; total: number; walkFrom: number } | { kind: 'done'; total: number }`
  - `export function factProgress(record: WaitingRecord | null, settings: SettingsView, choice: WaitChoice): FactProgress | null`
  - `export function nextSpotBringsNewFact(record: WaitingRecord | null, settings: SettingsView, ctx: Pick<ScheduleContext, 'nudgeEnabled' | 'signedInRole'>): boolean`

Rules for `factProgress`, with `visible = visibleFacts(settings)` and `seen` = the number of visible ids in `record.everSeen`:

- `null` when any of these holds: `record === null`, `!settings.loaded`, `choice.kind !== 'fact'`, or `visible.length < 2`.
- If `choice.id` isn't in `everSeen`: `{ kind: 'count', n: seen + 1, total: visible.length, walkFrom: seen }`.
- Otherwise, if `seen === visible.length`: `{ kind: 'done', total }`.
- Otherwise: `{ kind: 'count', n: seen, total, walkFrom: seen }`. This only happens when settings change during a wait.

Rule for `nextSpotBringsNewFact`: true only when all of these hold:
- the record is not null;
- `settings.loaded`;
- `visible.length >= 2`;
- `!isNudgeDue(record, ctx)`;
- some visible id isn't in `record.everSeen`.

`chooseForWait` change (spec §3.5): after `withRepairedOrder`, pick `next.order.find((f) => !next.everSeen.includes(f))` first. Only when that's `undefined` does it fall back to today's "first not in `seenFacts`, else a new round".

- [ ] **Step 1: Write the failing tests.** Use a `settings(hidden = SIGN_OFF_9)` helper that returns `{ loaded: true, linkOn: true, hiddenFacts: hidden, extraPhotosOn: false }`. `SIGN_OFF_9` is the 9 ids from `lib/db/src/appSettings/shape.ts` `SIGN_OFF_FACT_IDS`, copied into the test.

```ts
describe('factProgress', () => {
  it('first fact on a fresh phone reads 1 of 11 and walks from 0', () => {
    expect(factProgress(emptyRecord(), settings(), { kind: 'fact', id: 'fact.milk' }))
      .toEqual({ kind: 'count', n: 1, total: 11, walkFrom: 0 });
  });
  it('3 of 11 after two seen', () => { /* everSeen: milk, litters; shown: hiss → n 3, walkFrom 2 */ });
  it('the last unseen fact reads 11 of 11; with all seen, a repeat reads done', () => { /* … */ });
  it('a seen fact that is now hidden counts in neither number nor total', () => { /* everSeen has fact.earTip (hidden) → total 11, not counted */ });
  it('the total is always visibleFacts(settings).length', () => { /* with 0, 9 and 18 hidden */ });
  it('null for: record null, settings not loaded, nudge, empty, fewer than 2 visible', () => { /* five expects */ });
});
describe('nextSpotBringsNewFact', () => {
  it('true with an unseen visible fact and the nudge counted', () => {});
  it('false when the nudge is due', () => {});
  it('false when everything visible is in everSeen', () => {});
  it('false for null record, settings not loaded, fewer than 2 visible', () => {});
  it('false right after settleWait marks the last unseen fact seen', () => {});
});
describe('chooseForWait: unseen first', () => {
  it('after a full round, un-hiding a fact makes it the next wait\'s fact', () => {});
  it('round 1 order is unchanged (existing schedule tests still pass)', () => {});
  it('never repeats lastFactId first in a new round', () => {});
});
```

A fact added on the server (spec §5.3) can't exist until SYC-754, because `visibleFacts` reads `FACT_IDS`. Tying the total to `visibleFacts(settings).length` keeps it right when SYC-754 lands. Task 8 covers a strand-less id on the card. Leave a one-line comment pointing to SYC-754.

- [ ] **Step 2:** Run `pnpm exec vitest run lib/__tests__/waitingCard.test.ts`. Expected: the new tests FAIL (the functions aren't exported).
- [ ] **Step 3:** Implement `isNudgeDue`, `factProgress`, `nextSpotBringsNewFact` and the `chooseForWait` change in `lib/waitingCard.ts`, with doc comments citing spec §3.2, §3.3 and §3.5.
- [ ] **Step 4:** Run the same command. Expected: all PASS, existing tests included.
- [ ] **Step 5: Commit.**

```bash
git add artifacts/cat-spotter/lib/waitingCard.ts artifacts/cat-spotter/lib/__tests__/waitingCard.test.ts
git commit -m "SYC-772: fact progress, next-fact test, unseen facts first"
```

---

### Task 3: Where the cat stands on the bar (pure)

**Files:**
- Create: `artifacts/cat-spotter/lib/catPosition.ts`
- Test: `artifacts/cat-spotter/lib/__tests__/catPosition.test.ts`

**Interfaces:**
- Produces: `export function catPosition(n: number, total: number, barWidth: number, catWidth: number): number`. It returns the cat's left offset in points. The cat faces right, and its front paws (right edge) sit at the fill's end: `barWidth * n / total - catWidth`, clamped to `[0, barWidth - catWidth]`. It returns 0 when `total <= 0` or `barWidth <= catWidth`.

- [ ] **Step 1: Write the failing tests:**

```ts
expect(catPosition(3, 11, 330, 36)).toBe(54);
expect(catPosition(1, 11, 330, 36)).toBe(0);
expect(catPosition(11, 11, 330, 36)).toBe(294);
expect(catPosition(0, 11, 330, 36)).toBe(0);
expect(catPosition(3, 0, 330, 36)).toBe(0);
```

- [ ] **Step 2:** Run `pnpm exec vitest run lib/__tests__/catPosition.test.ts`. Expected: FAIL (the module is missing).
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5: Commit** with the message "SYC-772: catPosition".

---

### Task 4: ProgressBar gains `hideValue` and `accessibilityText`

**Files:**
- Modify: `artifacts/cat-spotter/components/purropolis/ProgressBar.tsx`
- Test: `artifacts/cat-spotter/components/__tests__/ProgressBar.test.tsx` (create)

**Interfaces:**
- Produces: `ProgressBarProps` gains `hideValue?: boolean` and `accessibilityText?: string`.
  - With `hideValue`, the `{value}/{max}` text isn't rendered. The label still renders if one is given.
  - With `accessibilityText`, the bar gets `accessibilityLabel={accessibilityText}` and `accessibilityValue={{ min: 0, max, now: value, text: accessibilityText }}`.
  - Without either prop, the output is identical to today.

- [ ] **Step 1: Write the failing tests:**
  - with `label="L" value={3} max={11}` and no new props, "3/11" renders (today's behaviour);
  - with `hideValue`, "3/11" is absent;
  - with `accessibilityText="Cat fact 3 of 11"`, the progressbar element has that label, and its value text is that string.
- [ ] **Step 2:** Run it. Expected: the two new cases FAIL.
- [ ] **Step 3:** Implement the two props.
- [ ] **Step 4:** Run `ProgressBar.test.tsx` and `components/__tests__/ProfileScreen.test.tsx` (which already uses the bar). Expected: PASS.
- [ ] **Step 5: Commit** with the message "SYC-772: ProgressBar hideValue and accessibilityText".

---

### Task 5: The words

**Files:**
- Modify: `artifacts/cat-spotter/lib/i18n.ts` (en, el and fr blocks, next to `waitingFactA11yLabel`)
- Test: the existing `artifacts/cat-spotter/lib/__tests__/i18n.test.ts` (completeness)

- [ ] **Step 1:** Add the 9 keys from spec §4 in all three languages, verbatim, with a comment: `// SYC-772: topic names, progress and the next-fact line. Greek and French are drafts for Johnny.`
- [ ] **Step 2:** Run `pnpm exec vitest run lib/__tests__/i18n.test.ts`. Expected: PASS (every key in all three languages).
- [ ] **Step 3: Commit** with the message "SYC-772: words for topics, progress and the next-fact line".

---

### Task 6: The drawings check and the cat components

**Model: Sonnet.** This is mechanical porting from SVG, once Task 1's pattern is fixed.

**Files:**
- Test: `artifacts/cat-spotter/lib/__tests__/waitingCatsDrawings.test.ts` (Node; reads `path.resolve(__dirname, '../../../../docs/specs/assets/while-we-look')`)
- Create: `artifacts/cat-spotter/components/waitingCats/motion.ts`
- Create: `artifacts/cat-spotter/components/waitingCats/ReadingCat.tsx`, `ColonyCats.tsx`, `EarTipCat.tsx`, `WaterBowlCat.tsx`, `HelpCat.tsx`, `ScienceCat.tsx`, `WalkingCat.tsx`, `SleepingCat.tsx`
- Create: `artifacts/cat-spotter/components/waitingCats/TopicCat.tsx`
- Test: `artifacts/cat-spotter/components/__tests__/waitingCats.test.tsx`

**Interfaces:**
- Produces:
  - `motion.ts`: `export function pivot(px: number, py: number, op: string): string`, which returns `translate(px py) ${op} translate(-px -py)`. This applies if Task 1 chose A; if it chose B, use the equivalent style transform.
  - `motion.ts`: `export function useLoop(periodMs: number, opts?: { stopAfterMs?: number }): SharedValue<number>`. It runs 0→1→0 repeatedly with easing and stops at 0 after `stopAfterMs` (default **5000**). It never starts under `useReducedMotion()`, and calls `cancelAnimation` on unmount.
  - `export function TopicCat(props: { strand: 1 | 2 | 3 | 4 | 5 | 6; size?: number }): JSX.Element`. Default size 48. It draws the matching cat on the light plate and is hidden from screen readers (Global Constraints). Each topic component takes `{ size: number }`.
  - `export function WalkingCat(props: { height?: number }): JSX.Element`, default height 24.
  - `export function SleepingCat(props: { height?: number }): JSX.Element`, default height 24.
  - `export const WALKING_CAT_ASPECT = 48 / 35` (from the viewBox `0 -3 48 35`).

- [ ] **Step 1: Write the failing drawings check.** For each `.svg` in the folder:
  - parse the `viewBox`; it must equal `0 0 160 160` for `topic-*`, `0 -3 48 35` for `progress-walking-cat`, and `0 0 48 32` for `progress-sleeping-cat`;
  - read the ids before each `:` in the comment's `Moving parts:` line (split on `|` and `,`) and assert each one exists as `id="…"`;
  - every tag name is in the allowed list.
- [ ] **Step 2:** Run it. Expected: PASS against the current files. Then prove it can fail: temporarily change one file's `id="tail"`, see it FAIL, and revert the change.
- [ ] **Step 3: Write the failing component tests.** Mock `react-native-svg` and `react-native-reanimated` as `BadgeCelebration.test.tsx` does, adding `useSharedValue`, `withRepeat`, `withTiming`, `cancelAnimation` and `useAnimatedProps` mocks.
  - `TopicCat` renders a distinct `testID` for each strand 1–6 (`topic-cat-1` … `topic-cat-6`);
  - it's hidden from screen readers (`aria-hidden` / `accessibilityElementsHidden`);
  - with reduced motion, `withRepeat` is never called;
  - with fake timers, `cancelAnimation` is called after 5100 ms, and again on unmount (Review Focus 1 and 4).
- [ ] **Step 4:** Run it. Expected: FAIL (the modules are missing).
- [ ] **Step 5:** Implement `motion.ts` and the eight components. Port each SVG shape for shape, keep its ids as component names or comments, and apply the motion and pivots from the file's `Moving parts` comment, using Task 1's method.
- [ ] **Step 6:** Run both test files. Expected: PASS.
- [ ] **Step 7: Commit** with the message "SYC-772: animated cat pictures and the drawings check".

---

### Task 7: Fact progress bar with the walking cat

**Files:**
- Create: `artifacts/cat-spotter/components/FactProgressBar.tsx`
- Test: `artifacts/cat-spotter/components/__tests__/FactProgressBar.test.tsx`

**Interfaces:**
- Consumes: `FactProgress` (Task 2), `catPosition` (Task 3), `ProgressBar` with `hideValue`/`accessibilityText` (Task 4), `WalkingCat`/`SleepingCat`/`WALKING_CAT_ASPECT` (Task 6), and the keys `factProgress`/`factProgressDone` (Task 5).
- Produces: `export function FactProgressBar(props: { progress: FactProgress; t: (key: string) => string }): JSX.Element`.

Behaviour:
- A `View` with `onLayout` measures the bar's width. It renders:
  - `ProgressBar` with `value = kind === 'done' ? total : n`, `max = total`, `hideValue`, and `accessibilityText` set to the progress words;
  - the visible words under it, hidden from screen readers.
- **The walk:**
  - an absolutely placed cover over the fill, in the bar's track colour (read it from `ProgressBar.tsx`), runs from the `walkFrom` position to the `n` position and shrinks to zero width over **1000 ms**;
  - at the same time, `WalkingCat` moves from `catPosition(walkFrom, …)` to `catPosition(n, …)`;
  - with reduced motion there's no cover, and the cat is placed straight at `n`.
- **`done`:** a `SleepingCat` at `catPosition(total, …)` and no walking cat.

- [ ] **Step 1: Write the failing tests:**
  - "Cat fact 3 of 11" visible, and the bar's accessible label equals it;
  - "All 11 cat facts seen" plus `testID="sleeping-cat"`, and no walking cat, for `done`;
  - after a layout event of width 330, the walking cat's final `left` equals `catPosition(3, 11, 330, 24 * WALKING_CAT_ASPECT)`;
  - with reduced motion, no `withTiming` is called for the walk;
  - unmount during the walk calls `cancelAnimation` (Review Focus 4).
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5: Commit** with the message "SYC-772: FactProgressBar with the walking cat".

---

### Task 8: The waiting card shows the topic and progress

**Files:**
- Modify: `artifacts/cat-spotter/components/WaitingCard.tsx`
- Modify: `artifacts/cat-spotter/app/(tabs)/spot.tsx`, in `startWaitingCard` (about line 868) and the render at about line 1658
- Test: `artifacts/cat-spotter/components/__tests__/WaitingCard.test.tsx`, `artifacts/cat-spotter/lib/__tests__/spotWaitingCard.test.ts`

**Interfaces:**
- Consumes: `factProgress` and `FactProgress` (Task 2), `TopicCat` (Task 6), `FactProgressBar` (Task 7), `factById` (existing).
- Produces: `WaitingCardProps` gains `progress?: FactProgress | null`.

Behaviour:
- **Fact choice:**
  - between the eyebrow and the photo, a topic row: `TopicCat` with `factById(id)?.strand`, then `t('factTopic' + strand)` with `flex: 1` and wrapping. No row when there's no strand;
  - after the fact's words, `FactProgressBar` when `progress` is set.
- **If a picture fails to draw** (spec §3.1), the card still shows. Wrap `TopicCat` and `FactProgressBar` each in a small error boundary that renders `null` on error. Use the existing `components/ErrorBoundary.tsx` if it takes a fallback; otherwise write a 10-line local one. The topic name and the fact always show.
- The nudge and empty choices are unchanged.
- **`spot.tsx`:** keep the progress in state next to `waitChoice`, worked out once in `startWaitingCard` as `factProgress(stored, matchWaitSettings, choice)`, from the record as read (before `chooseForWait`'s repair; same `everSeen`). Pass it as `progress`. It doesn't change if settings load later during the wait.

- [ ] **Step 1: Write the failing tests** in `WaitingCard.test.tsx`:
  - a topic name for each strand (`fact.tortie` → "Reading a cat", `fact.litters` → "Why sterilisation works", and so on, one per strand);
  - no topic row for an unknown id `fact.new.bcdfghjk`;
  - the progress words show when `progress` is passed;
  - nothing extra for the nudge or empty choices;
  - the announcement is unchanged;
  - Greek strand 4's name renders (Review Focus 5);
  - a `TopicCat` mocked to throw still leaves the topic name and the fact on screen.

  In `spotWaitingCard.test.ts`: progress is worked out at wait start and stays the same when settings change afterwards (Review Focus 2).
- [ ] **Step 2:** Run both files. Expected: FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run both files, plus `lib/__tests__/waitingCard.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** with the message "SYC-772: waiting card shows topic picture and progress".

---

### Task 9: The thanks-screen line

**Files:**
- Modify: `artifacts/cat-spotter/hooks/useResultNudge.ts`
- Modify: `artifacts/cat-spotter/app/review.tsx`, in the `if (result)` branch, inside the `{!questionsHidden ? (…)}` block (about line 646), before `questionsHeading`
- Test: `artifacts/cat-spotter/hooks/__tests__/useResultNudge.test.tsx`, `artifacts/cat-spotter/components/__tests__/ReviewScreen.nextFact.test.tsx` (create, modelled on `ReviewScreen.celebration.test.tsx`)

**Interfaces:**
- Consumes: `nextSpotBringsNewFact` (Task 2), and the key `factNextSpot` (Task 5).
- Produces: `useResultNudge` returns `{ show, dismiss, help, nextSpotBringsNewFact: boolean }`.
  - It starts `false`.
  - Inside the existing single decision, after any save, it's set from `nextSpotBringsNewFact(out.record ?? record, s, { nudgeEnabled: NUDGE_ENABLED, signedInRole: null })`.
  - If the record is null, it stays false.
  - There's no second read and no extra save.

Behaviour in `review.tsx`: when `resultNudge.nextSpotBringsNewFact`, render `<Text testID="next-fact-line">` with a sparkle icon (Feather `star`, hidden from screen readers) and `t('factNextSpot')`, in the muted colour at body size. It goes inside the questions block, so it appears after a celebration ends, whatever the points line says.

- [ ] **Step 1: Write the failing tests.**

  In `useResultNudge.test.tsx`, the field:
  - is true with an unseen fact;
  - reflects the record after a nudge is counted (the nudge was due, and now isn't, so it's true);
  - is false for a null record (Review Focus 3).

  In `ReviewScreen.nextFact.test.tsx`, the line:
  - shows on a live send's thanks screen;
  - shows for a kept-at-send item, and for a saved-for-later item (`localId` without `keptAtSend`);
  - is absent when everything has been seen, when the nudge is due, and for a null record;
  - is hidden while `celebrationPlaying`, and shows after;
  - shows with `pointsReason: 'repeat_today'`.
- [ ] **Step 2:** Run both files. Expected: FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run both files plus `hooks/__tests__/useResultNudge.test.tsx`, `lib/__tests__/reviewFeedNudge.test.ts` and `components/__tests__/ReviewScreen.celebration.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** with the message "SYC-772: next-fact line on the thanks screen".

---

### Task 10: Real-phone check, full suite, draft PR

- [ ] **Step 1:** Run the full app suite, `pnpm exec vitest run` in `artifacts/cat-spotter`. Expected: all pass. Read any failure's own error before blaming a known flake.
- [ ] **Step 2: Real-phone check** (iOS Simulator, iPhone SE 3rd gen, plus the web preview at about 390 px and at desktop width), in en, el and fr, light and dark. Check:
  - the ear-tip card (switch the ear-tip fact on in a local settings stub) keeps its top in view at the default text size. If not, set the picture size to 40 everywhere and note it in the PR;
  - the walk plays and then everything settles after 5 s;
  - "reduce motion" leaves everything still;
  - dark cats are visible in dark mode;
  - the thanks line appears under the points.

  Take screenshots for the PR.
- [ ] **Step 3:** Push and open a draft PR: `gh pr create --draft`. Title "SYC-772: While we look, topic pictures, walking-cat progress, next-fact line". The body links the spec and the trial result, and includes the screenshots.
- [ ] **Step 4:** Run the adversarial review (one fresh reviewer, its own worktree), fold in the fixes as the draft, then `gh pr ready`. Wait for a real "Test and build" pass. Don't merge without Samuel ("review and merge" → `/ship`).

---

## Model delegation

| Work | Model | Why | Assurance |
|---|---|---|---|
| Task 1, the trial | **Opus** | Native animation behaviour across iPhone, Android and web, under the new architecture, with a busy JS thread. A wrong call sends Tasks 6–7 down the wrong path | The result file names what passed on which platform. The coordinator reruns the trial screen on one platform before accepting it |
| Tasks 2–5 (pure rules, `catPosition`, `ProgressBar` props, words) | **Sonnet** | Exact interfaces and tests are given in this plan | The tests are named here with their values. The coordinator re-runs the named test files and greps that the claimed tests exist (memory: "Re-run delegated tests") |
| Task 6 (porting drawings) and Task 7 | **Sonnet** | Mechanical once Task 1 fixes the pattern | The drawings check plus the component tests. The coordinator spot-checks two components against their SVG files visually in the web preview |
| Tasks 8–9 (wiring) | **Sonnet** | Small changes at named lines | Tests, including Review Focus 2–4. Full suite in Task 10 |
| Task 10 review | **Sonnet**, adversarial, own worktree | An independent read of the whole branch | Findings folded in before `gh pr ready` |

Workers commit after each task and leave a checkpoint note (what's done, what's next) in the worktree. Every agent brief repeats that rule.
