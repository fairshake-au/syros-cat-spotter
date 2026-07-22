---
name: Push notification dispatch point
description: Where cat-related push notifications are dispatched in the API server and what remains stubbed.
---

The cat ownership feature (claim/rename) notifies prior spotters via `notifyCatSpotters` / `notifyDevices` in the api-server's `src/lib/notifications.ts`.

**Why:** The dedicated spotter-notification task had not landed when ownership shipped, so `notifyDevices` is a console-log stub. Callers are fire-and-forget (`void` + internal try/catch) so delivery failures never affect HTTP responses.

**How to apply:** When real push infra lands (e.g. Expo push tokens per device), replace only the body of `notifyDevices` — all callers already route through it and pass `{ title, body, data: { type, catId } }` payloads (`type`: `cat_claimed` / `cat_updated`).
