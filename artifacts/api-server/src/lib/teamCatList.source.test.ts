import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// SYC-396 PR 1.3: the cat list reads photos by publicId only. `photos.data` is
// the picture itself (base64); a list of hundreds of cats must never pull it
// out of the database. This text check goes red if teamCatList.ts selects it.

const code = (file: string) =>
  readFileSync(join(__dirname, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("teamCatList never reads the picture itself", () => {
  const src = code("teamCatList.ts");

  it("does not select photos.data", () => {
    expect(src).not.toMatch(/photosTable\s*\.\s*data\b/);
    // A bare select of the whole table would take every column, data included.
    expect(src).not.toMatch(/\.from\(\s*photosTable\s*\)/);
    expect(src).not.toMatch(/getTableColumns\(\s*photosTable/);
  });

  it("reads the photo through the cat's main photo, by publicId", () => {
    expect(src).toMatch(/photosTable\s*\.\s*publicId/);
  });
});
