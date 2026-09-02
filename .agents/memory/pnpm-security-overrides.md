---
name: pnpm security overrides
description: Where dependency security overrides belong and why duplicate override maps are unsafe.
---

Keep dependency security pins in the workspace-level override map rather than adding a second override map to the root package manifest.

**Why:** In this workspace, a root package override block displaced the existing platform-pruning overrides during lockfile generation, reintroducing many unnecessary native packages and causing large lockfile churn.

**How to apply:** Extend the existing workspace override section for transitive security fixes, regenerate the lockfile, and confirm the platform exclusions remain present.