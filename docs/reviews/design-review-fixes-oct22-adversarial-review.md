# Adversarial review: design-review-fixes-oct22.md (first draft, commit 649e405e)

**Reviewer:** Claude (Opus subagent, read-only), 22 Oct 2026.
**Outcome:** 2 blockers, 12 should-fix and 3 nits. All are addressed in the revised spec; its "Review record" maps each finding to the fix.

## Findings

1. **Blocker: D3 relied on a team flag that doesn't exist.** No team code reads `picked_from`. `review_hand_picks` is only declared (`capabilities.ts:107`). `labelChoice` drops `pickedFrom` when the chosen cat was a stored suggestion (`sightings.ts:522-528`), so cat-page usage wouldn't be measurable.
2. **Blocker: the question can't sit "above the look-alikes".** `review.tsx` is four screens (`:201-206`, `:754`). With zero candidates it opens on naming ("You're the first to spot this cat"). A "No" there invites a duplicate new cat for 25 points.
3. **Should-fix: the hint's plumbing.**
   - `queuedSighting` is pinned to six keys (`sightingPayload.test.ts:52-56`, 6b).
   - `parseReviewParams` keeps a fixed list of fields (`reviewParams.ts:178-190`).
   - A third `/review` path exists: `ReviewReadyBanner.tsx:36-45`.
4. **Should-fix:** `confirm()` sends the message to the picker's slot whenever `pickedFrom` is set (`review.tsx:266`), so a `NOT_NEARBY` refusal from the question would be invisible.
5. **Should-fix: the migration was described wrongly.**
   - New code on the old schema doesn't refuse the request. The label write is best-effort (`sightings.ts:1063-1075`), so the label row is silently lost.
   - The 400 comes from zod (`app.ts:174-185`).
   - The rollback must clear `cat_page` rows before restoring the narrow check.
   - The codegen and type unions need updating.
6. **Should-fix:** a `for` param left on `/spot` survives tab-bar returns and the browser history. It needs `setParams` clearing, and the staged-photo cases need defining.
7. **Should-fix: primed "Yes" answers** put wrong photos, notifications and ear-tip answers on a cat, and pollute matcher-miss labels. The 1.5 km rule is measured from the spotter's movable pin (`spot.tsx:419`).
8. **Should-fix: the dashboard fit has races.**
   - The focused-cat fit (`dashboard-map.js:764-765`) is overridden by a later positions fit.
   - "Go to" (`:726`) is overridden too.
   - `loadCats` runs on every filter change and keystroke (`:673`).
   - Each refit costs tiles against the 300-squares-per-10-minutes budget.
9. **Should-fix: the app fit.**
   - `clampZoom` floors at 12 (`mapTiles.ts:11,39`).
   - `zoomForDelta` uses latitude only, with no viewport size.
   - Direct OSM tiles churn on remount (`mapTiles.ts:13`).
   - The `coords` key remount (`cats.tsx:244`) contradicts "location doesn't move the view".
10. **Should-fix: "N cats" makes colonies stand out** (spine §6.2, :273-279), so it's a decision for Samuel. The label overlaps at zoom 12. Squares have no accessibility label (`AppMap.web.tsx:120`).
11. **Should-fix:** `sites.mapHint` begins "This map is only for the team.", which must stay visible. There's a third copy in `catMapPage.ts:244-248` (`teamOnlyHint()`).
12. **Should-fix:** the new `keepSafeWarning` contradicted `keepSafeUnder15`, which is in the same `<Text>` (`KeepSafeScreen.tsx:100`). `email-capture.md:143,548` quote the old copy.
13. **Should-fix: `reportCheckBlocked`.**
    - `ReportAdvice.test.tsx:225` asserts the domain.
    - The key is also used by `ReportIssueSheet.tsx:320`.
    - "Your phone" and "for this page" don't fit all cases.
    - "Try again" names no control.
14. **Should-fix:** `CatPageClaim.test.tsx:180,215,223` use `claimNotMetHint`. "The team answers anyone who emailed" was unchecked.
15. **Nit: ear-tip.** The order with `earTipUsuallyLeft` wasn't specified. The caption dropped "not a sterilisation mark". The same component is also used in `MoreToAdd`.
16. **Nit: unspecified states.**
    - Accessibility labels for the link, sheet, banner ✕ and the question.
    - Dark mode, and long Greek and French names at 390px.
    - The offline claim: answering needs signal.
    - "We'll sort it out" isn't agreed with the team.
17. **Nit:** Parts 1 and 3 both touch `i18n.ts`. The "Spot now" button belongs with Part 2. The migration number may collide on rebase.

## Claims checked and found correct

- **The privacy claim holds.** A resolve succeeds or fails on published cells and the dead-cat guard only (`sightings.ts:900-938`). The response is the same either way (15 points, no choice field, `:1121-1149`). `NOT_NEARBY` is not a new probe.
- **Other claims confirmed:**
  - An unknown `pickedFrom` gets a 400 from zod.
  - The dead-cat guard is real. There's no in-care guard on the server.
  - `PICKED_FROM` is at `sightingMatches.ts:24`, and the constraint at `:84`.
  - The replay builds its body field by field, and the exact-body test exists (`OfflineContext.test.tsx:620`).
  - `MET_MATCH_CHOICES` includes `hand_pick`.
  - The dashboard already uses `<details>`, and no test pins `mapHint`.
  - The budget is 300 squares per 10 minutes.
  - `CONTACT_EMAIL` is hello@catspotters.com.
  - `AppMap.web` sets zoom only on mount.
