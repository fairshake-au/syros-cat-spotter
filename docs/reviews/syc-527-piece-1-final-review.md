# SYC-527 piece 1: final whole-branch review (a61f919f)

Reviewer: Sonnet, adversarial. No product code changed. Verdict: Ready to ship; the Minors below are worth a fast follow or one small fix commit.

## Finding 1 (Minor): a stale place plus a failed upload is quietly read as the island

`routes/teamCats.ts` ~L349-L358: the upload-error branch runs before `stalePlace`. Probe (temporary test, removed):
`POST area=zzz` with an over-10 MB file gives 413, the stale-place words are absent, and the re-drawn form shows
"across the island" with the photo form. The next upload then posts the island. No spend and no AI call, but it is
the silent widening the controller ruling forbids. Fix: run `stalePlace` before the upload-error branch (it needs
only `body`), or pass `problem: place` on that branch.

## Finding 2 (Minor): a colony chosen alone shows "Anywhere on the island" selected, with the island hint

`lib/teamPages/findPhotoPage.ts` `whereForm`. Probe: GET `?colony=<id>` has `<option value="" selected>Anywhere
on the island</option>` in the Area select and the hint "Anywhere on the island compares every cat". Misleading
beside a chosen colony. Fix: show `ANYWHERE_OPTION` as selected, and the hint, only when `isWholeIsland(f)`;
otherwise use "Choose an area or a colony. Colours narrow it further." No test covers a colony alone.

## Finding 3 (Minor): the counter_down 503 island words are untested

`routes/teamCats.ts` L438. Mutation: replace the island ternary at the `counter_down` site with
`MATCHING_DOWN_WORDS`; all 64 tests still pass. Only the `matching_down` site is covered. Fix: add an island
case to `team.findPhoto.counterDown.test.ts`, or hoist the ternary into one helper (also fixes the repeated-ternary minor).

## Finding 4 (Nit): the tie flow with no place has no committed test

It works (temporary test: `?tie=` GET carries the hidden tie and the file input; POST with only `tie`
returns 200, "across the island", and a form posting to `/api/team/reports/<id>/cat`). Not pinned.

## Finding 5 (Nit): `?area=&area=` (two empty values) is called stale

`given()` treats a non-empty array as given. Harmless (a hand-typed address only).

## Finding 6 (Nit): spec 5.2 puts the form hint under "What the page says plainly"

The dashboard spec says the page "also says" the hint; the hint is on the form, not the results page. Wording only.
