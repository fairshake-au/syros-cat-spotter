# Adding details to a cat later: implementation plan (SYC-117 part 2)

**Spec:** `docs/specs/add-details-later.md`, approved by Samuel on 5 October 2026 (`DECISIONS.md` Part 2l). Decisions 1, 2 and 5 as recommended; Decisions 3 and 4 as B.
**Builds on:** data spine PR 7 (#72): `POST /sightings/{id}/answers`, `askEarTip`, `SightingQuestions`. This work is stacked on PR 7's branch and merges after it.
**Go-ahead:** Samuel, 5 October 2026: "pls proceed", without waiting for the ear-tip photo. The plan ships in the same PR as the build for him to read alongside it.

## In plain English

A spotter who photographed a cat in the last month sees a card on that cat's page: *"You spotted Agatha on 3 October. Anything to add?"* It opens the same questions as the reward screen, showing only what's still open for that sighting. If they've already answered the ear tip, they see their answer and can change it, unless Syros Cats have checked it. Everything a spotter adds keeps the photo and the date it was taken. No database change.

## Steps (each test-first, each its own commit)

1. **The answers rules change** (`routes/sightings.ts`).
   - The window: every kind is accepted until 30 days after the sighting's capture time. This replaces PR 7's 24 hours after the match, and its `chosen_at` / `cat_updates` / capture-time fallback, which is no longer needed.
   - Once per question per sighting: a second `food_and_water` or `note` for the same sighting is dropped, and the rest of the request is still recorded. (PR 7 refused the whole second set with `ALREADY_ANSWERED`. Now that answers arrive over a month, refusing everything because one question was already answered would lose the others.) `ALREADY_ANSWERED` is returned only when nothing in the request could be recorded.
   - `changeEarTip: true` replaces the device's own current ear-tip answer for this cat. It is refused with `EAR_TIP_CHECKED` if any of the device's ear-tip answers was superseded by a row it didn't write, or the cat has any `sterilised` observation (only staff, the legacy admin route and backfills ever write one). Under PR 7's (device, cat) lock it locks the current answer with `SELECT … FOR UPDATE`, re-checks nothing points at it, and writes the new answer on this sighting with `supersedesId` and reason "changed by the spotter". The same answer again writes nothing. Without the flag, a second ear-tip answer is dropped as before.
   - Tests: spec §7 1–10 (API side), plus the existing PR 7 suite updated for the new window.
2. **`GET /cats/{catId}/my-open-sightings?deviceId=…`** (`routes/sightings.ts`, next to the answers route that shares its rules). The device secret is checked as resolve does. It returns this device's resolved sightings of this cat with a capture time in the last 30 days and something still open: `{ sightingId, takenAt, photoUrl, open: { foodAndWater, note } }`. The ear tip's state is per cat: `{ state: open | answered | checked, current? }`. No coordinates, no note text, nothing about anyone else. One query per table, not per sighting. Tests: spec §7 11.
3. **OpenAPI and codegen** for both.
4. **The app.**
   - `lib/moreToAdd.ts` (pure): which questions to show, and how a change is sent.
   - `SightingQuestions` gains `show` (which questions) and `currentEarTip` (shows "You said: …" with "Change my answer", or "Syros Cats have checked this one").
   - `components/MoreToAdd.tsx`: the card and its sheet, on `app/cat/[id].tsx`, fed by the endpoint. It's shown only when the device is known, online and something is open. The sheet shows the sighting's own photo.
   - Copy in English, Greek and French (Greek and French are drafts for SYC-4).
   - Tests: spec §7 12–15 (app side).
5. **Check it in the browser** against a local API and database: an answered and an open sighting, changing an answer, and the checked state, at ~390 px and desktop.
6. **Independent adversarial review** (Sonnet, own worktree), folded in, then a PR stacked on #72.

## Model delegation

| Work | Tier | Why | Assurance |
|---|---|---|---|
| Steps 1–5, build and browser check | The session's model (Opus), as a chip continuing its own PR 7 work | It has PR 7's code, the spec and both reviews in context; handing off would cost more than it saves | Test-first against spec §7; mutation probe on the change path's row lock and the "checked" rule; browser walk-through |
| Translations | Same session | About 15 short strings that mirror PR 7's | SYC-4 native review |
| Step 6, adversarial review | Sonnet, own worktree | Standing rule: an independent pass on Claude-built PRs | Findings folded in and listed in the PR |

## Rollback

Revert. Answers already stored stay valid observations, and a changed answer's history stays intact. No migration.
