# SYC-396 PR 3.1a (Log a vet visit): adversarial review

21 Oct 2026. Opus reviewer, in its own worktree, on head 4313ec5b (diff against #256's branch). Every finding had to be proven by a test that fails on the code as it was.

## Findings and what was done

| # | Severity | Finding | Done |
|---|---|---|---|
| F1 | Blocker | A visit logged twice, dated before a cat guardian's "not sterilised": undoing the first brought her "no" back, and the cat read **not sterilised** while the second visit still stood. The second visit wrote a plain "yes", because her "no" was already held down by the first. | Fixed. A visit now also overrules a higher-authority "no" that only other visits hold down (`notSterilisedToOverrule` in `lib/vetVisits.ts`). Test: "D8 holds while any visit stands" in `vetVisits.test.ts`. Mutation probe: going back to "standing rows only" turns it red. The guardian changes list now says "put back" only when her statement really stands again. |
| F2 | Should-fix | Rabies ticked and also typed, or a one-letter other vaccine, got a vague "couldn't be saved" instead of a message beside the vaccines. | Fixed. A vaccine both ticked and typed is saved once, and another vaccine's name needs 2 to 60 characters, as the writer requires. Tests in `team.vetVisit.test.ts`. |
| F3 | Nit | Ticking Vaccinated without `set_vaccination` gave a 403 page and lost what was typed. | Fixed. The form comes back with a message beside "What was done" and everything typed. Test in `team.vetVisit.test.ts`. |

## Checked and cleared by the reviewer

- **Decision 7.** Every route that corrects `sterilised`, `vaccinated` or `vet_visit` goes through `supersedeStatement`, which refuses visit rows, or through `undoVetVisit`.
- **Probing as a guardian.** A cat guardian can't learn that a row came from a visit by probing those routes. The first step refuses her.
- **Lock order.** It is the same everywhere: the cat, then the statement.
- **Rollback and news.** Rollback is covered by a test. The "desexed" news fires once.
- **Nothing leaks to cat guardians.** They never get cost, payer, clinic, vaccination or note, in the page or in its JSON.
- **Cost parsing.** "1,000", "1e3", "-5" and "2000.001" are all refused, and everything typed is escaped.
- **Dates.** They agree on Syros time.
- **Wording.** It follows the canonical facts.

## Left for later

- **SYC-542**: the guardian's "looked again" notice after a visit; a too-long reason on "Mark the visit wrong" isn't kept; "paid by" when costs can't be seen.
- **SYC-543** (decision): a newer team "not sterilised" still beats a visit dated earlier, with no warning.

## The builder's deviations, as the reviewer judged them

1–4 are acceptable. The unconditional Decision 7 refusal is stricter than the plan, and safe. Deviation 5 (no costs means "paid by Syros Cats") is filed as SYC-542 point 3.

## Second review at /ship (Sonnet, its own worktree, head d810aff4)

The F1 fix held. Three visits and two guardians were undone in all six orders. A log and an undo were run at the same moment. 80 randomised histories were tried. In every one the cat read sterilised while any visit stood, and the "desexed" news fired once. Three small findings, each proven by a failing test, then fixed:

| # | Severity | Finding | Done |
|---|---|---|---|
| 1 | Should-fix | After a visit was undone and the team then corrected her restored "no", the list showed the undone visit as still overruling her (`putBack: false`). A regression from the F1 change. | `putBack` now looks only at standing visits' hold on her statement. Test in `vetVisits.test.ts`. |
| 2 | Should-fix | A JSON caller's numeric `costEur` was saved as "cost not recorded". | The form reader accepts a number. Test in `team.vetVisit.test.ts`. |
| 3 | Nit | "Mark the visit wrong" on an undo row's id gave a confirm page, then a 500. | Now a 404. Test in `team.vetVisit.test.ts`. |

**Unproven, for later:**
- A visit logged twice gives her page two "looked again" lines. That belongs with SYC-542.
- `vetSpend` reads every visit twice per Home request: once for this month, once for last. This is about speed, not correctness.
