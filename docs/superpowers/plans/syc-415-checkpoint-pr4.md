# SYC-415 PR 4 checkpoint — the extra-photo boxes (app)

Branch: `claude/syc-415-pr4-extra-photo-boxes`, off `origin/claude/syc-415-pr2-server-extra-photos` (#212) with `origin/claude/syc-415-pr1-photo-tips` (#209) merged in. Will need a rebase onto main once #212/#209 merge.

Scope: plan Tasks 4.1–4.6 only (not 4.7, not the browser walk-through — parent does it).

## Done
- 4.1 `lib/extraPhotos.ts` pure rules + `lib/__tests__/extraPhotos.test.ts` (8 tests).
- 4.2 `lib/prepareExtraPhoto.ts` (2048px long side, q0.8, null on failure) + test (5). Note: vitest 4 reports an error thrown by a vi.fn() implementation as a test failure even when the code catches it, so the test uses a plain recorder stub.
- 4.3 `sightingRequest`/`queuedSighting` carry extras only when non-empty; `PendingSighting.extraPhotos/extraNote/rejectedRole`; `extrasOf` (never throws, first face + first body) and `coverOf` (uri+base64 paired) in `lib/offlineQueue.ts`.
- 4.4 Offline queue: keep list includes extras; enqueue stores each extra as `<localId>-<role>` (never inline; dropped + `extraNote: 'extraNotKept'` on failure; `enqueue` now returns `{ extraNotKept }`); syncOne reads extras, skips a missing one (`extraNote: 'extraMissing'`), stores `rejectedRole`; `remove` deletes every extra; new `removeExtraPhoto`/`replaceExtraPhoto`; `replacementPhotoKey(localId, ref, role)`; 413 -> `spotTooLarge` (fixable) + `rejectedPhotoRole`; `spotTooLarge` string in en/el/fr. Tests: `context/__tests__/OfflineContext.extraPhotos.test.tsx` (16). Probes all red then restored: sweep keep list (test 1), remove (7), missing extra (3), replacement key (8 + replace test), inline extra (9a, 9b).
- 4.5 `lib/recentPhotos.ts`: `RecentPhoto.extraFingerprints`, `clean` drops a malformed one, `entryForOutcome(..., extraFingerprints)` (none kept when not a cat), `findAlreadyLogged` matches extras. Probes red then restored: findAlreadyLogged ignoring extras; extras kept for a not-a-cat spot.
- 4.6 (part): app settings switch — `SettingsView.extraPhotosOn` (false until the server says `extraPhotos: true`; old stored copies read as off); `SubmitOutcome.rejected.role` via `rejectedPhotoRole`, and 413 is a fixable rejection online too. Test literals updated (waitingCard, AppSettingsContext, useResultNudge). AppSettingsContext needed no change (it spreads `settingsFromResponse(res)`).

## Next
- 4.6 remaining: `components/ExtraPhotoBoxes.tsx` + test; i18n strings; spot.tsx wiring (setFirstPhoto, retakeFirstPhoto/clearPhoto split, addExtra, submit, queued rejected card) + `extraPhotosWiring` source test + spotRetake/pickedAsset source-test updates; review.tsx `coverOf` + `extraMissingNote`.

## Deviations / notes
- `removeExtraPhoto`/`replaceExtraPhoto` act only on `rejected` spots (as `replacePhoto` does). They requeue + sync only when the refusal was about that photo or the spot was too large (`spotTooLarge`); otherwise the spot stays rejected (the plan said "then set status queued" unconditionally, which would just re-fail on a refused first photo).
- For a 413 the plan's rule `rejectedRole = rejectedPhotoRole(err) ?? 'first'` gives `first`; the queued card must therefore special-case `spotTooLarge` to offer removing an extra (spec §6.4: "the spotter can remove a photo and try again").
- syncOne skips an extra on a transient read error as well as missing (plan says "missing or unreadable"), flagged with `extraMissing`.
