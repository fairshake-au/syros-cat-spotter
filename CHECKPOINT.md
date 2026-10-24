# SYC-621 trapping planner: checkpoint

Branch claude/charming-ellis-652021 (worktree charming-ellis-652021), from origin/main a9be9c5b.

Decision (Samuel, 24 Oct, on SYC-621): the colony's homed, in-care, gone and merged cats go in a third fold, "Not on the street (N)".
Plan Task 2.3.1 (the price setting and the two permissions) is already on main (#256).

PR A = plan PR 2.3. PR B = plan PR 3.2 (log the round), stacked on A.

## Done
- [x] 2.3.2 lib/dashboard/trappingPlan.ts plus its test (11 pass; guardian mutation probe went red). Added to FILTERED_MODULES.

## Next
- [ ] 2.3.3 the colony page as the planner (To do, estimate, small sites map, print link, Done fold, Not on the street fold, then summary/edit/sites/notes/history); JSON gains the plan (guardian: no site positions)
- [ ] the printable plan, planPrintPage.ts, GET /team/colonies/:id/plan (print_trapping_plan); walk row
- [ ] the guardian-visible words in strings en/el/fr
- [ ] the estimate sentence back on Vet settings
- [ ] screenshots at 390 and 1280 and a print preview; full suite; adversarial review; draft PR A
- [ ] PR B: logRound, roundForm, /colonies/:id/round
