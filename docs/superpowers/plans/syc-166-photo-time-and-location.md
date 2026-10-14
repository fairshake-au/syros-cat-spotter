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
