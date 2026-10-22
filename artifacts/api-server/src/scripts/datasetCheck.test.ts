import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatDataset, loadDatasetPairs, runDatasetCheck } from "./datasetCheck";
import { dinoEmbedder, loadClipEmbedder, type Embedder } from "./embedders";
import { main, parseArgs } from "./fingerprintAccuracy";

// SYC-527 piece 3, Task 4, check 2: the folder-of-cats mode, on synthetic
// pictures in a temp folder. No database, nothing downloaded.

const colourModel: Embedder = {
  name: "clip-b32-q8",
  async embed(jpeg) {
    const { channels } = await sharp(jpeg).stats();
    const v = Float32Array.from([channels[0]!.mean - 128, channels[1]!.mean - 128, channels[2]!.mean - 128]);
    const n = Math.hypot(...v);
    return v.map((x) => x / n);
  },
};

/** A picture with a distinct structure: `bars` coloured stripes, so the real model sees something different per cat. */
async function striped(bars: number, base: string, shift = 0): Promise<Buffer> {
  const w = 224;
  const h = 224;
  const rects = Array.from({ length: bars }, (_, i) => `<rect x="${(i * w) / bars + shift}" y="0" width="${w / bars / 2}" height="${h}" fill="#${((i * 0x3a5c7f + 0x203040) & 0xffffff).toString(16).padStart(6, "0")}"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${base}"/>${rects}</svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

let root: string;
const solid = (c: string) => sharp({ create: { width: 64, height: 64, channels: 3, background: c } }).jpeg().toBuffer();

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "vt-dataset-"));
  const cats: [string, string][] = [["cat-a", "#d01010"], ["cat-b", "#10d010"], ["cat-c", "#1010d0"], ["cat-d", "#d0d010"]];
  for (const [name, colour] of cats) {
    await mkdir(path.join(root, name));
    // Sorted: 1 is the gallery image, 3 the query; 2 sits between and must be ignored.
    await writeFile(path.join(root, name, "1.jpg"), await solid(colour));
    await writeFile(path.join(root, name, "2.jpg"), await solid("#808080"));
    await writeFile(path.join(root, name, "3.jpg"), await solid(colour));
  }
  await mkdir(path.join(root, "cat-one-image"));
  await writeFile(path.join(root, "cat-one-image", "only.jpg"), await solid("#101010"));
  await mkdir(path.join(root, "cat-broken-end"));
  await writeFile(path.join(root, "cat-broken-end", "1.jpg"), await solid("#d010d0"));
  await writeFile(path.join(root, "cat-broken-end", "2.jpg"), await solid("#d010d0"));
  await writeFile(path.join(root, "cat-broken-end", "3.jpg"), "not a picture");
  await writeFile(path.join(root, "README.txt"), "a stray file at the top is ignored");
});
afterAll(() => rm(root, { recursive: true, force: true }));

describe("check 2: the folder of cats", () => {
  it("gallery is the first sorted image, the query the last; one-image cats are skipped; an unreadable end falls inward", async () => {
    const { gallery, queries, skipped } = await loadDatasetPairs(root);
    expect(gallery).toHaveLength(5); // four cats, plus cat-broken-end using 1 and 2
    expect(queries).toHaveLength(5);
    expect(skipped).toBe(1);
  });

  it("reports hit rates for each model, with chance level and the 100-cat warning", async () => {
    const r = await runDatasetCheck(root, [colourModel]);
    expect(r.cats).toBe(5);
    expect(r.ranks["clip-b32-q8"]).toHaveLength(5);
    // The gray middle images (2.jpg) never reach the gallery or queries: every cat finds itself first.
    expect(r.ranks["clip-b32-q8"]!.slice(0, 4)).toEqual([1, 1, 1, 1]);
    const text = formatDataset(r).join("\n");
    expect(text).toContain("clip-b32-q8: top 10 100.0%, top 20 100.0%");
    expect(text).toContain("under the 100");
    expect(text).toContain("Chance level for the top 20: 100.0%");
    expect(text).toContain("not computed for this set");
  });

  it("--max-cats keeps the first folders only", async () => {
    const r = await runDatasetCheck(root, [colourModel], { maxCats: 2 });
    expect(r.cats).toBe(2);
  });

  it("runs the server's own DINOv2 end to end on pictures, and says what CLIP lacks", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vt-dataset-dino-"));
    try {
      for (const bars of [3, 5, 8]) {
        await mkdir(path.join(dir, `cat-${bars}`));
        await writeFile(path.join(dir, `cat-${bars}`, "a.jpg"), await striped(bars, "#ddd"));
        await writeFile(path.join(dir, `cat-${bars}`, "b.jpg"), await striped(bars, "#ddd", 3));
      }
      const lines: string[] = [];
      const code = await main(["--dataset", dir], {}, (l) => lines.push(l));
      expect(code).toBe(0);
      const text = lines.join("\n");
      expect(text).toContain("CLIP check skipped");
      expect(text).toMatch(/dinov2-small-q8: top 10 \d+\.\d%, top 20 \d+\.\d%/);
      expect(text).toContain("Both models are needed");
      // Plain stripes are not cats, so the ranks aren't asserted, only that the real model ran on every picture.
      const r = await runDatasetCheck(dir, [dinoEmbedder]);
      expect(r.ranks["dinov2-small-q8"]).toHaveLength(3);
      for (const k of r.ranks["dinov2-small-q8"]!) expect(k).toBeGreaterThanOrEqual(1), expect(k).toBeLessThanOrEqual(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("the CLIP folder must be real: a missing file is a clear error, nothing is downloaded", async () => {
    await expect(loadClipEmbedder(path.join(root, "no-such-model"))).rejects.toThrow(/CLIP model file not found/);
  });
});

describe("arguments", () => {
  it("reads --dataset, --clip-dir, --max-cats and CLIP_MODEL_DIR", () => {
    expect(parseArgs(["--", "--dataset", "d", "--clip-dir", "c", "--max-cats", "30"], {})).toEqual({ dataset: "d", clipDir: "c", maxCats: 30 });
    expect(parseArgs([], { CLIP_MODEL_DIR: "/m" }).clipDir).toBe("/m");
    expect(parseArgs([], {}).clipDir).toBeUndefined();
  });
  it("refuses anything else", () => {
    expect(() => parseArgs(["--nope", "x"], {})).toThrow(/Unknown argument/);
    expect(() => parseArgs(["--dataset"], {})).toThrow(/Give a value/);
    expect(() => parseArgs(["--max-cats", "0"], {})).toThrow(/whole number/);
  });
});
