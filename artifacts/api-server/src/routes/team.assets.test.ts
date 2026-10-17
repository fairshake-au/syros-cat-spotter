import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pool } from "@workspace/db";
import app from "../app";
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

  // SYC-396 PR 1.5: the island map's library, from our own server only.
  it("Leaflet is the pinned 1.9.4, served from here as JavaScript and as CSS", async () => {
    const js = await request(app).get(assetUrl("leaflet.js")!);
    expect(js.status).toBe(200);
    expect(js.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(js.text).toContain('version="1.9.4"');
    expect(js.text).toBe(vendorBytes("leaflet.js").toString("utf8"));
    const css = await request(app).get(assetUrl("leaflet.css")!);
    expect(css.status).toBe(200);
    expect(css.headers["content-type"]).toBe("text/css; charset=utf-8");
    expect(css.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(css.text).toContain(".leaflet-pane");
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
    // SYC-396 PR 1.5: every name a page may ask for is built, and Leaflet comes
    // from the pinned package, never a hand-kept copy in assets/.
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
