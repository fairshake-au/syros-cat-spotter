# SYC-396 PR 1.3.4: browser check of the instant filters

Run on 15 Oct 2026 against the **built** server (`pnpm --filter @workspace/api-server run build`, then `node artifacts/api-server/dist/index.mjs`, as Replit runs it), on a scratch database seeded by `seed.mts` (eight cats, one colony, one staff member), signed in with a team session cookie for that database only. `NODE_ENV` was left unset because production insists on an SSL Neon address; the bundle and the way it finds `dist/assets/` are the same. Every request leaving the machine was blocked.

- `check.mjs`: Playwright 1.64 in Chromium (1280 px and 390 px phone), WebKit and Firefox (1280 px). Result: `check-result.json`, **73 of 73 checks pass**.
- With JavaScript on, in every engine:
  - our script loads from `/api/team/assets/dashboard-grid.<hash>.js`;
  - ticking Ginger narrows 8 cats to 2 with no page load (same document, one load event), by a fetch of the same page;
  - the address, the Ginger chip and "Filters (1)" all update;
  - typing "Mavros" narrows to 1 cat after the pause, and the address carries it;
  - reloading that address gives the same view;
  - no security-policy violations and no console errors.
- With JavaScript off, in every engine: ticking a box changes nothing by itself, and **Show cats** applies the filter by an ordinary page load (2 cats).
- WebKit won't send a Secure (`__Host-`) cookie to `http://localhost`, so for WebKit the same session was set as a plain cookie for the local address.

Screenshots: `<engine>-1280-1-before.png`, `-2-after-ginger.png`, `-3-typed.png`, `chromium-390-2-after-ginger.png`, and `<engine>-nojs-after-show-cats.png`.
