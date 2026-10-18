# SYC-462 checkpoint

Branch `claude/syc-462-photo-removal`, worktree `.claude/worktrees/adoring-bohr-e8be1c`, from origin/main bdffc3c3. Draft PR #237.

## Done (18 Oct 2026)
- Research: ticket, SYC-246, SYC-66, project, launch plan, storage map (Explore/Sonnet), key claims spot-checked.
- Spec: `docs/superpowers/specs/syc-462-photo-removal-by-hand.md`.
- Adversarial review (Sonnet, own worktree, removed after): `...-review.md`, committed verbatim; all 18 findings folded (cc8383a1), disposition table at its end.
- Draft PR #237 opened. SYC-462 → In Progress with PR linked and a comment. Comments on SYC-246 (backfill) and SYC-44 (tile wording). SYC-303/SYC-276 already covered the side gaps (no new tickets).
- Artifact for reading: https://claude.ai/artifact/BkbLBsV4LgpoQcjs7P5Ku8

## Decisions (Samuel, 18 Oct 2026, via /decide; recorded on SYC-462)
- D1: **Bring November's change forward** (B): migration with nullable data + removed_at/by/reason; every bytes reader updated. Not the mime label.
- D2: Full rehearsal on development (after migrating development).
- D3: Not at launch; filed SYC-478.
- D4: settled by D1 (app changes required).

## Waiting on
- Spec revision 2 for D1=B DONE (d971a0d5). Review 2 (Sonnet) committed verbatim (ef3a6243) and all 14 findings folded in. Waiting on Samuel's spec approval. Migration number to be agreed with live sessions (0031 is latest on main).

## Next, after approval
1. Write the plan (with model delegation), get it approved.
2. Build test-first in this PR (T1–T15), local scratch DB only. Dry run via db-ops.sh against local scratch; paste output in PR.
3. Runbook `docs/runbooks/photo-removal.md`, restore line in `neon-database.md`, launch plan line 58 wording.
4. Before merge: re-check live sessions; message them (db-ops.yml / sightings.ts overlap). No migration needed.
5. After merge (parent session): D2 development-branch run with heads-up.
