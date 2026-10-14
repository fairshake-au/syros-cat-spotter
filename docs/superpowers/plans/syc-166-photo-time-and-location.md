# Starting the map where (and when) a library photo was taken: implementation plan (SYC-166)

**Spec:** `docs/specs/photo-location-from-library.md`, approved by Samuel on 14 October 2026, every decision as recommended (Decisions 1 to 7). Its [review](../../specs/reviews/photo-location-from-library-review.md) is folded into the spec (§13).
**Samuel's condition on the build (Linear, 14 October):** build the photo's date and time first, because it works whatever the device check finds. "Start the map where the photo was taken" is a separate, later slice that waits on the device check (SYC-280). **SYC-258 ships first**, and SYC-166 must not ship before it (spec §5.1).
**Status:** for Samuel's approval. Nothing here is built. This document changes no code.
**Checked against:** `origin/main` at `7089870` (13 October 2026). Every "exists today" claim names the file and line it was read at on that commit. Platform claims the spec marks **[confirm]** are not treated as fact anywhere below.

---

## In plain English

**What a spotter sees when it is all built.** A spotter picks an old photo from their library. The sighting is dated to the day the photo was **taken**, not the day they picked it, and the screen says so ("Photo taken 3 October, 18:42 (Greek time)"). If the photo says where it was taken (iPhone app, and website photos exported from a laptop, expected but not yet proven), the map opens on that spot and a line says so. If it doesn't, the map opens near them, or in Ermoupoli if their phone has no usable position, and a line says so honestly. A photo more than 21 days old is turned away with a plain explanation and the library offered again. A photo taken away from Syros stops with "This photo was taken away from Syros" and an "It was on Syros" way out. Two different photos taken in the same second both count. Picking the same photo twice says "You've already logged this photo."

**What an owner sees.** If a sighting of their cat comes from a photo more than a day old, the push says "Agatha was seen on Tuesday" instead of "spotted again!". The evening round-up for everyone else is unchanged.

**What the reward screen says.** "Last seen" is the newest sighting of that cat, so logging a 10-day-old photo can never make a cat look as if nobody had seen it for 10 days.

**What nobody sees.** The photo's exact position is used once, on the phone, to place the map. It never goes in a web address, a log, a saved-for-later item or a new field. The only position saved is the pin the spotter confirms.

**What each kind of phone gets, honestly.** This is the spec's expectation, not a fact until the device check (SYC-280) has run: iPhone app, time and place; Android app, time only; website on a phone, little or nothing; website with a photo exported to a laptop, both. The plan is built so that every one of those outcomes has a defined behaviour (spec §4.3) and none breaks the feature.

**No database change in any slice.** No migration, so none of these slices queues behind migrations 0015 and 0016 (SYC-209, SYC-53).

---

## The slices at a glance

Each slice is its own fresh worktree off `origin/main`, its own PR, and leaves `main` safe on its own. They go in this order. Slices 2 and 3 are independent of each other once 1 is merged; 4 builds on 2; 5 builds on 1, 2 and 4.

| # | Slice | Needs | Ships | Platforms touched |
|---|---|---|---|---|
| 1 | **SYC-258:** the review screen's address carries a rounded position only | nothing | first, alone | all (one pure file) |
| 2 | **The photo's date and time:** clock order, the 21-day limit, the "photo has no time" line, same-second and same-photo fixes. Also the XMP line in the server's photo test (SYC-260) | slice 1 merged | next | iPhone app, Android app. The website keeps today's behaviour in this slice (see 2W) |
| 2W | **The website's time reader** (a small JPEG reader that reads time tags only) | slice 2 merged; Decision A below | right after 2, or after SYC-280's C6/C8, Samuel's call | website |
| 3 | **Owner's "seen on Tuesday" push, and the reward screen's last-seen date** | nothing in the app; independent of 2 | any time after 1 | server only |
| 4 | **Ermoupoli start** when there is no usable phone position | slice 2 merged (shares the pick-handling code in the Spot screen) | after 2 | iPhone, Android, website |
| 5 | **WAITS ON SYC-280.** The map starts at the photo's position; the "doesn't say where" lines; the off-island stop screen | slices 1, 2, 4 merged **and** the §4.2 results table filled in **and** Samuel's go-ahead on §4.3's "still worth it?" question | last | only the platforms where the check shows location arrives |

**One departure from the brief's slice list, flagged here and in "Spec vs code".** The brief put "off-island stop screen and Ermoupoli start" together as slice 4. The off-island screen needs the photo's position, and nothing reads that position until slice 5. So the Ermoupoli start (which needs no photo position) is slice 4, and the off-island screen moves into slice 5, where it can actually be built and tested.

**Honest lines never get ahead of the code.** A line that says "this photo doesn't say where it was taken" is only true on a platform where we have either read the photo or confirmed the platform removes the location. So `mapStartedAtYou` and `photoNoTime` appear only where that is so (slice 2 on the website shows neither; slice 5 decides the location lines per platform from the device check). The existing "It starts near where you are" hint stays for library photos until slice 5 replaces it.

---

## Slice 1 · SYC-258: the review screen's address carries a rounded position only

