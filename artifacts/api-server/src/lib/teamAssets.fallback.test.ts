import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger";
import { createAssets, hashedName } from "./teamAssets";
import { renderPage } from "./teamPages/layout";

// SYC-396 PR 1.3.4 (adversarial review, finding 3): with no script to give,
// the page simply has none, and a broken or missing build never stops the
// server starting. It logs, and assetUrl answers null.

const SOURCE = path.resolve(__dirname, "../../assets");
const GRID = readFileSync(path.join(SOURCE, "dashboard-grid.js"));
const root = mkdtempSync(path.join(tmpdir(), "vt-assets-fallback-"));
let n = 0;

/** A folder standing in for dist/ (the running code's folder), with this assets/ inside. */
function codeDir(files: Record<string, string | Buffer>): string {
  const dir = path.join(root, `case-${++n}`, "dist");
  mkdirSync(path.join(dir, "assets"), { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, "assets", name), body);
  return dir;
}

afterEach(() => vi.restoreAllMocks());
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("renderPage with no script", () => {
  it.each([null, undefined])("script: %s draws no script tag", (script) => {
    const html = renderPage({ title: "Cats", active: "cats", personName: "Susan", body: "<p>x</p>", script });
    expect(html).not.toMatch(/<script/i);
  });

  it("with one, it draws exactly that tag in the head", () => {
    const html = renderPage({ title: "Cats", active: "cats", personName: "Susan", body: "", script: "/api/team/assets/x.0123456789ab.js" });
    expect(html.match(/<script\b/g)).toHaveLength(1);
    expect(html).toContain('<script src="/api/team/assets/x.0123456789ab.js" defer></script></head>');
  });
});

describe("a broken build: logged, no script, no crash", () => {
  const good = hashedName("dashboard-grid.js", GRID);
  const cases: [string, () => string][] = [
    ["a manifest that isn't JSON", () => codeDir({ "manifest.json": "{ not json" })],
    ["a manifest naming a file that isn't there", () => codeDir({ "manifest.json": JSON.stringify({ "dashboard-grid.js": good }) })],
    [
      "a file that doesn't match its hash",
      () => codeDir({ "manifest.json": JSON.stringify({ "dashboard-grid.js": good }), [good]: "alert(1)" }),
    ],
    ["a manifest entry naming a path", () => codeDir({ "manifest.json": JSON.stringify({ "dashboard-grid.js": "../x.js" }) })],
    ["an empty manifest", () => codeDir({ "manifest.json": "{}" })],
    [
      "no build and no source folder",
      () => {
        const dir = path.join(root, `case-${++n}`, "nothing", "here");
        mkdirSync(dir, { recursive: true });
        return dir;
      },
    ],
  ];

  it.each(cases)("%s", (_what, make) => {
    const errors = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const dir = make();
    let made: ReturnType<typeof createAssets> | undefined;
    expect(() => (made = createAssets(dir))).not.toThrow();
    expect(made!.assetUrl("dashboard-grid.js")).toBeNull();
    expect(made!.assetFile(good)).toBeUndefined();
    expect(errors).toHaveBeenCalled();
    // The last word is always which page runs without its script.
    expect(errors.mock.calls.at(-1)![1]).toBe("dashboard asset missing; its page runs without it");
  });

  it("a good build loads, and says nothing", () => {
    const errors = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const dir = codeDir({ "manifest.json": JSON.stringify({ "dashboard-grid.js": good }), [good]: GRID });
    const made = createAssets(dir);
    expect(made.assetUrl("dashboard-grid.js")).toBe(`/api/team/assets/${good}`);
    expect(made.assetFile(good)!.bytes.equals(GRID)).toBe(true);
    expect(errors).not.toHaveBeenCalled();
  });
});
