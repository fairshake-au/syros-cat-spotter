# Adversarial review: SYC-44 PR 6.1 (full-screen photo, hidden-photo tile)

Independent reviewer: Sonnet, in its own worktree, at `origin/claude/syc-44-pr-6-1` (`a642a38b`), 19 Oct 2026. Committed verbatim by the building session; how each finding was handled is in the PR description.

**Verdict:** sound, safe to take to draft PR. No Blocker, no privacy leak. Fix 1 Major and 3 Minor first.

**Not done by the reviewer:** a full typecheck, and the whole API or app suite. It ran the 5 new or changed app test files (29 pass) and `photoVisibility.test.ts` (33 pass).

## Findings

1. **Major, CONFIRMED (mutation probe): the hero's stale-load guard is untested.**
   - Where: `app/cat/[id].tsx:176` (`heroLoaded === cat.photoUrl`).
   - Weakening it to `heroLoaded !== null` left all 29 tests green.
   - The case it protects: a refetch after a hide swaps the main photo for a stand-in that hasn't loaded yet.
   - Fix: a test that loads the hero, rerenders with a new `photoUrl`, and checks that a tap opens nothing until the new image loads.
2. **Minor, CONFIRMED: the extra-photo thumbnails skip the "already loaded" rule** (`SightingPhotos.tsx`, the thumb `onPress`).
   - Spec §4.2 says the view needs the photo already loaded. Offline, tapping an unloaded thumb opens a blank viewer.
   - It isn't a regression: the thumbs behaved the same way before this PR.
3. **Minor, CONFIRMED: the Greek tile treats Syros Cats as singular** (`όσο η Syros Cats την εξετάζει`).
   - The rest of `i18n.ts` uses the plural ("στους Syros Cats"), as do the English and French.
   - Fix: `Η φωτογραφία είναι κρυμμένη όσο οι Syros Cats την εξετάζουν.` Then re-check the fit at 320pt.
4. **Minor, CONFIRMED: the caption reads badly when the spotter isn't named.**
   - English gives "Spotted by Spotter AB12".
   - Greek `από` is followed by the nominative (`από ένας παρατηρητής`), which is wrong.
   - Fix: drop the prefix or restructure for the unnamed case.
5. **Nit: weak accessibility labels.**
   - The cover's label is just the date.
   - The hero and the cover announce "button" even when they can't open (photo not loaded).
6. **Nit, PLAUSIBLE:** no `accessibilityViewIsModal` or focus handling on the viewer.
7. **Nit, observation:** an open viewer closes when a refetch hides its photo, because the list key changes from `s.photoUrl` to `sighting-i`. That's the safer outcome, but it depends on the key, so it's worth a comment.

## Checked, no issue
- **Privacy.** The only public sighting serializer is `serialiseSighting`, called once (`cats.ts`). The flag comes from the same lookup that blanks `photoUrl`. Hiding the main photo doesn't set it on a sighting, and nothing says who hid a photo or why.
- **Compatibility.** A missing flag from an older server is treated as visible. No server snapshot asserts the sighting shape. Whether the app keeps React Query data across launches is unchecked.
- **Caption.** The stand-in comes from the cat's resolved sightings, which is the same set the page lists. The fallback to the discovery event is reasonable.
- **Modal and layout.** `registerModalOpen` is balanced, the pointer-events are right, and Android back works.
- **Strings.** French uses tu. The word is "spotter", never "snapper". The French tile uses the plural.

## Mutation probes (all restored)

| # | Mutation | Result |
|---|---|---|
| i | Tile shows for `photoUrl === null` | RED |
| ii-a | Cover's loaded-gate dropped | RED |
| ii-b | Hero's loaded-gate dropped | RED |
| ii-c | Hero staleness weakened to `heroLoaded !== null` | GREEN (finding 1) |
| iii | Server sends `photoHidden: false` always | RED (2 T6-2 tests) |

---

# Ship review (`/ship`, 19 Oct 2026): a second independent critic on the final version

Sonnet, in its own worktree, at `69b4d50e` (after the fixes above and the snapshot regeneration). **Verdict: MERGE.** No blockers; 2 Minor and 3 Nit.

1. **Minor, PLAUSIBLE: the main photo's viewer could reopen by itself on a different photo.**
   - A refetch swaps the main photo while the viewer is open: the viewer closes, but its "open" flag stays set. When the new photo loads, the viewer opens unasked.
   - **Fixed:** the page remembers *which* photo was opened. Tested, and the probe goes red.
2. **Minor, PLAUSIBLE: a viewer opened on an extra photo stayed open after a refetch hid that photo.**
   - The list key only covers the cover photo.
   - **Fixed:** the viewer shows only while the page still shows that photo. Tested for an extra photo and for the cover, and the probe goes red.
3. **Nit:** a photo that never loads stays a disabled button. That matches spec §4.2, and the fixed role is deliberate. **No change.**
4. **Nit:** `toLocaleUpperCase` uses the device's locale. **Changed to `toUpperCase`.** None of the current words is affected.
5. **Nit:** T6-2 has no test for a sighting with no photo. A sighting can't exist without a photo (`sightings.photo_id` is `NOT NULL`, checked while building), and the code guards it anyway. **No change.**

**Checked, no issue:**
- The snapshots change only by `"photoHidden":false`.
- OpenAPI, zod and the client agree.
- Privacy holds.
- `serialiseSighting` is the only public sighting serialiser.
- Disabling the main photo doesn't block the back button.

**The critic ran:**
- the app suite, 1,832 tests;
- the full typecheck;
- 4 server test files, 40 tests;
- 3 mutation probes, all red.
