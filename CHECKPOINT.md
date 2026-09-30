# SYC-133 checkpoint (remove before PR merge)

Branch: `claude/syc-133-weak-connection-first-paint` (worktree agent-abfe20eecd4c6223d)

## Phase 1: diagnosis (done)

Build: `EXPO_PUBLIC_DOMAIN=localhost:3999 pnpm --filter ./artifacts/cat-spotter run build:web`, served with
`PRELAUNCH_GATE=off PORT=3999 node server/serve-web.js`. Measured with headless Chrome (playwright-core,
CDP network emulation, cache disabled, 390px viewport). Script: scratchpad `perf/measure.js`.

| Profile | First anything on screen | App usable |
|---|---|---|
| No throttling | 0.6 s | 0.6 s |
| Fast 3G (1.44 Mbps, 560 ms RTT) | 25.2 s | 25.3 s |
| Slow 3G (400 kbps, 2 s RTT) | 76.3 s | 76.3 s |

Before first paint the page is completely white: `index.html` has an empty `<div id="root">`.

What blocks first paint:
1. **Nothing in the HTML shell.** Only an empty root div; everything is drawn by JS.
2. **One 3.38 MB JS bundle** (`entry-*.js`), served **uncompressed**. gzip -9 = 857 KB, brotli = 668 KB.
   `serve-web.js` never compresses anything (`content-encoding` absent on every response).
3. **Fonts gate the first render.** `app/_layout.tsx` returns `null` until 7 TTFs load
   (5 Inter weights ~343 KB each + 2 Space Mono ~98 KB = ~1.9 MB, also uncompressed). They are only
   discovered after the bundle has run, so they are a second serial download.
4. CSS (2.5 KB) is render-blocking but trivial.
5. Cache headers: hashed `/_expo/*` and `/assets/*` already `immutable`; HTML `no-cache`. Fine; repeat
   visits are fast. Problem is the first visit.
6. Pre-launch gate: not a cause. Password page is ~3 KB, inline CSS, no scripts. After login the
   redirect lands on the same white shell.

## Phase 2 decision

Contained fixes, doing them now:
- A. Compress responses (brotli/gzip), precompressed at build time + on-the-fly fallback. (serve-web.js)
- B. Inline branded loading screen injected into the HTML shell by serve-web.js, trilingual (en/el/fr from
  the saved language), "still loading" note after a while, and a retry message if the bundle fails.
  App removes it when the fonts are ready (same moment the native splash screen hides).

Not doing (product/architecture choices; file as follow-ups):
- Code-splitting the bundle / lazy routes.
- Not blocking first render on fonts (would show system font then swap).
- Service worker / offline shell.

## Progress
- [x] Diagnosis recorded
- [ ] A. compression (TDD)
- [ ] B. loading screen (TDD)
- [ ] After measurements + screenshots
- [ ] Adversarial review, PR, Linear
