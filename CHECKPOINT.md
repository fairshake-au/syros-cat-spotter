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

## Next
1. Docs PR (own worktree .claude/worktrees/syc-315-docs, branch claude/syc-315-docs): roles spec 7.2/10.4,
   data spine 4.6 (l.219), 10.2 (l.690), table l.155-157, DECISIONS item 22, plan Decision G + T12g-2 note.
2. Build 2.2: writeObservation guardian reachable; commitStatement + news; guardian routes; listGuardianChanges;
   team page "Confirmed by X, cat guardian" + This is wrong; supersede rank rule (SYC-316); tests + probes.
