import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { fingerprintOf } from "../lib/fingerprint/model";
import type { ModelName } from "./accuracyRules";

// SYC-527 piece 3, Task 4: the two models the accuracy check compares. Both
// take the app's 640 px "medium" JPEG and return a vector of length 1.
// DINOv2 is the server's own fingerprintOf, so the check measures exactly what
// the server will run. CLIP exists only here, to be measured against it: its
// files are never committed and never ship.

export interface Embedder {
  name: ModelName;
  embed(jpeg: Buffer): Promise<Float32Array>;
}

export const dinoEmbedder: Embedder = { name: "dinov2-small-q8", embed: (jpeg) => fingerprintOf(jpeg) };

/** The same decode as model.ts: our sharp makes plain pixels, the library never sees an encoded file. */
async function decode(jpeg: Buffer) {
  return sharp(jpeg)
    .rotate()
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

/**
 * CLIP ViT-B/32 (8-bit), read from a folder on disk (config.json,
 * preprocessor_config.json, onnx/vision_model_quantized.onnx). Nothing is
 * downloaded: remote models are switched off. Load it BEFORE the first DINOv2
 * call: both set the library's one global model folder while loading.
 */
export async function loadClipEmbedder(folder: string): Promise<Embedder> {
  const dir = path.resolve(folder);
  const onnx = path.join(dir, "onnx", "vision_model_quantized.onnx");
  if (!existsSync(onnx)) throw new Error(`CLIP model file not found: expected ${onnx}`);
  const { env, AutoProcessor, CLIPVisionModelWithProjection, RawImage } = await import("@huggingface/transformers");
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = path.dirname(dir);
  const id = path.basename(dir);
  const processor = await AutoProcessor.from_pretrained(id);
  const model = await CLIPVisionModelWithProjection.from_pretrained(id, { dtype: "q8" });
  return {
    name: "clip-b32-q8",
    async embed(jpeg) {
      const { data, info } = await decode(jpeg);
      const image = new RawImage(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height, 3);
      const inputs = await processor(image);
      const out = (await model(inputs)) as unknown as { image_embeds: { data: Float32Array; dispose?: () => void } };
      const v = Float32Array.from(out.image_embeds.data);
      out.image_embeds.dispose?.();
      let sum = 0;
      for (const x of v) sum += x * x;
      const len = Math.sqrt(sum);
      if (!(len > 0) || !Number.isFinite(len)) throw new Error("CLIP gave an unusable embedding");
      for (let i = 0; i < v.length; i++) v[i] = v[i]! / len;
      return v;
    },
  };
}
