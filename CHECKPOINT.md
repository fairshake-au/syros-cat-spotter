# CHECKPOINT: SYC-396 PR 2.5, Find from a photo

Worktree `.claude/worktrees/mystifying-chandrasekhar-34a97c` (this session's own; Samuel chose it on 19 Oct
because the app locks the session to it), branch `claude/mystifying-chandrasekhar-34a97c`, from `origin/main` `cbc89fa9`.
The empty `syc-396-pr-2-5` worktree and branch are left for Samuel to remove (removal was refused in auto mode).
Plan: `docs/superpowers/plans/syc-396-phases-2-4.md`, "PR 2.5" (Tasks 2.5.1, 2.5.2). This file is removed before merge.

## Facts found (19 Oct)
- No migration needed (the plan lists none; limits use `rate_limit_counters`).
- SYC-44 7.1 has not merged, so the Queue-page link ("Find this cat from the report's photo") is a follow-up, as the plan says. The `tie` field is still carried: the Cats page in "Which cat is this?" mode links to Find from a photo with `tie`.
- Launch plan line 260 also asks: remove the per-person cap and its test must go red (a fourth probe).
- Tests: `scratchpad/t.sh <files>` (esbuild/rollup workaround, local Postgres, CI dummy AI endpoint).

## Done
- [x] Read plan, spec §5.2, code, SYC-396/463, P-SYC-54, launch plan.
- [x] 2.5.1 `findFromPhoto.ts` (7be534c9): 16/16 tests. Probes red then restored: raw upload sent -> EXIF test red; primaryPhotoId -> hidden-photo test red.
  Additions to the plan's union: `no_place`, `bad_photo`, `refused` (gate = caps, run after narrowing + photo check, before any AI call). One group skips the final round (the group round already ranks them; still <= 4 calls).

## Next
- [ ] 2.5.2 multer, capability, limits, routes, page, Cats link, walk rows, tests, probes (limiter order, per-person cap)
- [ ] Screenshots 390/1280, upload errors, over-30
- [ ] Opus adversarial review (own worktree)
- [ ] Draft PR, Linear (SYC-396 comment, SYC-346 strings, follow-up tickets)
- [ ] Live probe on test site after publish, with heads-up first
