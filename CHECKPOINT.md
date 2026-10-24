# SYC-508 checkpoint

Worktree: .claude/worktrees/ecstatic-varahamihira-3050d5, branch claude/ecstatic-varahamihira-3050d5 (from origin/main 356a32b5).

## Done
- Spec: docs/specs/couldnt-load-try-again.md (revised after review).
- Sonnet adversarial review committed: docs/specs/reviews/couldnt-load-try-again-review.md (15 findings, all folded in).
- Artifact for Samuel: https://claude.ai/artifact/PVMQeW7J5waaqXkwzcCqz7
- Linear SYC-508 In Progress, artifact linked, status comment posted.
- Follow-ups filed: SYC-629 (pull to refresh), SYC-630 (picker), SYC-631 (cat-alogue profile chip), SYC-632 (server no-cat guard), SYC-633 (cat page). Option B ticket only if Samuel picks A.
- Messaged syc-509-a11y (it lands first, I rebase) and SYC-628 profile session (no reply yet).

## Waiting on
- Samuel: approve spec + pick D1 (recommended A).

## Next (after approval)
1. LoadFailed component + i18n keys (en/el/fr).
2. useCatsWithCache: cacheChecked, loadFailed, awaitable refetch, timeout 20s, retry 1, networkMode always; never save empty list.
3. Cat-alogue + Home strip; Home stats Try again; Home hide tiles at firstSpot.
4. NotificationContext loadFailed + notifications screen empty/failed states.
5. review.tsx !data screen; Not-a-cat per D1.
6. Tests, browser checks 320/390/desktop, light/dark, en/el/fr; strings to SYC-346; file §6 tickets; draft PR.
