# SYC-705 checkpoint

## Phase 1: done (25 Oct 2026), PR 1 as a draft

- **Built and reviewed:**
  - Tasks 1.1–1.6. Each had its own review, then a final whole-branch review (Opus) and one fix wave.
  - Tests: `pytest scripts/map-data` gives 63; `@workspace/map-style` vitest gives 11; `typecheck:libs` is clean.
- **Hosting is live.**
  - The bucket is `cat-spotters-map` (WEUR), served at `https://tiles.catspotters.com`.
  - CORS: `*`, GET and HEAD.
  - Cache rules: `/v*` for 1 year; `/current.json` for 5 minutes.
  - Probed with curl: a part-of-file request returns 206; the edge cache shows MISS, then HIT.
- **First local build (v1):**
  - `syros.pmtiles` is 1.47 MB.
  - 1,774 Latin-letter names were added.
  - Screenshots are in `docs/screenshots/syc-705/` (interim; retaken after SYC-720).

## Next

1. **Merge PR 1 and run "Rebuild Syros map" the same day,** before 05:17 UTC, so the daily check never runs against an empty host. Then:
   - run `scripts/map-data/check_live.sh`;
   - retake the screenshots from the hosted file;
   - read the first run's log for the empty-listing output (SYC-722).
2. **Phase 0 (phone proof)** needs Samuel to log EAS in. There's no Xcode or Android SDK on this Mac. Checklist additions:
   - the phone engine renders `is-supported-script` / `format` `text-font` (the two-line towns);
   - fonts load from `file://` paths that contain spaces.
3. **SYC-720 map look** is waiting for Samuel's answer.
4. **Then the detailed plans for Phases 2–4.** Each brings main in first, because the flaky-tests session (SYC-597/711) edits the cat-spotter vitest config and the api-server team.sites tests.
5. **NOTICE still says the OpenStreetMap map pictures carry ODbL.** The pictures themselves are CC BY-SA 2.0. Correct or remove that line when the last OpenStreetMap pictures go (Phase 3/4).

Progress log and rulings: `.superpowers/sdd/2026-10-24-syc-705-map-labels-maplibre/progress.md` (git-ignored).

## Phase 2 (dashboard): plan written 26 Oct 2026, awaiting Samuel's OK

- Plan: `docs/superpowers/plans/2026-10-26-syc-705-phase-2-dashboard.md` (PRs 2a, 2b, 2c).
- Open decision for Samuel: map pages reached by sending a form (recommend A, our map script runs there too).
- Next: on approval, Task 2a.1 (migrations 0051 + 0052) on branch `claude/syc-705-dashboard-maps-17c6b8`.
