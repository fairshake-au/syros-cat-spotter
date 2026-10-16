# CHECKPOINT: SYC-53 PR 2.2 (branch claude/syc-53-pr-2-2)

Worktree: .claude/worktrees/hungry-lovelace-9e8a66 (this session's). Base: origin/main ccba7947.

## Done
- Read plan (Slice 2, PR 2.2, Decision G), SYC-53 comments, SYC-315 (decided B), SYC-316, SYC-333, SYC-300.
- Mapped code: resolve.ts (resolveSterilised, authorityLevel), observations.ts (writeObservation, REACHABLE_ROLES),
  teamCorrections.ts (recordTeamStatement, supersedeStatement), notificationFanout.ts, routes/notifications.ts, teamMy.ts.

## SYC-315 (B) rule as I will build it
A "no" is out if any authoritative "yes" (level >= 1) is newer (observedAt strictly later).
Then Decision G (highest level, newest within, tie later id) among what remains.
Life status, ear tip unchanged.

## Built (committed)
- Docs PR #214 (SYC-315 B in specs/plan), own worktree .claude/worktrees/syc-315-docs, open, not merged.
- resolve.ts: (B) in resolveSterilised; PR 0.2 edge tests amended; probe recorded (5 red).
- observations.ts: guardian reachable only with colony scope; guardian supersedes own rows only; SYC-316 rank rule.
- commitStatement.ts (lock cat, before/after, desexed once, send after commit; `write` seam for vet/owner fixtures).
- teamCorrections: recordTeamStatement + supersedeStatement go through commitStatement.
- guardianStatements.ts + routes POST /team/my/cats/:id/{sterilisation,life-status}; put back; myStatementsOnCat ("mine").
- guardianChanges.ts listGuardianChanges(); team cat page: "Confirmed by X, cat guardian", 30-day flag.
- strings en/el/fr; walk rows.

## Next
1. Tests: T12a (her statements) + T23 + T28/T29c (routes/team.guardianStatements.test.ts);
   T12g-1..6 (lib/guardianPrecedence.test.ts); T12a-1..9 news (lib/commitStatement.test.ts);
   source test (lib/commitStatement.source.test.ts); listGuardianChanges tests; "mine" pinned + others' statements absent.
2. Mutation probes for every named test, recorded in PR body.
3. Full api-server suite; browser check 390/desktop en+el; screenshots docs/screenshots/syc-53-pr-2-2/.
4. PR, Opus adversarial review (own worktree), re-review, Linear, messages.
