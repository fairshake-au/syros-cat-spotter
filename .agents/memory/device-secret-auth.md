---
name: Device secret auth (TOFU)
description: Owner-only endpoints require an X-Device-Secret header verified server-side, bound trust-on-first-use
---

Device ids appear in request paths/bodies, so knowing one must not grant control. Owner-only endpoints (notifications feed, read-all, push-token registration) require an `X-Device-Secret` header; the server stores a sha256 hash per device id (device_credentials table) bound on first authenticated use (TOFU) and rejects mismatches with 403 via the api-server deviceAuth helper.

**Why:** BOLA findings — anyone with a leaked device id could read/clear another spotter's notifications and hijack their push token.

**How to apply:** Any new endpoint that acts on behalf of a device (not merely referencing it) should call the deviceAuth helper instead of trusting a deviceId in path/body. The mobile app generates/persists the secret in DeviceContext and sends it globally via `setDeviceSecretGetter` in the api client's custom fetch — no per-callsite header wiring needed. TOFU is safe because device ids are unguessable and generated client-side; an attacker learning one later cannot rebind the credential.
