# SYC-462 checkpoint

Branch `claude/syc-462-photo-removal`, worktree `.claude/worktrees/adoring-bohr-e8be1c`, from origin/main bdffc3c3. Draft PR #237.

## Done (18 Oct 2026)
- Research: ticket, SYC-246, SYC-66, project, launch plan, storage map (Explore/Sonnet), key claims spot-checked.
- Spec: `docs/superpowers/specs/syc-462-photo-removal-by-hand.md`.
- Adversarial review (Sonnet, own worktree, removed after): `...-review.md`, committed verbatim; all 18 findings folded (cc8383a1), disposition table at its end.
- Draft PR #237 opened. SYC-462 → In Progress with PR linked and a comment. Comments on SYC-246 (backfill) and SYC-44 (tile wording). SYC-303/SYC-276 already covered the side gaps (no new tickets).
- Artifact for reading: https://claude.ai/artifact/BkbLBsV4LgpoQcjs7P5Ku8

## Waiting on
- **Samuel's approval of the spec and decisions D1–D4.** Nothing is built until then.

## Next, after approval
1. Write the plan (with model delegation), get it approved.
2. Build test-first in this PR (T1–T15), local scratch DB only. Dry run via db-ops.sh against local scratch; paste output in PR.
3. Runbook `docs/runbooks/photo-removal.md`, restore line in `neon-database.md`, launch plan line 58 wording.
4. Before merge: re-check live sessions; message them (db-ops.yml / sightings.ts overlap). No migration needed.
5. After merge (parent session): D2 development-branch run with heads-up.
