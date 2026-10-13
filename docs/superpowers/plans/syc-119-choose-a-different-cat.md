# SYC-119: Choosing a different cat — implementation plan (approved by Samuel, 30 Sep 2026)

**Linear:** SYC-119, with SYC-150, SYC-151, SYC-152, SYC-153 and SYC-161. **Status:** approved by Samuel, 30 Sep 2026. Nothing is built yet.
**Design (approved 30 Sep 2026, not reopened here):** `docs/specs/choose-a-different-cat.md` · `docs/specs/DECISIONS.md` Part 2i (and Part 2h, the 500 m rule, in PR #39).
**Checked against:** `origin/main` on 30 Sep 2026; open PRs #39 (SYC-39, 500 m), #41 (SYC-107), #23 (data spine plan), #24 and #28 (held for the post-move queue); the SYC-121 Neon plan's migration freeze. Every "exists today" claim below names the file it was read in.
**Branch note:** the spec (PR #44) merged on 30 Sep 2026; this plan is rebased onto `main` (PR #49, reopened from #48).

---

## In plain English

**What a spotter will get, in the order it arrives.**

1. **First (no database change, can ship soon):** under the suggested matches, a card saying *"Not one of these? Find the cat yourself"*. It opens a list of cats known around here, nearest first, with big photos, a search box, and a side-by-side check before choosing. The same way in appears on the new-cat screen and when a name is already taken. A pick earns the same points as confirming a suggestion. **The server refuses any pick that isn't near where the photo was taken**, so a modified app can't get round it.
2. **Next (one small database table, after the Neon move):** the server keeps a private record of which cats it suggested and what the spotter chose. From then on every hand pick is labelled by the server, and the matching-accuracy work (SYC-56) gets its evidence.
3. **Then the colour filter:** each cat's colour is read from its main photo, including all existing cats, and colour chips appear in the picker.
4. **Then the guards that need the rest of the data spine:** dead cats can't be picked by hand once the app knows which cats are dead, and a "clipped" answer on a hand pick goes to the top of the team's check list once that list exists.
5. **Last, the team side:** the "Matched by hand" list on the dashboard, and "Ask Syros Cats to match it" for cats that aren't nearby. Moving a sighting to the right cat comes after that, and needs a small spec amendment to the data spine first.

**What stays true throughout.** Browsing and searching work without signal from the phone's saved cat-alogue. Sending a pick needs signal. Nothing ever uses a cat's exact position in anything a spotter sees or can probe.

---

## Decisions for Samuel

All four were decided by Samuel on 30 Sep 2026, each as recommended. Samuel approved the plan as a whole the same day.

### Decision 1 — Ship the picker before the server can label hand picks?

**The question.** The picker itself needs no database change. Labelling each pick as "hand pick" versus "suggested", which the team list and SYC-56 rely on, needs a small new table. New tables wait for the Neon move and then join a queue behind #24, #28 and others. That could take weeks.

| Option | What spotters get | Benefits | Risks |
|---|---|---|---|
| **A. Ship the picker as soon as it's reviewed (recommended)** | The duplicate problem from the 29 Sep call is fixed within days of approval | Fewer duplicates while testers are active. That is the harm Syros Cats actually reported. | Picks made before the table lands are never labelled as hand picks, so SYC-56 and the team list don't see them. With a few dozen testers, that is a small number of picks. |
| **B. Wait until the table can land** | Nothing new until then | Every hand pick is labelled from day one | Weeks more duplicates during testing, which SYC-59 then has to merge by hand |
| **C. Ship now, and record picks in the server log as a stopgap** | Same as A | Some trace for debugging | Replit's logs aren't kept long, and a log is not a record anyone can rely on. It looks like evidence and isn't. |

**Recommendation: A. Decided by Samuel, 30 Sep 2026: A.** Say plainly in the release note that early picks aren't counted for matching accuracy. The server refuses picks that aren't nearby from the first release, so shipping early doesn't open an abuse path.

### Decision 2 — How existing cats get their colour

**The question.** Each cat's colour is read from its main photo by the matching model (SYC-161). New cats get read as they arrive. What about the cats already in the cat-alogue?

| Option | Benefits | Risks |
|---|---|---|
| **A. A slow background job in the app fills the gaps (recommended)** | Nobody has to run anything. It reads a few cats at a time until every cat has a colour, then idles. It is safe to restart, and a failure just leaves a cat "Not sure" for the next pass. | Colours appear over an hour or so rather than all at once |
| **B. A one-off command run through `db-ops`** | Done in one go, with a clear log | `db-ops` belongs to the Neon session, and this needs the OpenAI key in GitHub as well as Replit, which is one more place a secret lives |
| **C. No backfill: only new cats and photo changes** | Nothing to build | Every existing cat shows "Not sure" for ever, so the filter is useless where it matters most |

**Recommendation: A. Decided by Samuel, 30 Sep 2026: A.** It costs one model call per existing cat, a few dozen today, once.

### Decision 3 — When do the colour chips appear?

**The question.** Straight after the colour job ships, most cats are still "Not sure" until the backfill catches up.

| Option | Benefits | Risks |
|---|---|---|
| **A. Chips appear only once the backfill has read every cat it can (recommended)** | The first time spotters see the filter, it works | A day's wait after release |
| **B. Chips appear at once** | Visible sooner | A filter where most cats say "Not sure" looks broken on first sight |

**Recommendation: A. Decided by Samuel, 30 Sep 2026: A.** The server says when it's ready, and the app shows the chips from then.

### Decision 4 — "Ask Syros Cats to match it" before the team can act on it

**The question.** The button sends a photo to the team for matching. The team can only act on it once the dashboard's "Matched by hand" list is built (SYC-152, after SYC-43 part 1).

| Option | Benefits | Risks |
|---|---|---|
| **A. Hide the button until the team can act on it (recommended)** | The app never promises something nobody can do (the same principle as F1) | Until then, a spotter whose cat isn't nearby can only add a new cat, as today |
| **B. Show it now, and let requests pile up** | Spotters can say "I know this cat" | Requests sit unseen for weeks, and the spotter is told Syros Cats will get back to them |
| **C. Show it now, and email the photo to admin@syroscats** | Something happens straight away | A new email flow nobody specified, sending tourist photos to a shared inbox |

**Recommendation: A. Decided by Samuel, 30 Sep 2026: A. He also confirmed the button stays in the spec.**

---

## What exists today, and what has to be built first

Checked against `origin/main` and the open PRs, not the tickets.

| Needed | Exists? | Evidence |
|---|---|---|
| Review screen with suggestions and "New cat" | **Yes.** No other way to pick. With no suggestions it goes straight to naming, with no way back | `artifacts/cat-spotter/app/review.tsx` (the match screen, and the `showNewCat \|\| data.candidates.length === 0` branch) |
| Resolve accepts a cat id | **Yes, any cat id**, with no check that it was suggested or nearby. The owner and device-secret checks exist | `artifacts/api-server/src/routes/sightings.ts` (`POST /sightings/:id/resolve`) |
| A record of what was suggested | **No.** Candidates are returned and forgotten | same file, `computeMatchCandidates` |
| 500 m matching | **In PR #39, not merged**: `lib/candidateSelection.ts` | PR #39 |
| Device secret on the cat routes | **In PR #41, not merged** (SYC-107) | PR #41 |
| Search by name or number | **Yes, in the Cats tab**, over the phone's saved cat-alogue (name, description, id) | `app/(tabs)/cats.tsx`, `hooks/useCatsWithCache.ts` |
| "Nearby" = 1.5 km | **Yes, in the Cats tab**, using the server's `distanceKm`, which is **exact** today | `cats.tsx` (`NEARBY_KM = 1.5`), `lib/catHelpers.ts` |
| Published (blurred) positions | **No.** `lib/blur.ts` is data spine PR 5, and the serialiser is PR 6. Until PR 6, the public payload publishes **exact** positions | data spine plan, PR #23 |
| Observations table (`coat` needs no new column: `kind` is open) | **Yes**, with append-only triggers | `lib/db/src/schema/observations.ts`, migration `0001_data_spine_tables` |
| One way to write an observation | **No.** Data spine PR 2 | PR #23 |
| Life status (to know a cat is dead) | **No.** Data spine PR 1 (resolver), PR 4 (payload), PR 8 (the team can set it) | PR #23 |
| The ear-tip question and the *Likely* review list | **No.** Data spine PR 7 and PR 8 | PR #23 |
| Staff sign-in and `requireTeam` | **In PR #28, held** until after the Neon move | PR #28 |
| Sightings append-only guard | **Not yet.** It is SYC-63's migration, and it will allow only pending → resolved | data spine plan, "Interfaces" |
| Points 15 / 25 | **No.** Still 10 / 50 (SYC-38) | `routes/sightings.ts` constants |
| Review route carries the sighting's location | **Only for queued items** (through the queue). An online submission's route carries `sightingId`, candidates and `photoRef` | `lib/reviewParams.ts` |
| Shared code between app and server | **No pure shared package.** `lib/` holds `db`, `api-spec`, `api-zod`, `api-client-react` and the OpenAI integration | `lib/` |

---

## The central rule, and every place it has to hold

**Rule:** in the app, a hand pick is allowed only for a cat whose **published** position is within 1.5 km of the sighting's saved location (inclusive), that isn't dead and isn't merged away. The server enforces it. It never uses exact positions.

**One function decides "nearby"**: `isNearby(sightingLatLng, publishedCatLatLng)`, plus `publishedPosition(cat)`. Both live in a new pure workspace package, `lib/geo`, imported by the API and the app. `publishedPosition` returns the exact position until data spine PR 6 turns on blurring, and the cell centre after it. **PR 6 must switch it in the same change as the serialiser.** That's safe before PR 6: until then the payload already publishes exact positions, so the check reveals nothing new.

**Every consumer of the rule** (listed because a guard only protects the places you remembered):

| Consumer | Where | Slice |
|---|---|---|
| The nearby list's filter and nearest-first order | `review.tsx` picker | A |
| Search and the colour filter (never beyond the nearby set) | picker | A, C |
| The name-taken prompt (offered only for a nearby cat) | `review.tsx` naming, and `NAME_TAKEN` from resolve | A |
| **The server's resolve check** | `routes/sightings.ts` | A |
| The dedupe-hit path of `POST /sightings`, which re-runs matching | `routes/sightings.ts` | B (store the set actually returned last) |
| The public serialiser (so "published" means one thing) | `lib/catHelpers.ts`, data spine PR 6 | PR 6 hand-off |
| The team's "match this sighting" (exempt: anywhere) | dashboard, SYC-152 | E |
| A future queued resolve (SYC-153) | offline queue | not planned |

---

## The smallest shippable slice, and everything after it

### Slice 0 — prerequisites (no migration)

- **0.1** PR #39 (500 m) and PR #41 (SYC-107) merged. Both are already written. This plan rebases onto them.
- **0.2** `lib/geo`: `publishedPosition`, `isNearby`, `nearbyOrder` (published distance, then SYR number), and `NEARBY_KM = 1.5`. Pure, with property tests. The Cats tab's `NEARBY_KM` imports it, so there's one number.

### Slice A — the picker, and the server's nearby check (no migration; ships first, per Decision 1)

- **A1 · Server** (`routes/sightings.ts`, `openapi.yaml`, generated clients):
  - Resolve with `catId`: refuse unless `isNearby(sighting.lat/lng, publishedPosition(cat))`. Every refusal returns one status, one code (`NOT_NEARBY`) and one message, whatever the reason. Suggested cats always pass: they're within 500 m exactly, which is well inside 1.5 km even after snapping (at most about 177 m). A test pins that.
  - Accept an optional `pickedFrom` (`nearby | search | name_prompt`), and ignore it until Slice B stores it.
  - `NAME_TAKEN` also returns the named cat's id, name and main photo (all public), so the app can ask "Is this them?".
  - A hand pick awards `POINTS_CONFIRM`, whatever SYC-38 sets it to. It never sets the cat's main photo.
- **A2 · App** (`app/review.tsx`, a new `components/CatPicker.tsx`, `lib/reviewParams.ts`, `lib/i18n.ts`):
  - The three ways in (spec §3.1), the picker screen (§3.2) and the side-by-side check.
  - "Can't find it? Add it as a new cat". **"Ask Syros Cats" stays hidden** (Decision 4).
  - The review route gains the sighting's `lat`/`lng` for online submissions. They're two short numbers, so they respect the "no photo in the route" rule (SYC-76). They only shape the phone's list: the server uses its own stored location.
  - Offline behaviour and wording exactly as in spec §4.5 and §6. `NOT_NEARBY` shows the spec's refusal copy.
  - Checked in a real browser at about 390 px and desktop, with data.
- **What Slice A leaves for later:** labels (B), colours (C), the dead-cat guard (a no-op until life status exists, D), and the team side (E).

### Slice B — the server's own record of each match (SYC-151; **one migration**)

- A new team-only table, `sighting_matches`: the sighting id, the cats compared, the cats suggested (with rank and score), the choice, how it was made, whether it was a matcher miss or a distance miss, and timestamps. It's linked to the sighting, never to a device.
- `computeMatchCandidates` writes it. **The dedupe-hit path overwrites it with the set actually returned**, because the phone shows the latest response. Resolve completes it and decides *suggested* or *hand pick* by comparing with the stored set, never from `pickedFrom`.
- Resolve also accepts a stored-suggested cat regardless of `isNearby` (belt and braces).
- **Migration:** generated on a rebase just before merge, next free number, never hardcoded. It waits for the Neon cutover's freeze to lift and follows the agreed queue: **#24, then #28, then the rest in merge order**. Rollback block: drop the table. Match records are lost; sightings are untouched.

### Slice C — colours (SYC-161; no migration)

> **Amended 12 October 2026 (SYC-2 plan, Decision A1).** The colour rules, the `coat` payload field and the chip component come from SYC-2 (`syc-2-coat-markings-and-health.md`), which is built first; this slice adds the machine reading, the backfill and the "Find the cat" chips on top. "A person's reading beats the machine's" below is narrowed by SYC2-D10 (a single spotter fills a gap but never overturns a machine reading; see `DECISIONS.md` Part 2n). The cache key is not bumped.

- **Needs data spine PR 2** (the single observation write path). A `coat` observation is written only through it.
- `lib/coat.ts`: asks the model for colour only, one or two of the fixed eight, or "not sure" (two cats, no cat, dark, or a failed call). Writes `coat` as `system:vision`, with `provenance: machine`, `photoId` and the model version.
- **Resolver rule:** a person's reading beats the machine's; among people, the newest wins; among machine readings, the newest wins. If data spine PR 1 has landed, it goes in its resolver. If not, it's a small pure function that PR 1 adopts.
- **Backfill (Decision 2):** a background job after start-up reads a few cats a minute that have no `coat` observation, capped per hour, and stops when there are none left. A new cat's first reading rides along with the matching call.
- **Public payload:** `coat: string[]`. A missing field means "Not sure". The cache version is bumped to the next free one; data spine PR 6 takes the one after.
- **App:** the chips, "Colour not known", the hidden-count line above "Add it as a new cat", and the chips' names in all three languages. The chips appear only once the server reports that the backfill is done (Decision 3).
- **Never** feeds the matcher.

### Slice D — the guards that need the rest of the data spine (no migration)

Each item lands **inside, or straight after, the data spine PR it depends on**. Each is added to that PR's checklist as a hand-off, so it can't be forgotten:

- **With data spine PR 4** (life status in the payload): the picker greys out dead cats and offers the "alive?" route (hidden until E). Resolve refuses a hand pick of a dead cat, answered with the same `NOT_NEARBY`-style refusal. A suggested match still clears the death (data spine §3.2).
- **With data spine PR 7 and PR 8** (the ear-tip question and the *Likely* list): a "clipped" answer on a sighting whose match record says *hand pick* is sorted first and marked *matched by hand*. This needs Slice B.
- **With data spine PR 6** (blurring): `publishedPosition` switches to the cell centre in the same PR, and tests 2, 24 and 25 re-run.

### Slice E — the team side (after #28, the SYC-43 dashboard and SYC-63's guard)

- **E1 · SYC-152:** the "Matched by hand" list and the capability `match_sighting` (requireTeam). "Looks right" writes the verdict to the match record.
- **E2 · "Ask Syros Cats to match it":** a sighting status `awaiting_team`, set from the phone and resolved by the team on the spotter's behalf (points, a notification, discoverer credit for a new cat). **SYC-63's sightings guard must allow pending → awaiting_team → resolved.** I've noted this on SYC-63 so its migration includes it, or so one small follow-up migration adds it. The button appears when E2 ships (Decision 4).
- **E3 · SYC-150 (move a sighting):** needs a data spine spec amendment and its own migration. Planned separately once that amendment is approved.
- **Guardians and vets** get `match_sighting` when SYC-53 and SYC-24 create their roles. Nothing to build here.

---

## Migrations

| Slice | Migration? | Waits for |
|---|---|---|
| 0, A, C, D | **None.** `coat` uses the existing `observations` table, whose `kind` is open | — (C waits for data spine PR 2's code, not a migration) |
| **B** | **One additive table** | The SYC-121 freeze to lift after cutover, then the queue: **#24 → #28 → others in merge order**. Next free number at merge |
| **E2** | Possibly a guard change, depending on whether SYC-63's migration already allows `awaiting_team` | SYC-63 |
| **E3** | One (the move record) | Its spec amendment, then the queue |

Each migration goes through the SYC-64 runner and `db-ops` (development, then production, before the publish that uses it), as in `docs/runbooks/neon-database.md`.

## How this fits the Neon move (SYC-121)

- **Slice A is code only**, so the freeze allows it. But any code merged before cutover means Samuel republishes the new project and Claude reruns D.4. **Recommendation: merge Slice A just after cutover (after E.13)**, unless cutover slips more than a week, in which case merge it and do the rerun.
- Slice B's table is created on Neon directly, never on the old Replit database.

---

## Tests (mapped to spec §10)

Route tests use vitest and the `lib/db` throwaway database; app tests use the existing component setup. **(M)** means a mutation probe is required: break the site on purpose, see the named test go red, then restore it. That applies to every guard whose failure would be silent.

| Spec §10 | What | Slice |
|---|---|---|
| 1, 18 | The picker list depends only on public data, never on what the matcher compared **(M: filter out suggested cats → red)** | A (app), C |
| 2, 24 | Moving a cat's exact position within its square changes neither the list nor acceptance, and refusals are identical **(M: `isNearby` on exact positions → red; run after PR 6)** | A, D |
| 3 | A hand-pick response has the same shape whether flagged or not | A (shape), B (flags) |
| 4 | *Suggested* only if in the stored set; `pickedFrom` can't claim it **(M: trust `pickedFrom` → red)** | B |
| 5 | A dead cat is refused as a hand pick, while a suggested match clears the death **(M: skip the life-status check → red)** | D |
| 6 | A hand pick awards `POINTS_CONFIRM` (the constant, not a literal) | A |
| 7 | "Clipped" on a hand pick goes top of the *Likely* list | D |
| 8, 20 | No public payload carries the match record, `pickedFrom`, flags, or a colour's date, model or author **(M: add one field → red)** | B, C |
| 9 | A merged-away cat is never listed; its old name finds the survivor | A (after `cat_identity` is read by the serialiser, data spine PR 4) |
| 10, 26 | Offline: the picker works from the saved cat-alogue, measured from the sighting's saved location. Sending without signal loses nothing | A |
| 11 | No name-taken prompt for a dead cat | D |
| 12 | `SYR-0042`, `syr 42`, `0042`, `42` | A |
| 13–17, 19 | The colour rules (Not sure always visible, order unchanged, suggestions unaffected, people beat the machine **(M)**, the backfill isn't evidence of life **(M)**, two cats read "Not sure") | C |
| 21 | A hand pick never sets a main photo **(M: set it → red)** | A |
| 22, 23 | The server refuses beyond 1.5 km and accepts exactly 1.5 km. A suggested cat is always accepted **(M: drop the check → red)** | A |
| 25 | Phone and server agree over a grid of locations (both import `lib/geo`) | 0, A |
| 27 | "Ask Syros Cats": nothing until the team matches it, then points and a notification | E |
| 28 | Search and colour never reach beyond the nearby set in the app | A, C |
| — | The dedupe-hit path stores the set it actually returned | B |
| — | A browser check at about 390 px and desktop, with data, for each app slice | A, C, E |

## Rollout (after approval, and after each slice's review)

1. **Slice 0 and Slice A:** merge after cutover (see "How this fits the Neon move"). Publish. Probes: a hand pick of a nearby cat succeeds, and a hand-crafted pick of a far cat gets `NOT_NEARBY`, both with a test device against apptest. Then a real phone check at 390 px. A short WhatsApp note to testers: *"If the app suggests the wrong cats, tap 'Find the cat yourself'."*
2. **Slice B:** `db-ops` migrate development, then production, then publish. Probe: the read-only query tool shows a match record for a new test sighting.
3. **Slice C:** publish. Watch the backfill in the logs until it says it's done. Probe the payload for colours. The chips appear.
4. **Slices D and E:** ride with their data spine and dashboard PRs.

Each merge: flip the Linear ticket, file anything deferred, and clean up the worktree.

---

## Model delegation

The session model is Opus 5.5.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| 0.2 `lib/geo` (published position, nearby, order) | Sonnet | Small and pure, with an exact spec | Property tests; **mutation probe** (exact positions → tests 2/24 red); session-model review of the diff |
| A1 server nearby check, `NAME_TAKEN` details, points, main-photo rule | Sonnet | A few lines in one route, following an existing pattern | Tests 6, 21, 22, 23 with **mutation probes**; identical-refusal test; **Opus adversarial review** (below) |
| A2 app picker and the three ways in | Sonnet | Standard React Native to exact copy | Component tests (1, 10, 12, 28); session model's browser check at 390 px and desktop, with data |
| i18n keys for all new copy (English; Greek and French placeholders marked for SYC-4) | Haiku | Mechanical | The i18n completeness test; typecheck |
| B match record: table, writes, the server's label, dedupe-hit handling | **Opus** | *Escalated:* a migration plus an integrity label that fails silently (a wrong label looks exactly like a right one), and the dedupe-hit subtlety | Tests 3, 4, 8 with **mutation probes**; the session model reads the generated SQL line by line; `migrate:check` in CI |
| C colour reader, backfill job, payload field | Sonnet | Clear spec, known model client (`lib/matching.ts`) | Tests 13–17, 19, 20; a cost-cap test; a probe with sample photos, including two cats; **mutation probes** on 16 and 17 |
| C colour chips and hidden-count line | Sonnet | Standard UI | Component tests; browser check at 390 px and desktop |
| D guards inside the data spine PRs | Sonnet | Each is a few lines in a PR already being built | Tests 5, 7, 11 with **mutation probes**; reviewed as part of those PRs |
| E1/E2 `match_sighting`, awaiting-team status, acting for a spotter | **Opus** | *Escalated:* staff acting on a spotter's behalf (points, notifications, a status transition the SYC-63 guard must allow), where a mistake is quiet and hard to undo | Test 27 plus capability refusal tests; **mutation probe** on the guard transition; Opus adversarial review |
| Adversarial review of each built slice (A, B, C, E) | **Opus, each in its own worktree** | *Escalated:* it must find the probe and bypass paths the builder didn't think of. Its own worktree because proving a test can fail means changing the tree (LIF-79) | The session model checks every finding before it's fixed or dismissed |
| Rollout, probes, `db-ops` runs | Session model | Touches production | The probes in Rollout |

## Crash-proofing for the build

Each slice gets its own worktree from fresh `origin/main`, with **one commit per numbered item** (0.1, 0.2, A1, A2 and so on) and a `CHECKPOINT.md` update after each. The file is git-ignored, so the commits are the durable record. Every sub-agent prompt restates this verbatim. Each reviewer gets its own worktree, never shared. No nested agents from a chip. A progress notification goes out at each slice's review and merge.

---

## Adversarial review of this plan

The session model reviewed this plan itself, assuming it was wrong, against the spec, DECISIONS Parts 2h/2i, `main`, and PRs #23, #28, #39 and #41. Every finding is folded in above.

| # | Severity | Finding | What changed |
|---|---|---|---|
| P1 | High | **While drafting, Slice A was going to wait for the match record**, because "the server accepts a suggested cat" seemed to need the stored set. In fact every suggested cat is within 500 m exactly, which is always inside 1.5 km of published position (the snap moves a point at most about 177 m). So the nearby check alone accepts every suggestion. | Slice A needs no migration. A test pins the arithmetic, and B adds "stored-suggested" as belt and braces. |
| P2 | High | **"Published position" means exact until data spine PR 6.** If PR 6 switched the serialiser but not the nearby check, the check would become the location probe. | One `publishedPosition` in `lib/geo`, a hand-off item on PR 6's checklist, and tests 2/24 re-run there with a mutation probe. |
| P3 | High | **The dedupe-hit path re-runs matching** and can return a different set from the first call. Storing only the first set would mislabel a pick of a cat the phone was actually shown. | Slice B stores the set actually returned last, with a test. |
| P4 | Medium | **SYC-63's planned sightings guard allows only pending → resolved**, so "awaiting team" would be refused by the database. | Flagged on SYC-63, and E2 depends on it. |
| P5 | Medium | **A colour backfill can't be a SQL migration**, because it calls the model. | A background job (Decision 2). |
| P6 | Medium | **The dead-cat and ear-tip guards are no-ops until life status and the ear-tip question exist.** Built in Slice A, they'd be dead code that nobody re-checks when the data spine lands. | They move into the data spine PRs as hand-off items (Slice D). |
| P7 | Medium | **An online submission's review route has no location**, so the phone couldn't build the nearby list. | Two short numbers added to `ReviewRouteData`. The server uses its own stored location. |
| P8 | Medium | **Merging code during the Neon freeze adds a D.4 rerun to the cutover.** | Merge after cutover by default. |
| P9 | Low | **Tests would hardcode 10 or 15 points** and break when SYC-38 lands. | They compare with `POINTS_CONFIRM`. |
| P10 | Low | **Two "Nearby" numbers** (the Cats tab's and the picker's) could drift. | One `NEARBY_KM` in `lib/geo`, imported by both. |
| P11 | Low | **The chips shown before the backfill** would look broken. | Decision 3. |
| P12 | Low | **The cache version:** PR 6 planned `v2`. If colours land first, both would claim it. | Each takes the next free version; noted for PR 6. |
