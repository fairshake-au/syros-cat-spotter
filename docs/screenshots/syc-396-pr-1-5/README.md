# SYC-396 PR 1.5: browser check of the island Map

Run on 18 Oct 2026 against the **built** server (`pnpm --filter @workspace/api-server run build`, then `node dist/index.mjs`, as Replit runs it), after the adversarial review fixes. **315 of 315 checks pass** (`check-result.json`).

**Setup:**
- **Database:** a scratch database seeded by `seed.mts`. It holds 18 cats: a tight group of twelve in Ermoupoli, cats in Kini, Galissas and Posidonia, and two just off the coast. All four sterilisation marks appear. One cat has a trail of two sightings, and there are two feeding sites (one public, one private).
- **Sign-in:** a team session cookie for that database only.
- **No outside requests:**
  - `standin-tiles.mjs` is loaded into the server, so it never reaches OpenStreetMap. It draws stand-in map pictures: sea blue, with a rough island outline in land beige.
  - Every request the browser made to anything but the local server was blocked and recorded. There were none.
- **Origin proxy:** the dashboard's own fetch POSTs must carry `https://team.catspotters.com` as their Origin, and browsers won't let a script set that. So the browsers talked to `origin-proxy.mjs`, which forwards to the server and sets that Origin on POSTs (local only).
- **Rate limit:** one person loads the map dozens of times here, so the real 300-squares-per-10-minutes limit stops them. The runner clears that count on the scratch database before each width (`RESET_LIMIT`).
- **Map handle:** the check keeps a handle on the page's Leaflet map with an init script of its own, so it can move the view. The page itself exposes nothing.

`check.mjs` runs Playwright 1.64.1 in Chromium, WebKit and Firefox.

**At 320, 360, 375, 390 and 1280 px**, in every engine:
- the map comes up from our own files, with no console errors and no security-policy violations;
- nothing scrolls sideways, and the button map stays in `<noscript>`;
- the key is folded on a phone and open on a computer;
- nearby cats are grouped with a count, and tapping a group zooms in;
- a dot on the sea (Thalassa) and a dot on land (Portokali) each show their light ring and dark outline over the right background;
- tapping a cat opens its card, with "Open the cat" and "Show where else it's been seen". On a phone the card is a sheet at the bottom; on a computer it sits top-left. It closes again;
- ticking a filter applies it with no page load, and the address keeps it;
- map squares are fetched by token only, and no address holds a position;
- cats are asked for in a POST body with no position in it, and square tokens by square numbers, at most 64 at a time.

**Once per engine, at 1280 px:**
- `?focus=` draws the cat's trail as numbered dots and opens its card;
- the Feeding sites layer shows two squares, and the Cats layer switches off;
- when map pictures fail, the page shows "Map pictures aren't loading. The cats are still shown." over a plain island outline, and the cats stay;
- when Leaflet fails to load, the button map comes back with the cats on it.

**With JavaScript off** (390 px and 1280 px):
- the button map shows the cats, and the draggable map's box stays hidden;
- "Go to Ermoupoli" works through `POST /api/team/cats/map`, with nothing in the address.

**Screenshots:**
- `<engine>-<width>-1-map.png` and `-2-card.png`;
- `<engine>-1280-3-trail.png`, `-4-sites-layer.png` and `-5-pictures-failing.png`;
- `<engine>-<390|1280>-6-nojs.png` and `-7-nojs-ermoupoli.png`.

**Live caveat:** Replit adds two scripts of its own to live pages (SYC-437). Our security header blocks them, so on the live site the browser console shows two security-policy errors per page. They don't appear in this local check.
