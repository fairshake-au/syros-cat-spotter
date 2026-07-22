---
name: Anonymous device identity model
description: Device IDs are the bearer credential; public API responses must only expose opaque spotter codes
---

The cat-spotter app has no accounts: each device generates an unguessable device id that acts as both identity and bearer credential for its profile.

**Why:** A completion code review rejected the nickname feature because the leaderboard returned raw device ids — anyone could use a leaked id to PATCH another user's profile (IDOR). The fix was masking, not adding auth.

**How to apply:** Never include raw `deviceId` in any public/aggregate API response (leaderboard, cat catalog/detail, sightings). Expose `spotterCode` instead — a sha256-derived opaque code (see `spotterCode()` in the api-server cat helpers). Device ids are acceptable only in requests made by the owner and in that owner's own profile response. `artifacts/api-server/scripts/security-check.mjs` verifies these invariants against a running server.

Also: any endpoint keyed by an enumerable id (e.g. numeric sighting ids) that returns owner data must verify the caller's device credential matches the record owner (resolve endpoint returns 403 otherwise) — otherwise it becomes a credential-exfiltration path.
