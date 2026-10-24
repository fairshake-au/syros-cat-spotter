---
name: Push notification dispatch point
description: Where cat-related push notifications are dispatched in the API server.
---

All spotter push notifications route through two api-server dispatch points that now do real Expo push delivery via the shared `sendPushNotification` helper (Expo push HTTP API): `notifyDevices`/`notifyCatFollowers` in `src/lib/notifications.ts` (ownership claim/rename; `notifyCatFollowers` sends to the cat's followers only, not all spotters) and `createUpdateAndFanOut` in `src/lib/notificationFanout.ts` (cat updates).

**Why:** Devices register Expo push tokens per deviceId (`push_tokens` table, one token per device). Delivery is best-effort and fire-and-forget everywhere — callers use `void` + internal try/catch so push failures never affect HTTP responses.

**How to apply:** Add new notification kinds by calling these helpers with `{ title, body, data: { type, catId } }`; the mobile tap handler navigates by `data.catId`. Devices without tokens (web, denied permission, Expo Go limits) still get in-app fallbacks (inbox polling, ownership snapshot banner).
