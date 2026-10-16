# SYC-415 PR 2 checkpoint — the server takes extra photos

Branch `claude/syc-415-pr2-server-extra-photos`, off `origin/claude/tester-photo-quality-155c58` (main `1eda7d2c` + docs). Plan: `syc-415-photo-tips-and-extra-photos.md`, PR 2, Tasks 2.1–2.6.

## Done

- **Task 2.1** — `sighting_photos` table, `sighting_matches.no_cat_in_any_photo` / `mixed_cats`, setting `extra_photos_on` (seeded `false`). Migration `0029_sighting_photos.sql` (renumbered from 0028 on rebase: main took `0028_photo_variants`) with backfill and commented rollback. `migrate:check` ok on a local scratch DB.

## Next

- Task 2.2 — OpenAPI contract + 413 for an oversize body.
- Task 2.3 — `spotPhotos.ts` (cover rule, validation, one-transaction save).
- Task 2.4 — matcher takes all photos.
- Task 2.5 — upload route.
- Task 2.6 — `/app-settings` switch.

## Deviations from the plan, and notes

- Checkpoint file is `syc-415-checkpoint-pr2.md` (as the brief asked), not `syc-415-checkpoint.md`.
- `.github/workflows/db-ops.yml`: added `extra_photos_on` to the `setting_key` choice list. Without it, the switch can't be flipped through the db-ops workflow (plan Decision P1 = A needs that).
- `lib/db/src/switchover/carryBack.test.ts`: its "rows with no home" count for `app_settings` goes from 1 to 2, because 0029 seeds a second row (the same thing 0027 did).
- Duplicate-photo check: run against a local scratch DB only (seeded with a deliberate shared photo and a missing photo to exercise `ON CONFLICT` and the `JOIN`). The Neon development-branch check is for the parent session.
- Pre-existing flake on the base branch, unrelated: `team.siteWrites.test.ts` "zoom, pan and the area buttons…" fails when a random tile token happens to contain `digit-digits-digit` (seen once on the untouched baseline run).
