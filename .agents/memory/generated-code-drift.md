---
name: Generated code drift after merges
description: Mobile typecheck failures after merging main are usually stale generated code, not real bugs
---

After rebasing/merging main, `@workspace/cat-spotter` typecheck often fails with "no exported member" errors from `@workspace/api-client-react` or unknown expo-router routes.

**Why:** Two generated surfaces go stale: the orval API client (regenerate via the api-spec package's codegen script) and Expo typed routes in `.expo/types/router.d.ts` (regenerated only while the Expo dev server runs).

**How to apply:** Before debugging such typecheck errors, run the api-spec codegen and restart the cat-spotter Expo workflow, then re-run typecheck. Completion reviews rebase onto latest main, so a green local typecheck can still fail review if main moved — re-sync and regenerate.
