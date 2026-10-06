---
name: pnpm security overrides
description: Where dependency security overrides belong and why duplicate override maps are unsafe.
---

Keep dependency security pins in the workspace-level override map rather than adding a second override map to the root package manifest.

**Why:** In this workspace, a root package override block displaced the existing platform-pruning overrides during lockfile generation, reintroducing many unnecessary native packages and causing large lockfile churn.

**How to apply:** Extend the existing workspace override section for transitive security fixes, regenerate the lockfile, and confirm the platform exclusions remain present.

When an upstream release is unavailable, keep targeted source patches reproducible through pnpm and test the actual attack against the installed consumer dependency.

**Why:** Version-based dependency scanners do not inspect patched source and will continue to flag the original version, even when a tested patch closes the vulnerability. Renaming a dependency or ignoring its advisory would conceal that distinction.

**How to apply:** Report remaining version-based warnings honestly, document the mitigation and upstream replacement condition, and never treat a lower scanner count as proof that a source patch works.