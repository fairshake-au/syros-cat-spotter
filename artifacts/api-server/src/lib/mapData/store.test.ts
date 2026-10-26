import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, mapDataFilesTable, pool } from "@workspace/db";
import { asc } from "drizzle-orm";
import {
  FONT_RANGES,
  FONT_STACKS,
  MAP_FALLBACK_VERSION,
  SPRITE_FILES,
  _resetMapDataForTests,
  currentMapVersion,
  getMapFile,
  mapFilePath,
  type MapSource,
} from "./store";

// SYC-705 Phase 2, Task 2b.2: the map file store. The real tiles host is
// never reached; every test passes a stub fetch.

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const enc = (s: string) => Buffer.from(s);
const FONT = "fonts-app/Noto Sans Regular/0-255.pbf";

type Host = {
  current: number | "down" | "junk";
  files: Record<number, Record<string, Buffer>>;
  badManifestSha?: boolean;
};

function stub(host: Host) {
  const calls: string[] = [];
  const f = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const u = new URL(url);
    if (u.pathname === "/current.json") {
      if (host.current === "down") throw new Error("offline");
      if (host.current === "junk") return Response.json({ version: "x" });
      return Response.json({ version: host.current });
    }
    const m = u.pathname.match(/^\/v(\d+)\/(.+)$/);
    if (!m) return new Response("no", { status: 404 });
    const files = host.files[Number(m[1])];
    if (!files) return new Response("no", { status: 404 });
    const path = decodeURIComponent(m[2]!);
    if (path === "manifest.json") {
      const out: Record<string, { bytes: number; sha256: string }> = {};
      for (const [p, b] of Object.entries(files)) {
        out[p] = { bytes: b.length, sha256: host.badManifestSha ? "0".repeat(64) : sha(b) };
      }
      return Response.json({ version: Number(m[1]), files: out });
    }
    const b = files[path];
    return b ? new Response(new Uint8Array(b)) : new Response("no", { status: 404 });
  });
  return { src: { fetch: f as unknown as typeof fetch } satisfies MapSource, calls, f };
}

beforeEach(async () => {
  _resetMapDataForTests();
  await db.delete(mapDataFilesTable);
});
afterAll(async () => {
  await db.delete(mapDataFilesTable);
  await pool.end();
});

describe("mapFilePath", () => {
  it("builds the known host paths", () => {
    expect(mapFilePath("tiles")).toBe("syros.pmtiles");
    expect(mapFilePath("font", "Noto Sans Regular", "0-255")).toBe(FONT);
    expect(mapFilePath("sprite", "light@2x.png")).toBe("sprites/light@2x.png");
  });
  it("rejects everything else", () => {
    expect(mapFilePath("font", "Noto Sans Bold", "0-255")).toBeNull();
    expect(mapFilePath("font", "../x", "0-255")).toBeNull();
    expect(mapFilePath("font", "Noto Sans Regular", "0-255.pbf")).toBeNull();
    expect(mapFilePath("font", "Noto%20Sans%20Regular", "0-255")).toBeNull();
    expect(mapFilePath("sprite", "../light.json")).toBeNull();
    expect(mapFilePath("sprite", "light%2Fx.json")).toBeNull();
    expect(mapFilePath("sprite", "dark.json")).toBeNull();
    expect(mapFilePath("bogus" as never)).toBeNull();
  });
  it("lists are the agreed ones", () => {
    expect(FONT_STACKS).toHaveLength(3);
    expect(FONT_RANGES).toHaveLength(6);
    expect(SPRITE_FILES).toHaveLength(4);
  });
});

