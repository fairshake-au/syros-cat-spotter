/**
 * The vision model the server sends photos to (SYC-161 plan, PR 1). The one
 * place its name lives: the matcher (`matching.ts`) and the colour reader
 * (`coatReading/reader.ts`) both import it, so the two never drift apart.
 * Changing it changes the colour reader's `MODEL_VERSION` too.
 */
export const VISION_MODEL = "gpt-5.6-terra";
