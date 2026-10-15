# SYC-209 PR 3.1: browser check of the team map

Run on 15 Oct 2026 against a local build of this branch, with a scratch database and real OpenStreetMap pictures fetched by the local server. The map is one picture per screen-width band: the server joins the view's 2×2 tiles.

- `layout-and-tap-check.mjs`: Playwright's Chromium, WebKit (Safari's engine) and Firefox, at 320, 360, 375 and 390 px (touch, pixel ratio 3) and 1280 px (mouse, pixel ratio 2). Results are in `layout-and-tap-check-result.txt`.
- `local-origin-proxy.mjs`: a local-only proxy that gives dashboard form posts the dashboard's own Origin. Without it, every engine sends `Origin: null` and the server refuses the post. That's true of every dashboard form, not just the map: SYC-330.
- `screenshots.mjs` and the PNGs, all Chromium:
  - `<width>-1-island.png`: the map as it opens;
  - `-2-ermoupoli.png`: after the Ermoupoli button;
  - `-3-after-tap.png`: after a tap, with the spot as text and a red ring.

What it shows (106 of 110 checks pass):
- **Layout.** In every engine at every width, the island view and the Ermoupoli view each show exactly one map picture. It is the right band's, displayed at exactly twice the size in its form (288, 328, 342, 358, 512 px), starting on a whole pixel, with no sideways scroll.
- **Taps in WebKit and Firefox:** every tap was read exactly. The taps tested were near the corner, either side of the seam between the picture's tiles, and at the last pixel.
- **Taps in Chromium:** read 1 px right and down, because Chromium rounds the half pixel. That's within the plan's 1 px, and it held across the seam too.
- **The 4 that fail:** a Chromium touch tap on the map's outermost pixel (bottom-right corner) was pulled about 5 px inward. That's Chromium's touch adjustment at the edge of a target, and Android Chrome does the same. It happens only at the outer edge of the map, never in the middle, where the spot of interest is drawn. With a mouse, Chromium reads that pixel correctly.
- Real phones are the real-phone check (SYC-287).
