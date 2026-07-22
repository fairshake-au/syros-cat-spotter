---
name: HEIC decoding limits in sharp
description: sharp's bundled libvips cannot decode HEVC-compressed HEIC (default iPhone format); a WASM fallback is required.
---

The rule: sharp's prebuilt libvips decodes AVIF (`ftyp avif`) but NOT HEVC-compressed HEIC (`ftyp heic`/`mif1` with hevc data) — the default iPhone camera format. It fails with "Support for this compression format has not been built in".

**Why:** libheif in the prebuilt binaries ships without an HEVC decoder (patent licensing). Discovered while adding HEIC upload support to the photo validation pipeline — a Nokia HEVC sample failed under sharp but decoded fine via the `heic-convert` (WASM libheif) package.

**How to apply:** anywhere HEIC uploads are decoded, try sharp first, then fall back to `heic-convert` to JPEG and re-run through the sharp normalization pipeline. Magic-byte check for HEIF: bytes 4-8 = "ftyp", brand at 8-12 in {heic, heix, heim, heis, hevc, hevx, mif1, msf1, avif}.
