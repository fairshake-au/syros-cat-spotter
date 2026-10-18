# Adversarial review: SYC-166 slice 4 (Ermoupoli start)

Reviewer tier: Sonnet, its own worktree, no sub-agents. Reviewed commit `782e27b3` against `origin/main`, the plan's "Slice 4", plan review item m3 and the spec. **Partial review:** the reviewer read the code but did not run tests or the app (its first run stalled on install). The tests were run separately by the builder (cat-spotter suite 1837/1837, typecheck clean) and the browser check is in `docs/screenshots/syc-166-slice-4/`.

## Verdict: MERGE WITH FIXES

## Blocker
None.

## Major

**M1. "This cat needs help" gets a place the spotter never chose.** `spot.tsx` passes `coords: pickedCoords ?? undefined` to the help link. For an Ermoupoli start, that is Ermoupoli's centre. Before, a spotter with no position sent no coordinates. Now a help request from someone in Munich, or with location refused, carries the town centre as if the cat were there. (Check for matches can also be pressed with the pin unmoved; the plan accepts that, since it is the point of the slice.) Suggested fix: pass no coordinates to the help link while the map is still at an Ermoupoli start the spotter hasn't moved, which needs a re-rendering "moved" flag.

## Minor

**m1. Zoom alone never counts as a touch.** The plan says drag, tap *or zoom*. The web picker's +/- buttons only change the zoom and never report, and a native pinch usually keeps the centre within a metre. So a spotter who only zooms on Ermoupoli, then gets a late fix, has the map remount at the fix and loses their zoom. A fix landing mid-drag, before the drag reports, can also remount under the finger (narrow window). Suggested fix: an `onTouch` callback from the picker.

**m2. The "map moved" threshold (about 1 m) is untested on a device.** It relies on the native map echoing its first region within a metre. Cover it in the real-device pass.

**m3. A refused location is not explained to a library spotter.** The red text hides once the map has a start; the Ermoupoli line stays true but gives no reason. Matches the plan; state it as a trade-off. The red text can flash for one render. Cosmetic.

**m4. `phone.loading` is accepted by `resolveMapStart` but never used.** Drop it or say why it's there.

**m5. The screen tests read the source.** They prove the wiring exists, not the effect's behaviour (dependency array, order). The plan's rendered component test was replaced by source tests because `app/` is outside vitest's render paths. Cheap improvement: put the effect's decision in a pure function and test sequences by value.

**m6. Tinos's coastline against the margin is unchecked.** The plan reasons from Tinos town (25.163 E); the rectangle plus margin reaches 37.55 N, 25.03 E.

## Checked and fine

- No effect loop; no stale values across re-picks (`resetMapStart` runs in the same batch as the new photo; the timer is keyed on the photo; `mapWaitedMs` is zeroed with it).
- Wait boundary: 3,999 ms waits, 4,000 ms is Ermoupoli.
- Camera and live camera match `origin/main`: phone or wait, never Ermoupoli; retake still clears the pin.
- Every setter of the photo goes through `setFirstPhoto` / `retakeFirstPhoto`, so the pick source is always known.
- The late-fix rule matches plan review m3: town starts only, before the first move, and a fix off Syros never replaces it.
- Submit and the location chip use the real picked position.
- Words: the Ermoupoli line shows only for a town start; "It starts near where you are" stays true for a phone start; no banned terms; en/el/fr present.
- Ermoupoli is inside the rectangle; the `offlineTiles.ts` change has no behaviour effect; `isOnSyros` rejects NaN and infinity.

## How each finding was handled

| Finding | Handling |
|---|---|
| **M1** help link gets Ermoupoli | **Fixed.** New pure `needsHelpCoords` in `lib/mapStart.ts`: no place while the map sits on an unmoved Ermoupoli start, the pin otherwise. The touch flag is now state, so the link updates when the spotter moves the map. Tests by value and a source test; a mutation probe that drops the rule turns the value test red. Unmoved Ermoupoli on "Check for matches" stays, as the spec's Decision 6 and the plan intend. |
| **m1** zoom alone isn't a touch | **Filed: SYC-477.** It needs a new `onTouch` callback on both map pickers, which the plan's file list doesn't cover. The window is small: between the 4-second start and a late fix. |
| **m2** threshold untested on a device | **Kept for the real-device pass** the plan already lists (one iPhone, one Android, location refused). Stated in the PR. On the website, the browser check confirmed that a real drag counts as a touch and that the map's own start does not. |
| **m3** refused location not explained | **Accepted** as the plan's design: the spotter isn't stuck, and the Ermoupoli line is true. Stated in the PR. |
| **m4** `phone.loading` unused | **Commented** in `MapStartInput`. The field stays because the plan fixes the input shape for slice 5. |
| **m5** screen tests read the source | **Accepted.** `app/` is outside vitest's render paths (`vitest.config.ts` `include`), and the repo's other Spot screen tests read the source the same way. The decisions themselves (`resolveMapStart`, `nextMapStart`, `needsHelpCoords`) are pure and tested by value. The browser check covers the effect's behaviour: a slow fix, a drag then a late fix, a re-pick and a retake. |
| **m6** Tinos coast unchecked | **Unchecked, low stakes.** In this slice the check only decides whether a phone position starts the map. A phone on Tinos's west tip being counted as Syros would start the map at the phone, which is today's behaviour. It matters more in slice 5 (photo position, off-island stop screen); noted there. |
