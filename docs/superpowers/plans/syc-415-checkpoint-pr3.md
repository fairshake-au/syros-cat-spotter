# SYC-415 PR 3 checkpoint — extra photos show everywhere

Branch `claude/syc-415-pr3-extra-photo-readers`, built on `claude/syc-415-pr2-server-extra-photos` (PR #212). Plan: `syc-415-photo-tips-and-extra-photos.md`, PR 3, Tasks 3.1–3.4.

## Done

- **Task 3.1** — `catsOfPhoto` has a fourth query (a spot's extra photos, through `sighting_photos`); `photoOfCat` in `routes/issues.ts` accepts any photo of a resolved sighting of the cat. Tests: `lib/capabilityTargets.extraPhotos.test.ts` (5), `routes/issues.extraPhotos.test.ts` (4), shared seeding helper `test/extraPhotoKit.ts`. Probes: dropping the new `catsOfPhoto` query turns (a) and (c) red; dropping the `sightingPhotosTable` condition in `photoOfCat` turns the "accepts body extra" test red. `team.photos`, `issues`, `photoVisibility` suites still green.

- **Task 3.2** — `GET /api/cats/:id`: one query for every resolved sighting's `sighting_photos` (joined to `photos`), the cover dropped, the extras folded into the one batched `hiddenPhotoIds` call; `serialiseSighting` adds `extraPhotos` only when non-empty. OpenAPI `Sighting.extraPhotos` (optional) and `SightingExtraPhoto`; codegen run. `cats.extraPhotos.test.ts` (4). Snapshots (`cats.publicDetail.p3-2.txt`, `publicPayload.p6.txt`) untouched and green. Probes: always emitting the key turns the one-photo test and both byte-exact snapshot tests red; dropping the extras from the hidden lookup turns the hidden test red. api-server typecheck clean.

- **Task 3.3** — `teamCatView`: two extra queries (`sighting_photos`, `sighting_matches.mixed_cats`) for all the cat's sightings; gallery order is main, then each sighting's cover and extras, then statements; `sightingIds` covers every spot photo (extras are "sighting", not "statement"); `TeamPhoto.role`; each sighting gets `extraPhotos` and `mixedCats`. `catPages.ts`: "Face photo" / "Whole body photo" caption and "(whole body photo, photo N of M)" for screen readers; "May show more than one cat" chip in the sightings list; two small CSS rules in `layout.ts`. Comment-only notes (spec §6.3) in `photoVisibility.ts` and `coatReading/due.ts`. New `routes/team.extraPhotos.test.ts` (7). Probes: sightingIds narrowed back to covers -> gallery test red; `mixedCats: false` -> flag and chip tests red; caption removed -> caption tests red. All `team*`, `teamPages`, `photoVisibility`, `coatReading` suites green except the known SYC-425 flake.

## Next

- Task 3.4 (app thumbnails), then the final runs and the draft PR.

## Deviations and notes

- **Plan (b) does not match the code.** The plan says a guardian of colony A can hide the body extra and a guardian of colony B gets 403. In the code, `POST /team/photos/:publicId/hide|restore` require `hide_photo` / `restore_photo`, which are island-only (team) capabilities with no colony target (`lib/capabilities.ts`, and `routes/team.walk.test.ts` lists both as "island-only"). Guardians get 403 for every photo, and `catsOfPhoto` is not used by those routes. Honouring the spec (§5.5: "who can hide photos of a cat can hide any of that cat's extra photos, and no other colony's") without inventing behaviour, test (b) asserts: team can hide the body extra (201), guardians of both colonies get 403. No guardian-scoped hide was added. The colony-scoped route that does use `catsOfPhoto` is the viewer (c), and `photoTargets` is proved directly in (a). So the probe "remove the catsOfPhoto query" turns (a) and (c) red but not (b).
- The plan's setup says to resolve a spot "the way sightings.resolve.test.ts does"; the kit instead saves with `saveSpotWithPhotos` and moves the sighting to resolved with a direct update (the one update the append-only trigger allows). Same row shape, no matcher or points side effects.
- The hiding staff person in the 3.1 test can't be removed afterwards (the hide log is append-only and signed), so the test leaves her to the throwaway database, as `issues.test.ts` does.