**What a spotter sees afterwards.** Nothing. After "Check for matches" the review screen opens exactly as before, with the same "Cats known around here" list. The difference is in the website's address bar and browser history: the spot's position is there as about 110 m of blur (three decimal places, like `37.441`), not to the metre. Without this, a pin that started at a photo (her friend's garden, a hotel room) would sit to the metre in the history of whoever logged it (spec §5.1).

**Branch / PR:** `claude/syc-258-round-review-position`, one PR, no spec dependency.

### What the code does today (verified on `7089870`)

- `buildReviewParams` is the only way to build the review route. It copies the position through `safeLocation` unrounded: `artifacts/cat-spotter/lib/reviewParams.ts:72-78` (the check) and `:96-100` (the copy into `data.lat` / `data.lng`). The result is one JSON string in a single `data` param (`:105`), which expo-router puts in the browser address and history on the website.
- **Only one call site passes a position.** The "sent" path in `app/(tabs)/spot.tsx:487-495` passes `finalCoords.latitude` / `.longitude`. The other two callers, `reviewPending` (`spot.tsx:531-537`) and `ReviewReadyBanner.tsx:37-44`, pass none: a queued item's review screen reads the position from the queue in memory (`app/review.tsx:122-125`), not from the route. The ticket (SYC-258) names three call sites; the code has one. Rounding in the builder is still the right place, because it is the single choke point that every present and future caller goes through, and `lib/__tests__/reviewRoutes.test.ts` already fails any `/review` navigation that bypasses it.
- What the position is for: `app/review.tsx:122-131` builds the "nearby" set from it with `pickerList(from, cats, "")`, a 1.5 km rule (`choose-a-different-cat.md` §4). The server checks a pick against its own stored location, so nothing that matters loses accuracy.

### Decision taken in this plan (Samuel can overrule)

The ticket offers two fixes: round in the builder, or keep the position in memory beside the review store (as SYC-76 did for the photo). **This plan does the rounding**: it is ten lines in one pure file, it covers every caller, and the only consumer is a 1.5 km list. Rounding to three decimals moves a point by at most about 70 m (0.0005 degrees is about 55 m of latitude, about 44 m of longitude at 37.4 N), against a 1.5 km edge. The in-memory option would touch `review.tsx`, `spot.tsx` and a new store for no gain a spotter could feel. It stays available if a later change needs the exact pin on the review screen.

### Files

- Edit `artifacts/cat-spotter/lib/reviewParams.ts`: a new exported `ROUTE_POSITION_DECIMALS = 3` and `roundForRoute(n)`; `safeLocation` returns the rounded pair; `parseReviewParams` also rounds what it reads back (idempotent, so an old address from history can never re-introduce precision).
- Edit `artifacts/cat-spotter/lib/__tests__/reviewParams.test.ts`.
- No other file.

### Steps (test first, each its own commit)

1. **Tests that fail on `main`** (add to `reviewParams.test.ts`), by value, not by field name (spec §9 test 6c, SYC-258's own note):
   - `rounds the position to three decimals in the serialised route`: build with the fixture `lat: 37.4412345, lng: 24.9412345`; assert `params.data` contains neither `"37.4412345"` nor any number with four or more decimals (`expect(params.data).not.toMatch(/\d\.\d{4,}/)`), and `parseReviewParams(params.data)` gives `{ lat: 37.441, lng: 24.941 }`.
   - `a pin equal to a photo's position does not leak it`: the fixture is the same value used for the photo-position fixtures in slice 5, so the assertion is already in place when a photo position first exists. Assert on the whole serialised `data` string, not on the `lat` key, so a new key name cannot slip by.
   - `rounding is stable`: rounding the parsed value again changes nothing.
   - `rounding never moves a point more than 80 m`: random points inside the island rectangle; haversine distance between input and output is under 80 m.
   - `still drops non-numbers, non-finite values and out-of-range values` (the existing guards, now exercised on the rounded path).
   - `negative and zero coordinates round without "-0"`: `-0.0004` becomes `0`, not `-0` (JSON writes `0`; assert it).
2. **The change** in `reviewParams.ts`. Update the file's header comment: the "two short numbers" paragraph (`:19-22`) now says "rounded to about 110 m, so the address never carries a spot to the metre".
3. **Check nothing else assumed the exact value.** Run the whole `cat-spotter` suite (`pnpm --filter @workspace/cat-spotter test`, `typecheck`). `review.tsx` reads `data.lat` only to build the nearby set, so no test should move.

### Mutation probes (the guard is against a silent failure, so a green suite is not enough)

Do each, confirm the named test goes red, restore:
1. Remove the rounding in `safeLocation` -> `rounds the position to three decimals` red.
2. Round to four decimals -> the `\d{4,}` assertion red.
3. Round in `buildReviewParams` but not in `parseReviewParams`'s output, and separately the reverse -> the matching test red (one covers the address, one the read-back).
4. Add a second path that writes the raw value under a new key (`lat2`) -> the whole-string assertion red. This is the "where else must this hold?" probe: the test must read the serialised string, which is why it does.
5. Bypass: add a `router.push({ pathname: '/review', params: { data: JSON.stringify({ lat: 1 }) } })` in a scratch file -> `reviewRoutes.test.ts` red (already exists).

### Verification

- Automated: `cat-spotter` `typecheck` and `test` green. No server change, so no server run beyond CI.
- **Browser check, because the website is the exposed surface** (both widths, one language is enough because no copy changes): run the API and website locally with a database that has cats, spot a cat with a pin dragged to an unrounded point, and after "Check for matches" read `location.href` and `history.state` with the browser tool. Assert neither contains a number with four or more decimals. Do it at ~390 px and at desktop width. Then confirm "Cats known around here" lists the expected nearby cats.
- Real-device check: none needed (pure string change). The iPhone/Android apps do not show the route.
- Note for the PR body: browser histories that already hold exact positions from earlier builds are not cleaned by this. Nothing public has launched with them (the app is pre-launch behind the tester key), and the PR says so rather than implying a clean-up.

### Rollback

Revert. No data is stored in the new form; an address built before the revert is simply less precise.
