# dinov2-small-q8

The model behind "Find from a photo" across the whole island (SYC-527).

- Source: Hugging Face `Xenova/dinov2-small`, the ONNX export (8-bit quantised, `onnx/model_quantized.onnx`) of Meta's `facebook/dinov2-small`.
- Licence: Apache-2.0 (see `LICENSE`).
- Output: a 384-number "fingerprint" (the CLS token), scaled to length 1 by `src/lib/fingerprint/model.ts`.
- Loaded from disk only. The server never downloads it (`env.allowRemoteModels = false`).
- Changing any file here changes the fingerprints, so it needs a new model id (`MODEL_ID` in `model.ts`) and a re-fill of the index.
