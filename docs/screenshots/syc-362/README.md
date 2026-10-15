# SYC-362 part 2: local browser check (15 Oct 2026)

Scratch database, local build of this branch. `seed.ts` seeds the data (run as a temporary file inside artifacts/api-server). Form posts went through a local proxy that gives them the dashboard's Origin (as in docs/screenshots/syc-209-pr-3-1). Screenshots: 390 px (touch, dpr 2) and 1280 px, full page. `measurements.json` has overflow and small-tap data per screen.

- A cat guardian's session is refused (403, "That part is for the team") on the cat page and on a posted life-status; nothing is saved and the owner stays.
- The 1280 cat-mimi shot was retaken after Mimi's owner was restored by hand, so its history lists one extra life-status row.
