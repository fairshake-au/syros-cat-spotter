# SYC-415 PR 4 checkpoint — the extra-photo boxes (app)

Branch: `claude/syc-415-pr4-extra-photo-boxes`, off `origin/claude/syc-415-pr2-server-extra-photos` (#212) with `origin/claude/syc-415-pr1-photo-tips` (#209) merged in. Will need a rebase onto main once #212/#209 merge.

Scope: plan Tasks 4.1–4.6 only (not 4.7, not the browser walk-through — parent does it).

## Done
- 4.1 `lib/extraPhotos.ts` pure rules + `lib/__tests__/extraPhotos.test.ts` (8 tests).
- 4.2 `lib/prepareExtraPhoto.ts` (2048px long side, q0.8, null on failure) + test (5). Note: vitest 4 reports an error thrown by a vi.fn() implementation as a test failure even when the code catches it, so the test uses a plain recorder stub.

## Next
- 4.3 payloads + queue item, `extrasOf`/`coverOf`.
- 4.4 offline queue (keep list, sync, remove, replace, removeExtraPhoto/replaceExtraPhoto) + probes.
- 4.5 recentPhotos extraFingerprints.
- 4.6 ExtraPhotoBoxes + spot.tsx/review.tsx/submitFlow/appSettings wiring.

## Deviations / notes
- (none yet)
