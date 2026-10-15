# SYC-209 PR 3.1: browser check of the team map

Run on 15 Oct 2026 against a local build of this branch, with a scratch database and real OpenStreetMap pictures fetched by the local server.

- `layout-and-tap-check.mjs`: Playwright's Chromium, WebKit (Safari's engine) and Firefox, at 320, 360, 375 and 390 px (touch, pixel ratio 3) and 1280 px (mouse, pixel ratio 2). Results are in `layout-and-tap-check-result.txt`.
- `local-origin-proxy.mjs`: a local-only proxy that gives dashboard form posts the dashboard's own Origin. Without it, every engine sends `Origin: null` and the server refuses the post. That's true of every dashboard form, not just the map: SYC-330.
- PNGs: `<width>-1-island.png` (the map as it opens), `-2-ermoupoli.png` (after the Ermoupoli button) and `-3-after-tap.png` (after a tap: the spot as text and a red ring), all in Chromium.

What it shows:
- **Layout.** At every width and in every engine, exactly one picture set is shown and it's the right size (144, 164, 171, 179, 256). Every picture starts on a whole pixel, and there's no sideways scroll.
- **Taps in WebKit and Firefox.** Every tap was read exactly, at every width.
- **Taps in Chromium, away from a corner.** Read 1 px further right and down (Chromium rounds the half pixel where the others floor), within the plan's 1 px.
- **Taps in Chromium at a picture's last pixel.** At the corner four pictures share, a touch tap was moved about 5 px inward. That's Chromium's touch adjustment, which Android Chrome does too. A mouse click there landed on the neighbouring picture (half-pixel rounding). Either way the spot is off by about 5 px at most, and the person sees the ring and taps again.
- **Taps for the real-phone check (SYC-287).** Repeat these on a real iPhone and Android phone.
