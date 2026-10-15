# CHECKPOINT: SYC-53 Slice 2 (PR 2.1 then 2.2)

Worktree: lucid-goodall-050c55, branch claude/syc-53-pr-2-1 (off origin/main e428b159).

## Done
- Read plan Slice 2, spec §2.2/§6.1/§6.2/§6.8/§7.4, SYC-53 comments, SYC-333, SYC-316, #194 diff.
- Messaged "Write SYC-209 feeding sites implementation plan" about overlap (#194 colony page links, sites, catTarget canonical).

## Plan vs code / other plans
- Moved-cat line: roles plan says PR 2.1 owns `movedCatNotices`; SYC-209 plan (on main) says `movedAwayNotices` is SYC-209 PR 4.2. Asked Samuel.
- Feeding sites on the cat page: needs #194's sitesForPerson (unmerged).

## Next
1. lib/publicCatPayload.ts (move catPayload out of routes/cats.ts, unchanged behaviour)
2. capabilityTargets: canonical cat through cat_identity (SYC-333)
3. lib/guardianCatView.ts (own allow-list) + tests T4/T5
4. routes GET /api/team/my/colonies/:id, /api/team/my/cats/:id (+ walk rows, strings en/el/fr, pages)
5. probes, browser check, PR, Opus review
