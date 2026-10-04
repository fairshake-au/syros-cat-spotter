# Review: adding details to a cat later (`add-details-later.md`, SYC-117 part 2)

**Reviewer:** an independent adversarial reviewer (Sonnet, in its own worktree), 4 October 2026, against `origin/claude/syc-117-part2-spec` at `e6f9413`.
**Checked against:** `cat-record-data-spine.md` (§3.4, §4, §7, §8, §10.1, §10.8), `DECISIONS.md` (Parts 2c, 2i, 3), the data spine plan (PR 7, Q2, Q3), and the code on PR 7's branch (`routes/sightings.ts`, `lib/observations.ts`, `lib/resolve.ts`, `lib/captureTime.ts`, `routes/cats.ts`, `openapi.yaml`).

## Findings and what was done

| # | Severity | Finding | What changed |
|---|---|---|---|
| 1 | **High** | **The spec's main safety claim was false.** The spec said that dating every answer to its photo stops a late answer from making a cat look recently seen. But the app won't store a public date more than 30 days old: `writeObservation` quietly moves it forward to "30 days ago". A photo synced late from the offline queue (up to 30 days old already) and answered weeks later would get an answer dated weeks newer than the real sighting. `loadCatRecords` counted ear-tip answers as evidence the cat was alive, so this would have pulled "last seen alive" forward. The spec's own test example (20 days) sat inside the limit and wouldn't have caught it. Verified in code. The same exposure existed, more narrowly, in PR 7's 24-hour window. | **Fixed twice.** (1) In PR 7 (#72, commit `18af2ff`): `loadCatRecords` now counts an ear-tip answer that belongs to a sighting only through that sighting, at its true date, with a test that reproduces the moved date. (2) In this spec, Decision 2 now recommends **a month from when the photo was taken**, not from the match, so an answer's date never needs moving. The option that measures from the match is kept, with this risk stated. Test 2 now covers the edge (a photo taken 29 days ago, matched today). |
| 2 | High (process) | The header and §11 said a review was done and linked this file before it existed. | Expected order: the spec was drafted with its review section ready, and this file was written once the review came back. It now exists, and the header was updated to match. |
| 3 | Medium | `my-open-sightings` holds up (device-scoped, own sightings only, no coordinates). But a future "move a sighting to another cat" tool (SYC-150) would need to decide what happens to that sighting's answers. | Added to §8 as an interaction whoever builds SYC-150 must handle. |
| 4 | Low | §6 said an answer "adds no new evidence of life beyond the sighting", which was only true until finding 1's date-moving happened. | Reworded: true by construction now, and it says why (PR 7's loader change). |
| 5 | Nit | Decision 1's table implied option A was safe for the ear tip by construction, which finding 1 showed it wasn't yet. | Holds now, after finding 1's fixes. No further change. |

## What held up

- All five decisions give realistic options, honest benefits and risks, what the person sees, and a recommendation. Nothing is decided quietly.
- The two changes to PR 7's approved rules (24 hours → a month; one set of answers per sighting → each question once per sighting) are stated openly and match the code.
- Q3 → B (ear tip once per spotter per cat) is unchanged.
- Canonical facts are respected: "clipped tip", usually the left ear, "cat guardian", "Syros Cats", the two audiences' needs fit together, and no claim that it all works without signal.
- SYC-2 (coat and markings) appears only as a future kind of detail.
- Plain English throughout.
