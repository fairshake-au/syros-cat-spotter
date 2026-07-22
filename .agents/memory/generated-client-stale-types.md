---
name: Generated API client stale declaration types
description: Why the mobile app's typecheck can miss fields that exist in the generated client source
---

The mobile app typechecks against `lib/api-client-react` via a TypeScript **project reference** (composite, `emitDeclarationOnly`, `outDir: dist`). After Orval regenerates the client source, the `dist/*.d.ts` files can lag behind, making `tsc --noEmit` in the app report missing hooks/fields that actually exist in `src/generated`.

**Why:** the package has no `build` script; declarations are only refreshed by building the reference.

**How to apply:** when the app's typecheck complains about missing exports/fields from `@workspace/api-client-react`, run `npx tsc -b lib/api-client-react` from the repo root first, then re-run the app typecheck.
