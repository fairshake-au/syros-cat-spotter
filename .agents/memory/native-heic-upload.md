---
name: Adaptive native photo uploads
description: How the mobile app preserves native originals while reducing constrained-network uploads
---

Keep the picker and offline-queue photo in its native original format. Upload that original on normal Wi-Fi, but create a temporary smaller JPEG for cellular, expensive, or weak Wi-Fi connections.

**Why:** Requesting picker quality below 1 always transcodes, even when bandwidth is plentiful. A temporary derivative only when the current connection is constrained keeps the full-quality path while avoiding multi-megabyte uploads on island cellular networks.

**How to apply:** Request `quality: 1, base64: true`; for library picks use the current native representation. Never overwrite the queued original with the optimized derivative. Re-evaluate the network when queued uploads sync, because the connection can change after capture.
