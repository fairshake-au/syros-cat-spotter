# SYC-415 PR 1 checkpoint

Branch `claude/syc-415-pr1-photo-tips`.

- [x] Task 1.1 — seen mark (`lib/photoTipsSeen.ts` + test). Note: test and implementation were written in the same step, so the red run was not observed for this task (green only).
- [x] Task 1.2 — cartoons, tips, i18n (en/el/fr). Added optional `testID` prop to purropolis Button (plan needs testID on "Got it"; Button had none). Poor-photo blur drawn as 0.55 opacity per plan.
- [x] Task 1.3 — PhotoTipsCard (overlay, no Modal), spot.tsx card + link, review.tsx not-a-cat tips, wipePhone. Tests: PhotoTipsCard, photoTipsWiring (mutation probe: removing markPhotoTipsSeen turns the wiring test red).
- [x] Full suite green at PR open. REVIEW FIXES in progress: (1) link below viewfinder, top row restored; (2) shouldOpenPhotoTips helper + tightened wiring tests + 4 probes red; (3)(4) done in spot.tsx. TODO: (5) card Escape/BackHandler/dialog role, (6) Greek informal singular, then full suite + push.

Local test setup: rollup darwin binary copied into node_modules/.pnpm/rollup@4.62.2; esbuild via ESBUILD_BINARY_PATH from a scratchpad npm pack.
