# SYC-415 PR 4 checkpoint — the extra-photo boxes (app)

Branch: `claude/syc-415-pr4-extra-photo-boxes`, off `origin/claude/syc-415-pr2-server-extra-photos` (#212) with `origin/claude/syc-415-pr1-photo-tips` (#209) merged in. Will need a rebase onto main once #212/#209 merge.

Scope: plan Tasks 4.1–4.6 only (not 4.7, not the browser walk-through — parent does it).

## Done
- 4.1 `lib/extraPhotos.ts` pure rules + `lib/__tests__/extraPhotos.test.ts` (8 tests).

## Next
- 4.2 `lib/prepareExtraPhoto.ts`.
- 4.3 payloads + queue item, `extrasOf`/`coverOf`.
- 4.4 offline queue (keep list, sync, remove, replace, removeExtraPhoto/replaceExtraPhoto) + probes.
- 4.5 recentPhotos extraFingerprints.
- 4.6 ExtraPhotoBoxes + spot.tsx/review.tsx/submitFlow/appSettings wiring.

## Deviations / notes
- (none yet)
