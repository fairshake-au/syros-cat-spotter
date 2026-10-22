import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { logger, safeError } from "../logger";

// SYC-527 piece 3: the "looks like" model. Turns a photo into a fingerprint
// of 384 numbers (DINOv2 small, 8-bit) so cats that look alike can be found
// anywhere on the island. Runs on our own server from a file kept in the repo
// (models/dinov2-small-q8/): nothing is downloaded, no photo leaves the server.
//
// The model loads on the first call, once per process, never at start-up, so
// the other pages never pay for its memory. A failed load is not remembered:
// the next call tries again.

/** Names the model and how it is fed. A change to either means every stored fingerprint is stale. */
export const MODEL_ID = "dinov2-small-q8/v1";
export const DIMENSIONS = 384;

/** The model could not be loaded or run. Callers fall back to the area search. */
export class FingerprintUnavailable extends Error {
  constructor(message = "the looks-like model is not available", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FingerprintUnavailable";
  }
}

const FOLDER_NAME = "dinov2-small-q8";

/**
 * The models/ folder. Two layouts, found from this file's own location (not
 * the working directory): run from source (vitest, tsx) this file is
 * src/lib/fingerprint/model.ts, so models/ is three folders up; built, the
 * bundle is dist/index.mjs, so models/ sits one folder up.
 */
function defaultModelRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [path.resolve(here, "../models"), path.resolve(here, "../../../models")]) {
    if (existsSync(path.join(candidate, FOLDER_NAME))) return candidate;
  }
  return path.resolve(here, "../models");
}

interface Loaded {
  processor: (image: unknown) => Promise<Record<string, unknown>>;
  model: (inputs: Record<string, unknown>) => Promise<{ last_hidden_state: { data: Float32Array; dims: number[]; dispose?: () => void } }>;
  RawImage: new (data: Uint8ClampedArray, width: number, height: number, channels: 1 | 2 | 3 | 4) => unknown;
}

let modelRoot: string | undefined;
let loading: Promise<Loaded> | undefined;

/** Tests only: forget the loaded model, and optionally point at another models/ folder. */
export function resetModelForTests(root?: string): void {
  modelRoot = root;
  loading = undefined;
}

async function load(): Promise<Loaded> {
  const { env, AutoModel, AutoProcessor, RawImage } = await import("@huggingface/transformers");
  // Never reach for Hugging Face: only the file on disk.
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = modelRoot ?? defaultModelRoot();
  const processor = await AutoProcessor.from_pretrained(FOLDER_NAME);
  const model = await AutoModel.from_pretrained(FOLDER_NAME, { dtype: "q8" });
  return {
    processor: processor as unknown as Loaded["processor"],
    model: model as unknown as Loaded["model"],
    RawImage: RawImage as unknown as Loaded["RawImage"],
  };
}

function loaded(): Promise<Loaded> {
  if (!loading) {
    const attempt = load().catch((err: unknown) => {
      if (loading === attempt) loading = undefined; // let a later call retry
      logger.error({ err: safeError(err) }, "looks-like model could not be loaded");
      throw new FingerprintUnavailable(undefined, { cause: err });
    });
    loading = attempt;
  }
  return loading;
}

/**
 * The fingerprint of a JPEG (the app's 640 px "medium" photo): the model's
 * CLS token, scaled to length 1. Throws FingerprintUnavailable if the model
 * can't be loaded or run. Never logs the photo or the numbers.
 */
export async function fingerprintOf(jpeg: Buffer): Promise<Float32Array> {
  const m = await loaded();
  try {
    // Decode with the server's own sharp and hand the library plain pixels,
    // so the copy of sharp inside @huggingface/transformers never sees an encoded file.
    const { data, info } = await sharp(jpeg).rotate().flatten({ background: "#ffffff" }).toColourspace("srgb").removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const image = new m.RawImage(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height, 3);
    const inputs = await m.processor(image);
    const out = await m.model(inputs);
    const hidden = out.last_hidden_state;
    // [1, tokens, 384]: token 0 is the CLS token, the whole-picture summary.
    const cls = Float32Array.from(hidden.data.subarray(0, DIMENSIONS));
    hidden.dispose?.();
    let sum = 0;
    for (const v of cls) sum += v * v;
    const length = Math.sqrt(sum);
    if (cls.length !== DIMENSIONS || !(length > 0) || !Number.isFinite(length)) {
      throw new Error("the model gave an unusable fingerprint");
    }
    for (let i = 0; i < cls.length; i++) cls[i] = cls[i]! / length;
    return cls;
  } catch (err) {
    if (err instanceof FingerprintUnavailable) throw err;
    logger.error({ err: safeError(err) }, "looks-like model could not fingerprint a photo");
    throw new FingerprintUnavailable("the looks-like model could not fingerprint this photo", { cause: err });
  }
}
