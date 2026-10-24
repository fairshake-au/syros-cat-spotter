# SYC-524 checkpoint

Worktree: heuristic-jones-f8c2f2 (branch claude/heuristic-jones-f8c2f2, from origin/main 356a32b5).

## Done
- Read SYC-524, 501, 35, 155, 506, 502, 308, 575, 605, project; first-run spec; DECISIONS.md (D5 amended 28 Sep: onboarding ends with optional email step); profile-tab-redesign spec (other session).
- Key code facts:
  - Flow: Welcome (language chips) → How it works (4 cards incl. "Please don't feed them" + location box + "Allow & continue"; Skip skips the prompt) → Look, don't touch (no Skip) → Name → Don't lose your spots (root gate, KeepSafeScreen) → app.
  - Home (index.tsx:51), Cat-alogue (cats.tsx:57), Spot (spot.tsx:189), report.tsx all call useLocation() on mount, which REQUESTS permission (native) / getCurrentPosition (web). So removing the onboarding ask alone just moves the prompt to Home with no reason given.
  - Camera path with no position: map waits forever (mapStart.ts resolveMapStart: camera = phone or nothing) → SYC-308 dead end.
  - FirstBadgeOffer re-offers keep-safe at first badge when state 'skipped-onboarding'.

## Next
- Walk the flow at 390px in web preview (port 8124), screenshots to scratchpad.
- Decision artifact with mocks per option → AskUserQuestion.
- Spec docs/specs/onboarding-fewer-screens.md → Sonnet adversarial review → fold in → artifact → draft PR → Linear.
