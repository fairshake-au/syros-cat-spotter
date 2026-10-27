import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { pool } from "@workspace/db";
import app from "../app";
import { WIDE_CSP } from "../test/wideCsp";
import { ASSET_NAMES, assetUrl, hashedName, loadAssets, VENDOR, vendorBytes } from "../lib/teamAssets";

// SYC-396 PR 1.3.4: GET /api/team/assets/:file serves the dashboard's own
// scripts, and nothing else. Only a hashed name from the manifest; public
// bytes, kept a year; no session asked for and no cookie set.

const ROOT = path.resolve(__dirname, "../..");
const SOURCE = path.join(ROOT, "assets");

afterAll(async () => {
  await pool.end();
});

const gridUrl = () => {
  const url = assetUrl("dashboard-grid.js");
  if (!url) throw new Error("dashboard-grid.js wasn't loaded");
  return url;
};

describe("a file in the manifest", () => {
  it("is served at its hashed name, kept a year, as JavaScript, with nosniff and no cookie", async () => {
    const url = gridUrl();
    expect(url).toMatch(/^\/api\/team\/assets\/dashboard-grid\.[0-9a-f]{12}\.js$/);
    const res = await request(app).get(url);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(res.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.text).toBe(readFileSync(path.join(SOURCE, "dashboard-grid.js"), "utf8"));
  });

  it("is the same with a session cookie or without one, and sets none", async () => {
    const res = await request(app).get(gridUrl()).set("Cookie", "team_session=whatever");
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("HEAD answers with the same headers and no body", async () => {
    const res = await request(app).head(gridUrl());
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(res.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.text ?? "").toBe("");
  });

  it("every name a page may ask for exists", () => {
    for (const name of ASSET_NAMES) expect(assetUrl(name), name).not.toBeNull();
  });

  // SYC-705 Task 2b.4: the dashboard's map library, MapLibre GL JS, and PMTiles.
  it("MapLibre is the pinned 6.15.0 and pmtiles the pinned 4.3.2, served from here under the right types", async () => {
    const pkgVersion = (pkg: string) =>
      (JSON.parse(readFileSync(path.join(path.dirname(createRequire(import.meta.url).resolve(`${pkg}/package.json`)), "package.json"), "utf8")) as { version: string }).version;
    expect(pkgVersion("maplibre-gl")).toBe("6.15.0");
    expect(pkgVersion("pmtiles")).toBe("4.3.2");
    const pins = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { devDependencies: Record<string, string> };
    expect(pins.devDependencies["maplibre-gl"]).toBe("6.15.0");
    expect(pins.devDependencies["pmtiles"]).toBe("4.3.2");
    const want: [string, string][] = [
      ["maplibre-gl.mjs", "text/javascript; charset=utf-8"],
      ["maplibre-gl-worker.mjs", "text/javascript; charset=utf-8"],
      ["maplibre-gl.css", "text/css; charset=utf-8"],
      ["pmtiles.js", "text/javascript; charset=utf-8"],
    ];
    for (const [name, type] of want) {
      const url = assetUrl(name as never);
      const stem = name.slice(0, name.lastIndexOf("."));
      expect(url, name).toMatch(new RegExp(`^/api/team/assets/${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.[0-9a-f]{12}${path.extname(name)}$`));
      const res = await request(app).get(url!);
      expect(res.status, name).toBe(200);
      expect(res.headers["content-type"], name).toBe(type);
      expect(res.headers["cache-control"], name).toBe("public, max-age=31536000, immutable");
      expect(res.headers["x-content-type-options"], name).toBe("nosniff");
      expect(res.headers["set-cookie"], name).toBeUndefined();
      expect(res.body instanceof Buffer ? res.body.equals(vendorBytes(name)) : res.text === vendorBytes(name).toString("utf8"), name).toBe(true);
    }
    expect(vendorBytes("maplibre-gl.mjs").toString("utf8")).toContain("6.15.0");
    expect(vendorBytes("maplibre-gl.css").toString("utf8")).toContain(".maplibregl-map");
    expect(vendorBytes("pmtiles.js").toString("utf8")).toContain("pmtiles");
  });

  it("the worker is served with WIDE_CSP; every other asset as before (no policy of its own)", async () => {
    const worker = await request(app).get(assetUrl("maplibre-gl-worker.mjs" as never)!);
    expect(worker.headers["content-security-policy"]).toBe(WIDE_CSP);
    expect(worker.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(worker.headers["cross-origin-resource-policy"]).toBe("same-origin");
    for (const name of ASSET_NAMES.filter((n) => n !== "maplibre-gl-worker.mjs")) {
      const res = await request(app).get(assetUrl(name)!);
      expect(res.headers["content-security-policy"], name).toBeUndefined();
    }
    const missing = await request(app).get("/api/team/assets/maplibre-gl-worker.000000000000.mjs");
    expect(missing.status).toBe(404);
    expect(missing.headers["content-security-policy"]).toBeUndefined();
  });
});

describe("anything else is a plain 404", () => {
  const NOT_SERVED: [string, string][] = [
    // In the assets folder, but not a manifest name: only the hashed name is served.
    ["the plain name of a real file", "dashboard-grid.js"],
    ["an unknown name", "nope.js"],
    ["a wrong hash", "dashboard-grid.000000000000.js"],
    ["the manifest itself", "manifest.json"],
    ["an encoded ../package.json", "..%2fpackage.json"],
    ["an encoded ../../package.json", "..%2f..%2fpackage.json"],
    ["%2e%2e%2f", "%2e%2e%2fpackage.json"],
    ["an encoded absolute path", "%2fetc%2fpasswd"],
    ["a backslash", "..%5cpackage.json"],
    ["a NUL byte", "dashboard-grid.js%00"],
    ["a NUL before a real hashed name", `%00${gridUrlName()}`],
    ["a source file", "..%2fsrc%2fapp.ts"],
  ];
  it.each(NOT_SERVED)("%s", async (_what, file) => {
    for (const method of ["get", "head"] as const) {
      const res = await request(app)[method](`/api/team/assets/${file}`);
      expect(res.status, `${method} ${file}`).toBe(404);
      expect(res.headers["cache-control"], `${method} ${file}`).toBe("no-store");
      expect(res.headers["set-cookie"], `${method} ${file}`).toBeUndefined();
      if (method === "get") expect(res.text).toBe("Not found");
    }
  });

  // A real `..` in the path never reaches the route (a name can't hold a /),
  // so these fall through to the API's own 404, or (%2e%2e, which the client
  // resolves to /api/team/) to the queue's sign-in 401. Never a file.
  it.each([
    ["../package.json", "/api/team/assets/../package.json"],
    ["an absolute path", "/api/team/assets//etc/passwd"],
    ["a folder below", `/api/team/assets/x/${gridUrlName()}`],
    // The client resolves these before sending (WHATWG URL rules), so they too
    // arrive as some other path.
    ["%2e%2e", "/api/team/assets/%2e%2e"],
    ["%2e%2e/package.json", "/api/team/assets/%2e%2e/package.json"],
    ["a raw backslash", "/api/team/assets/..\\package.json"],
  ])("%s", async (_what, url) => {
    const res = await request(app).get(url);
    expect([401, 404]).toContain(res.status);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(String(res.headers["cache-control"] ?? "")).not.toMatch(/immutable/);
    expect(res.headers["content-type"] ?? "").not.toMatch(/javascript/);
  });
});

function gridUrlName(): string {
  return path.basename(assetUrl("dashboard-grid.js") ?? "missing.js");
}

describe("the production build and the in-memory names agree", () => {
  const out = mkdtempSync(path.join(tmpdir(), "vt-assets-"));
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it("scripts/buildAssets.mjs writes the same hashed names, and the built folder loads", () => {
    const printed = execFileSync(process.execPath, [path.join(ROOT, "scripts/buildAssets.mjs"), SOURCE, out], {
      encoding: "utf8",
    });
    const manifest = JSON.parse(readFileSync(path.join(out, "manifest.json"), "utf8")) as Record<string, string>;
    expect(JSON.parse(printed)).toEqual(manifest);
    const fromSource = loadAssets({ sourceDir: SOURCE });
    const fromBuild = loadAssets({ builtDir: out });
    expect(Object.fromEntries(fromBuild.names)).toEqual(manifest);
    expect(Object.fromEntries(fromSource.names)).toEqual(manifest);
    for (const [name, hashed] of Object.entries(manifest)) {
      const bytes = Object.hasOwn(VENDOR, name) ? vendorBytes(name) : readFileSync(path.join(SOURCE, name));
      expect(hashed).toBe(hashedName(name, bytes));
      expect(fromBuild.files.get(hashed)!.bytes.equals(bytes)).toBe(true);
    }
    // SYC-396 PR 1.5: every name a page may ask for is built, and vendored
    // files come from the pinned package, never a hand-kept copy in assets/.
    expect(Object.keys(manifest).sort()).toEqual([...ASSET_NAMES].sort());
    for (const name of Object.keys(VENDOR)) expect(existsSync(path.join(SOURCE, name)), name).toBe(false);
  });

  it("a built file that doesn't match its hash is not served", () => {
    const manifest = JSON.parse(readFileSync(path.join(out, "manifest.json"), "utf8")) as Record<string, string>;
    const hashed = manifest["dashboard-grid.js"]!;
    writeFileSync(path.join(out, hashed), "alert(1)");
    const loaded = loadAssets({ builtDir: out });
    expect(loaded.names.has("dashboard-grid.js")).toBe(false);
    expect(loaded.files.has(hashed)).toBe(false);
  });

  it("a manifest entry that names a path is not served", () => {
    writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ "x.js": "../../package.json" }));
    expect(loadAssets({ builtDir: out }).files.size).toBe(0);
  });
});
