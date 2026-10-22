# SYC-527 PR #272 ship review (adversarial, Sonnet critic)

Head reviewed: 5e6d4f0e. Verdict so far: no Blocker, no Major.

## Finding 1 (Minor): a place sent in the POST's web address is ignored, so the search runs on the whole island and uses a search

`artifacts/api-server/src/routes/teamCats.ts` POST `/team/cats/find`: `findFilters(body)` and `stalePlace(body, ...)` read the multipart body only.

Evidence (red test, deleted afterwards): `POST /api/team/cats/find?area=nope` with the photo and no body fields returned 200, "Compared with 12 cats across the island", and spent a search. A valid `?area=<key>` does the same. The page's own form never does this (it sends fields in the body), so only a hand-built request reaches it. It breaks the PR's own rule that a given place is never widened.

Fix: also run `stalePlace(req.query, ...)` on the POST (any area or colony given in the address is refused), or reject the request when `req.query` carries `area` or `colony`.

## Finding 2 (Minor): on the GET form, a place written in an unrecognised way is read as the island with the photo form showing

`teamCats.ts` `stalePlace` only looks at the keys `area` and `colony`. `GET /find?area[]=x`, `?colony[]=1` (Express keeps the key as `area[]`) returned 200, "12 cats to compare across the island", with the file input. The page says "across the island" plainly and the next POST carries only clean fields, so no search is spent wrongly; it is a display widening only.

Fix (optional): treat any key that starts with `area` or `colony` other than the exact two as stale; or accept as a Nit.

## Finding 3 (Nit): tests cover only single bad values

The suite covers `area=no-such-area` and `colony=999999999`. These all pass today (my probes, deleted): area twice, area valid plus stale, area empty plus valid, stale area with a good colony, good area with a stale colony, upper case, whitespace, colony `0`, `-1`, `1e3`, 11 digits, colony twice, `["", id]`. A one-line table test over those would pin the array and duplicate paths (`given()` with arrays) which no current test touches.

## Finding 4 (Nit): colours are never refused

`?colours=bogus` is dropped and the search widens to all colours inside the place. This is #252 behaviour and cannot exceed 30 cats, so no spend risk. Mentioned only because the spec says "refused rather than widened" for place.

## Checked and fine

- Colony leading zeros (`000<id>`) read as that colony, not the island (200, "in <colony name>").
- A colony id can't be retired (only feeding sites carry `retiredAt`), so the retired-colony case does not exist.
- Stale place plus a `tie` to a real report: 400, zero calls, zero counts.
- Cat guardian and vet: GET and POST both 403, no count or island words.
- Stale-place words are static; the log line carries `outcome` only.
- Stale-place check runs before the upload-error branch, and the early cap look; so a stale place never spends.
- Island over 30 returns before the gate and the service (lib and route).
- Strict CSP on every non-200 (existing table test, plus the stale 400 asserts it).
