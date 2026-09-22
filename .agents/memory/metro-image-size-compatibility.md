---
name: Metro image-size compatibility
description: Compatibility rule for replacing Metro's vulnerable image-size 1.x dependency.
---

Metro versions that depend on `image-size` 1.x pass ordinary asset file paths to its synchronous default export. Safe `image-size` 2.x releases accept byte arrays instead, so a version override alone breaks Expo asset bundling.

**Why:** The dependency audit can be cleared by forcing 2.x, but Expo export then fails while reading PNG dimensions because the path string reaches `TextDecoder`.

**How to apply:** When overriding Metro to `image-size` 2.x, keep a pnpm patch for every resolved Metro version that reads the asset file before calling the image-size default export. Verify with a real Expo export, not only typechecks.