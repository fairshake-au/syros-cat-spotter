# SYC-772 web check (27 Oct 2026)

Expo web preview, headless Chromium 156 (Playwright). Every request to anything other than localhost was blocked. The card was rendered on a throwaway preview route, `dev-waiting-preview`, which was not committed. That's why the header says so; in the app the card sits in the map's place on the Spot screen.

- `eartip-3of11-<lang>-<theme>-<width>.jpg`: the ear-tip fact (the tallest card), "Cat fact 3 of 11", with the walk finished.
- `strand4-done-<lang>-<theme>-<width>.jpg`: a *Being around a street cat* fact after all 11 have been seen, with the sleeping cat at the end of a full bar.
- `strand4-el-320.jpg`: the longest topic name (Greek, strand 4) at 320 px.
- `pictures-dark-390.jpg`: all eight pictures in dark mode, after they've settled.

Languages en, el and fr; light and dark; 390 px and 1280 px. No page errors in any of the 12 runs.

**Motion (measured with `document.getAnimations()`):**

| Check | Result |
|---|---|
| Animations running at 1 s | 16 |
| Animations running at 5.6 s | 0 (settled) |
| Running with "reduce motion" on | 0 at 1 s and at 5.6 s |
| The walking cat's left edge every 200 ms, for 3 of 11 at 390 px | 66 → 71 → 80 → 88 → 92 → 92 → 92 (eased, settled within about 1 s) |
| Greek strand 4 at 320 px | the name wraps beside the picture, with no sideways scroll |

**Not covered here:**
- iPhone and Android. That's SYC-776, which blocks the merge.
- The thanks-screen line on a live result screen. It needs a real send; the component and hook tests cover it.

## iPhone simulator (28 Oct 2026), `ios/`

iPhone 17e, iOS 27.1, Expo Go 54.0.7. The iPhone SE simulator isn't supported on iOS 27. Same preview route as the web check; screenshots taken after the pictures had settled.

- `ios/earTip-3of11-<lang>-<theme>.jpg` and `ios/milk-done-<lang>-<theme>.jpg`: en, el and fr; light and dark.
- **Card heights** on the 390-point-wide screen, ear-tip card (the tallest): en 444, el 467, fr 491 points. Without the photo: en 283, el 306, fr 283.
- The topic row sits under the eyebrow, so it doesn't move the card's top edge. On the Spot screen, the card's top is where it was before this change. The first line of the fact moves down by the topic row (about 56 points). The progress bar may scroll out of view on a small phone, which the spec allows.
- Motion, the walk, reduce motion and dark mode all pass. Details are in `docs/superpowers/plans/2026-10-27-while-we-look-trial-result.md` ("Update, 28 Oct").
- **Still to check on real phones (SYC-776, blocks the merge):** a real iPhone SE, VoiceOver (is "Cat fact 3 of 11" read once?), and all of Android.
