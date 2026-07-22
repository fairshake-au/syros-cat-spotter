---
name: Native HEIC upload from Expo picker
description: How the mobile app avoids on-device JPEG transcodes now the server accepts HEIC
---

The server normalizes all uploads (JPEG/PNG/WebP/HEIC) to JPEG itself, so the client should not re-encode.

**Why:** expo-image-picker with `quality < 1` transcodes to JPEG on-device, and an extra ImageManipulator JPEG pass double-compresses. Server input cap is 20 MB, so raw phone photos fit.

**How to apply:** request `quality: 1, base64: true` from the picker; for library picks add `preferredAssetRepresentationMode: Current` to keep native HEIC. Only fall back to an on-device shrink when the asset has no base64 or exceeds ~15 MB. Offline photo queue and expo-image rendering are format-agnostic (iOS decodes HEIC natively).
