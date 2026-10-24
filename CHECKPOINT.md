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

## 24 Oct, milestone 2
- Screenshots committed (docs/specs/assets/onboarding-fewer-screens/now-*.png). Found 6 steps incl. photo-tips sheet.
- Decision page published: https://claude.ai/artifact/5B1TXn8ACr71ZGRkRxiQ7b (source in session scratchpad first-photo-sooner.html).
  - D1 screens: A keep 5 / B fold How-it-works into safety / C = B + keep-safe after first sighting (REC, amends DECISIONS D5) / D = C + auto name.
  - D2 location: A auto at photo / B explain card at first photo, "Use where I am" + "I'll put the pin on the map" (REC) / C on Spot open / D own onboarding screen.
  - Sequencing: SYC-308 first, then SYC-524; SYC-575 keeps only camera buttons + glyph.
- Next: AskUserQuestion D1 then D2, record on SYC-524, write spec.

## 24 Oct, Samuel's steer on Decision 1 (quote): "let's combine the make it yours and don't lose your spots pages. I don't like the combined "how Syros Cat Spotters works" and "Look don't touch" page - give me some other options for combining these"
- Building round 2: name+email one screen (agreed), and options for How it works + safety: O1 steps on Welcome, O2 safety as a card in How it works, O3 How it works moves to Help & info, O4 keep both separate.

## Decision 1 DECIDED (Samuel, 24 Oct, quote): "1, but ensure that the "don't feed them" advice is included on the safety card too"
- = Welcome carries the 3 steps (existing strings); safety screen alone + "Please don't feed them" block (existing howStepDontFeed/Body) ; one Make it yours + Don't lose your spots screen. 3 screens.
- Fit measured at 390x844 on main: safety column 507px (el), 441 (fr), 419 (en) in a 744px scroll area → ~205px spare in Greek.
- Decision 2 DECIDED: B (explain at first photo). Recorded on SYC-524 (comment 24 Oct).
- Spec drafted: docs/specs/onboarding-fewer-screens.md. Next: Sonnet adversarial review → fold in → artifact → draft PR.

## Review folded in (24 Oct)
- Merged origin/main (d8e1c2e4, SYC-628 Settings) via sync tool.
- Sonnet review saved at docs/specs/reviews/onboarding-fewer-screens-review.md; all 14 findings handled in spec (email-first order, LocationProvider, Allow Once, etc.).
- Next: render spec as artifact, open draft PR, link on SYC-524, update SYC-575, file follow-ups (iOS purpose string localisation; DECISIONS D5 amend on approval), message sessions, ask approval.
