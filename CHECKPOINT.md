# SYC-186 checkpoint
Done: read tickets (186,119,153,93,196,3), choose-a-different-cat.md, queue code, server sighting routes.
Finding: restore (keepSafe/move.ts) takes over the SAME device id => server-side list follows the spotter to a new phone; a phone-only list would not.
Reproduced loss at 390px (shots in docs/screenshots/syc-186). Next: write docs/specs/unfinished-sightings.md, Sonnet adversarial review, artifact, ask Samuel. STOP before building.
Spec drafted: docs/specs/unfinished-sightings.md (recommend option C: server list + phone-saved merged; 30 days; discard table sighting_drops).
Next: Sonnet adversarial review -> docs/specs/reviews/unfinished-sightings-review.md, fold in, draft PR, artifact, AskUserQuestion D1-D4. STOP before building.
Review done and folded in (spec + docs/specs/reviews/unfinished-sightings-review.md). Next: push branch, open DRAFT PR, comment on SYC-186, artifact, AskUserQuestion D1-D4. STOP before building.
BUILD STARTED 26 Oct after Samuel approved plan §13. Steps: 1 server RESOLVED code; 2 keptAtSend item write; 3 spot.tsx; 4 review.tsx; 5 discard/banner/recent; 6 strings; 7 browser check; 8 suites+review. Done so far: (update below)
Step1 done (RESOLVED code), step2 done (lib/keptAtSend + enqueueSent + banner count). Next: step3 spot.tsx wiring.
