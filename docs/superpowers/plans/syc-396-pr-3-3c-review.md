# Adversarial review: SYC-396 PR 3.3c, Vet visits and costs

Reviewer: a Sonnet agent in its own worktree (plan's delegation row for 3.3c), 22 Oct 2026, on head `22c87582`. The text below is the reviewer's report as returned. How each finding was handled is at the end.

## Verdict

No blocker. Merge-worthy after small fixes: 2 major test gaps and 3 minor items. The core rules are correct: spend counts only syros_cats and donation, Decision 14 purposes, undo, permissions, CSV injection, and cents. Choice 2 (excluding redacted rows) changed after reading 38 lines of the redaction code; see finding 3.

State of the tree:
- Typecheck: `typecheck:libs` and the api-server typecheck are both clean.
- Tests: `vetCosts.test.ts` (7) passes, and `team.reportPages.test.ts` with `team.reportsArea.test.ts` (27) pass.
- Probe-only files were deleted and the tree restored.

## Findings

1. **MAJOR (test gap): "never counted twice" and "cents" are barely pinned.**
   - Mutating `cents()` to a raw float `eur*100` passes all 7 tests, because `Math.round` in the test hides it.
   - A probe summing 0.1 + 0.2 + 55.1 + 19.99 + 33.33 gave an exact 108.72, so the code is fine today. The test just can't catch a regression.
   - Fix: assert `spendEur` and `perSterilisation.avg` with `toBe` on awkward cents.
2. **MAJOR (test gap): choice 1, the distinct-cat skip in noCost, is untested.**
   - Removing `&& !sterilisedByVisit.has(o.catId)` (mutation M4) passes everything.
   - Nothing covers a cat with an "Update this cat" row plus a standing Sterilised visit.
   - Nothing covers two update rows on one cat (a probe gave 1, so counting works).
   - A visit dated outside the range still makes the skip happen (a probe gave 0). That is defensible, but undocumented.
   - Fix: add tests for the three cases, and document that the skip looks at visits on any date.
3. **MINOR (choice 2): redacted visits are dropped.**
   - The same `!o.redactedAt` filter is in `vetCosts.ts`, `home.ts` `vetSpend` and `vetVisits.ts` `visitsFor`.
   - `resolve.ts` says a redacted row's value survives and stays active.
   - The risk is low today. `severPerson.ts` redacts only by `device_id`, and `logVetVisit` writes `accountId`, so team visits are not redacted now. If redaction ever reached team rows, money would vanish from spend silently.
   - Fix: stay consistent with Home and the cat page in this PR. Ticket dropping the filter in all three places, and pin the chosen behaviour with a test.
4. **MINOR (equivalent mutant): month bucketing is never exercised at a boundary.**
   - `<=` to `<` in `monthOf` passes, but that path is unreachable with midday-UTC dates.
   - A probe gave the right Athens months: 30 Sep 20:59:59Z falls in September, and 30 Sep 21:30Z falls in October.
   - Fix: add a cheap pure test on those two instants.
5. **MINOR: a successful vet CSV download is never asserted as recorded.**
   - Fix: add a test that a 200 on `vet-visits.csv` writes a `report_downloads` row.
6. **MINOR (wording): an owner-paid Sterilised visit with no cost counts in "no cost recorded".**
   - This follows the plan literally ("visits with Sterilised and costEur: null").
   - Fix: make the hint say "whoever paid", or restrict the count to spend-paid visits.
7. **MINOR (choice 7): cost per sterilisation includes the vaccination part of a combined visit, and the page doesn't say so.**
   - Fix: add a hint.
8. **NIT (performance): every `sterilised` and `vet_visit` row on the island is read on each view.**
   - A date-bounded query would be unsafe, because undo and supersede rows must be read too. Home does the same.

## Checked and fine

- **Permissions:**
  - The page and the CSV check `view_vet_costs` before any work or download record, and a HEAD request goes through the same handler.
  - Removing either check turns a test red.
  - A cat guardian is refused, and the list card isn't a link for someone without the capability.
  - A report that doesn't exist gives 404 before the vet check, and a known vet report gives 403.
- **CSV injection:**
  - Cat names are made formula-safe, and a test uses a cat named `=HYPERLINK(...)`.
  - The clinic comes from a fixed list.
  - A treated note follows "Treated (", so it can't lead a cell.
- **Privacy:** no position, owner name, person name or logger id appears.
- **Undo:**
  - An undone visit is nowhere.
  - Undoing the undo brings the visit back.
  - D8 supersede with a guardian "no" is not tested here.
- **Dates:** `visitAt` clamps to now, so a same-day visit is inside `range.to`.
- **Money:** amounts are added in cents, and the download is recorded before the file is sent.

## Mutation results

| # | Mutation | Result | Tests that went red |
|---|---|---|---|
| M1 | owner added to SPEND_PAID_BY | caught | "an owner-paid €60 visit appears in visits but not in spendEur" |
| M2 | vaccinated before sterilised in purpose order | caught | purposeOf; "Sterilised-and-Vaccinated … byPurpose" |
| M3 | range `from` ignored | caught | "counts a visit by its date"; "Sterilised-and-Vaccinated …" |
| M4 | drop the skip of a cat sterilised by a visit | **not caught** | — |
| M5 | include redacted visits | **not caught** | — |
| M6 | float cents | **not caught** | — |
| M7 | month bucket `<=` → `<` | not caught (equivalent at midday UTC) | — |
| M8 | drop noCost for null-cost Sterilised visits | caught | "… 'Update this cat' counts in noCost …" |
| M9 | owner-paid counts in cost per sterilisation | caught | the owner-paid test (`perSterilisation.n`) |
| M10 | undo ignored | caught | "an undone visit is nowhere" |
| R1 | CSV route: no view_vet_costs check | caught | "someone without view_vet_costs is refused …" |
| R2 | page route: no view_vet_costs check | caught | the same |

## Verdict on the builder's deliberate choices

1. **Distinct cats, with the skip when a standing Sterilised visit exists:** right, and better than counting "rows". It needs tests, and the skip ignoring the range should be stated.
2. **Excluding redacted rows:** acceptable for now, but wrong as a principle. It matches Home and the cat page. Follow it up with a ticket, and pin it with a test.
3. **No countedCats filter:** right. It matches Home.
4. **The cross-kind superseder subquery, with standingRows over the whole island:** right and necessary.
5. **`areasVersion: number | null`, with no areas line on the vet page:** right.
6. **The cat as a plain name, with no link:** right.
7. **The whole visit cost in the average:** acceptable, but the page should say so.

## How the findings were handled (builder, 22 Oct 2026)

- **1, 2, 4:** each now has a pure test in `vetCosts.test.ts` ("cents" with 0.29 + 0.57, which floating point gets wrong; "noCost per cat"; "Athens month edge"). M4 and M6 were re-run and both now go red. M7 stays unreachable (visits are dated midday UTC); the month-edge test pins the real boundary.
- **2:** a comment in `vetCosts.ts` and the page hint now say the skip looks at visits on any date.
- **3:** kept consistent with Home and the cat page. A test pins it, and dropping the filter in all three places is ticketed.
- **5:** a new test checks that a successful `vet-visits.csv` writes its `report_downloads` row.
- **6:** the hint now says "whoever paid". The count follows the plan.
- **7:** the cost-per-sterilisation section now says "A visit that also vaccinated or treated the cat counts its whole cost."
- **8:** left as it is, the same as Home.
