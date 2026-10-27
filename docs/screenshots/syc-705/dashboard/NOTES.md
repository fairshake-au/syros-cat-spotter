# Running notes (2b.9 browser check)
- Scratch DB syc705_check_scratch, server :8751, origin proxy :8752. Playwright core 1.64.1 (chromium-1248, webkit-2370).
- Harness works in Chromium 1280 (37 checks). Found: dashboard-pin.js:107 `new window.CatMap.lib().Marker(...)` throws on colony centre and site move pickers (pages with a marker in place mode).
- Greek: LIVE_LANGUAGES=["en"] so no person is served el; Greek style exercised via CatMap.start(lang:"el") on the live page.
