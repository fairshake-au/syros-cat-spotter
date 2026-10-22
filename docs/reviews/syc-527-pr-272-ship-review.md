# SYC-527 PR #272 ship review (adversarial, Sonnet critic)

Head reviewed: 5e6d4f0e. Verdict so far: no Blocker, no Major.

## Finding 1 (Minor): a place sent in the POST's web address is ignored, so the search runs on the whole island and uses a search

`artifacts/api-server/src/routes/teamCats.ts` POST `/team/cats/find`: `findFilters(body)` and `stalePlace(body, ...)` read the multipart body only.

Evidence (red test, deleted afterwards): `POST /api/team/cats/find?area=nope` with the photo and no body fields returned 200, "Compared with 12 cats across the island", and spent a search. A valid `?area=<key>` does the same. The page's own form never does this (it sends fields in the body), so only a hand-built request reaches it. It breaks the PR's own rule that a given place is never widened.

Fix: also run `stalePlace(req.query, ...)` on the POST (any area or colony given in the address is refused), or reject the request when `req.query` carries `area` or `colony`.