describe("getMapFile", () => {
  it("fetches once, then serves from memory", async () => {
    const h = stub({ current: 2, files: { 2: { [FONT]: enc("aaa") } } });
    expect((await getMapFile(2, FONT, h.src))?.toString()).toBe("aaa");
    const n = h.calls.length;
    expect((await getMapFile(2, FONT, h.src))?.toString()).toBe("aaa");
    expect(h.calls.length).toBe(n);
    expect(h.calls.filter((c) => c.endsWith(".pbf"))).toHaveLength(1);
    // the font URL encodes the space in the folder name
    expect(h.calls.some((c) => c.includes("/v2/fonts-app/Noto%20Sans%20Regular/0-255.pbf"))).toBe(true);
  });

  it("serves from Postgres when tiles host is down", async () => {
    const h = stub({ current: 2, files: { 2: { [FONT]: enc("bbb") } } });
    await getMapFile(2, FONT, h.src);
    _resetMapDataForTests();
    const down = stub({ current: "down", files: {} });
    down.f.mockRejectedValue(new Error("offline"));
    expect((await getMapFile(2, FONT, down.src))?.toString()).toBe("bbb");
  });

  it("drops a file whose sha256 doesn't match the manifest", async () => {
    const h = stub({ current: 2, files: { 2: { [FONT]: enc("ccc") } }, badManifestSha: true });
    expect(await getMapFile(2, FONT, h.src)).toBeNull();
    expect(await db.select().from(mapDataFilesTable)).toHaveLength(0);
  });

  it("serves current-1 (stored); current-2 and current+1 are null with zero fetches", async () => {
    const h = stub({
      current: 3,
      files: { 3: { [FONT]: enc("v3") }, 2: { [FONT]: enc("v2") }, 1: { [FONT]: enc("v1") }, 4: { [FONT]: enc("v4") } },
    });
    expect((await getMapFile(2, FONT, h.src))?.toString()).toBe("v2");
    expect(await db.select().from(mapDataFilesTable)).toHaveLength(1);
    const before = h.calls.length;
    expect(await getMapFile(1, FONT, h.src)).toBeNull();
    expect(await getMapFile(4, FONT, h.src)).toBeNull();
    expect(h.calls.length).toBe(before);
  });

  it("unknown path is null without any fetch", async () => {
    const h = stub({ current: 2, files: { 2: {} } });
    for (const p of ["../x", "fonts-app/Noto Sans Bold/0-255.pbf", "sprites/dark.json", "manifest.json", "fonts-app/Noto%20Sans%20Regular/0-255.pbf", ""]) {
      expect(await getMapFile(2, p, h.src)).toBeNull();
    }
    expect(h.f).not.toHaveBeenCalled();
  });

  it("two concurrent asks make one fetch", async () => {
    const h = stub({ current: 2, files: { 2: { [FONT]: enc("ddd") } } });
    const [a, b] = await Promise.all([getMapFile(2, FONT, h.src), getMapFile(2, FONT, h.src)]);
    expect(a?.toString()).toBe("ddd");
    expect(b?.toString()).toBe("ddd");
    expect(h.calls.filter((c) => c.endsWith(".pbf"))).toHaveLength(1);
  });

  it("keeps only current and previous versions", async () => {
    const files = Object.fromEntries([1, 2, 3].map((v) => [v, { [FONT]: enc(`v${v}`) }]));
    const h = stub({ current: 1, files });
    await getMapFile(1, FONT, h.src);
    h.f.mockClear();
    // host moves to v2, then v3
    for (const cur of [2, 3]) {
      (h as unknown as { src: MapSource }).src = { ...h.src, now: () => Date.now() + cur * 10 * 3600_000 };
      const host = stubHostCurrent(h, cur);
      expect((await getMapFile(cur, FONT, host))?.toString()).toBe(`v${cur}`);
    }
    const rows = await db.select().from(mapDataFilesTable).orderBy(asc(mapDataFilesTable.version));
    expect(rows.map((r) => r.version)).toEqual([2, 3]);
  });
});

function stubHostCurrent(h: ReturnType<typeof stub>, cur: number): MapSource {
  const inner = h.f.getMockImplementation()!;
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    if (new URL(String(input)).pathname === "/current.json") return Response.json({ version: cur });
    return inner(input);
  }) as unknown as typeof fetch;
  return { fetch: f, now: (h.src as MapSource).now };
}

describe("currentMapVersion", () => {
  it("reads current.json, at most once an hour", async () => {
    const h = stub({ current: 2, files: {} });
    let t = 1_000_000;
    const src = { ...h.src, now: () => t };
    expect(await currentMapVersion(src)).toBe(2);
    expect(await currentMapVersion(src)).toBe(2);
    expect(h.f).toHaveBeenCalledTimes(1);
    t += 3600_000 + 1;
    await currentMapVersion(src);
    expect(h.f).toHaveBeenCalledTimes(2);
  });

  it("current.json unreachable falls back to newest stored version, then 2", async () => {
    const down = stub({ current: "down", files: {} });
    expect(await currentMapVersion(down.src)).toBe(MAP_FALLBACK_VERSION);
    _resetMapDataForTests();
    const body = Buffer.from("x");
    await db.insert(mapDataFilesTable).values([
      { version: 5, path: "syros.pmtiles", bytes: body, sha256: sha(body), size: 1 },
      { version: 4, path: "syros.pmtiles", bytes: body, sha256: sha(body), size: 1 },
    ]);
    expect(await currentMapVersion(down.src)).toBe(5);
    _resetMapDataForTests();
    const junk = stub({ current: "junk", files: {} });
    expect(await currentMapVersion(junk.src)).toBe(5);
  });
});
