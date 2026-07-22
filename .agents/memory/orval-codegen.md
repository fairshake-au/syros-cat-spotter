---
name: Orval codegen pitfalls
description: Gotchas when adding endpoints to lib/api-spec/openapi.yaml and running codegen
---

- Inline (anonymous) request-body schemas in openapi.yaml make the zod generator emit a `<OperationId>Body` schema whose name collides with the generated TS type of the same name, breaking `typecheck:libs`. **How to apply:** always define request bodies as named `components/schemas` (`XxxRequest`) and `$ref` them.
- Expo typed routes (`.expo/types/router.d.ts`) only regenerate while the expo dev workflow runs; after adding a new `app/*.tsx` route, restart the expo workflow before typechecking or the new path is rejected.
- Never `pkill -f "api-server"` style patterns — they match and kill your own shell/workflow processes; use `fuser -k <port>/tcp` for ad-hoc servers.
