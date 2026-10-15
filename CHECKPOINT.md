# CHECKPOINT — SYC-402 cat-matching game spec

Branch: `claude/bold-bardeen-uveanq` (off origin/main e428b15, 15 Oct 2026). Docs-only. Not for merge; delete before PR is final.

## Done
- Ground truth read: SYC-402, SYC-56, SYC-57, SYC-151, SYC-161, SYC-303, SYC-246, SYC-36, SYC-48.
- Code checked on origin/main: `lib/matching.ts` (LLM vision, 0–1 confidence per candidate), `routes/sightings.ts` (CONFIDENCE_THRESHOLD 0.4, 0.1 floor, 500 m radius), `sighting_matches` table (compared / suggested / choice / miss_kind).
- Docs conventions: spec → `docs/specs/<kebab>.md`; review → `docs/specs/reviews/<kebab>-review.md`.

## Next
1. Brainstorm with Samuel (one question at a time).
2. Write `docs/specs/matching-game.md`.
3. Sonnet adversarial review → `docs/specs/reviews/matching-game-review.md`; fold in.
4. Artifact render; PR "SYC-402: cat-matching game spec (for approval)"; link on SYC-402; move to In Progress; follow-up tickets.
