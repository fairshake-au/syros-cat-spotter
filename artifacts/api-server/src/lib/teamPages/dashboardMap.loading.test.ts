import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SYROS_OUTLINE } from "@workspace/geo";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";
import { renderCatMapPage, type CatMapOptions } from "./catMapPage";

// SYC-619 Task 13 (spec §5.4, §8.4): while the map pictures load, a light
// outline of Syros sits in a pane below them and "Loading the map…" shows at
// the top of the map. The first picture's onload clears the line; the failure
// outline (tilesFailing) is untouched and replaces it. The outline's points
// live in one module (SYROS_OUTLINE), passed to the script as data-outline.

const SRC = readFileSync(
  join(__dirname, "../../../assets/dashboard-map.js"),
  "utf8",
);

/** Anything: callable, constructible, every property another such thing. */
function chain(): any {
  return new Proxy(function () {}, {
    get: (_t, p) =>
      p === "then" ? undefined : p === Symbol.toPrimitive ? () => 0 : chain(),
    apply: () => chain(),
    construct: () => chain(),
  });
}

interface Polygon {
  pts: unknown;
  opts: any;
  added: boolean;
  layerBuilt: boolean;
}

function setUp(
  opts: {
    outline?: string | null;
    fetchMode?: "hang" | "tokens" | "reject" | "empty" | "mixed";
  } = {},
) {
  const outlineAttr =
    opts.outline === undefined ? JSON.stringify(SYROS_OUTLINE) : opts.outline;
  const dom = new JSDOM(
    "<!doctype html><html><body>" +
      '<form id="catfilters" action="/api/team/cats"><input type="checkbox" name="colours" value="ginger"></form>' +
      '<div id="mapcount"></div>' +
      '<div id="mapscripted"><div class="mapwrap"><div id="island-map" ' +
      (outlineAttr === null ? "" : `data-outline='${outlineAttr}' `) +
      `data-areas='${JSON.stringify([{ key: "ermoupoli", lat: 37.44, lng: 24.94, zoom: 15 }])}'></div>` +
      '<p class="mapnote" id="mapnote" role="status" hidden>Map pictures aren\'t loading.</p></div>' +
      '<div id="mapgoto"><button data-area="ermoupoli">Ermoupoli</button></div></div>' +
      "</body></html>",
    {
      url: "https://team.example/api/team/cats?view=map",
      runScripts: "outside-only",
    },
  );
  const w = dom.window as any;

  const panes: Array<{ name: string; style: Record<string, string> }> = [];
  const polygons: Polygon[] = [];
  let layerBuilt = false;
  const tileLayerCtor: { layer?: any } = {};
  const note = () => w.document.getElementById("mapnote") as any;

  const map = new Proxy(
    {
      createPane: (name: string) => {
        const pane = { name, style: {} as Record<string, string> };
        panes.push(pane);
        return pane;
      },
      getZoom: () => 13,
      getMinZoom: () => 12,
      getMaxZoom: () => 19,
      project: () => ({ x: 0, y: 0 }),
    } as Record<string, unknown>,
    { get: (t, p: string) => (p in t ? t[p] : chain()) },
  );

  w.L = new Proxy(
    {
      map: () => map,
      polygon: (pts: unknown, o: any) => {
        const poly: Polygon = { pts, opts: o, added: false, layerBuilt: true };
        polygons.push(poly);
        const stub: any = new Proxy(
          {
            addTo: () => {
              poly.added = true;
              poly.layerBuilt = layerBuilt;
              return stub;
            },
          } as Record<string, unknown>,
          { get: (t, p: string) => (p in t ? t[p] : chain()) },
        );
        return stub;
      },
      GridLayer: {
        extend: (proto: any) => {
          return function () {
            layerBuilt = true; // from here Leaflet can ask for pictures
            tileLayerCtor.layer = proto;
            return chain();
          };
        },
      },
    } as Record<string, unknown>,
    { get: (t, p: string) => (p in t ? t[p] : chain()) },
  );
  const TOKEN = "A".repeat(59);
  w.fetch = (url: string, init: { body: string }) => {
    if (
      !url.includes("/map-squares") ||
      opts.fetchMode === undefined ||
      opts.fetchMode === "hang"
    ) {
      return new Promise(() => {}); // nothing answers
    }
    if (opts.fetchMode === "reject")
      return Promise.reject(new Error("offline"));
    const b = JSON.parse(init.body);
    const tokens: Record<string, string> = {};
    if (opts.fetchMode === "empty") {
      return Promise.resolve({
        ok: true,
        redirected: false,
        headers: { get: () => "application/json" },
        json: async () => ({ tokens: {} }),
      });
    }
    for (let x = b.xMin; x <= b.xMax; x++)
      for (let y = b.yMin; y <= b.yMax; y++) {
        // "mixed": only the first square is on the island; the rest are blank.
        if (opts.fetchMode === "mixed" && x !== b.xMin) continue;
        tokens[`${b.z}/${x}/${y}`] = TOKEN;
      }
    return Promise.resolve({
      ok: true,
      redirected: false,
      headers: { get: () => "application/json" },
      json: async () => ({ tokens }),
    });
  };

  w.eval(SRC);
  return {
    w,
    panes,
    polygons,
    loadingLine: () => w.document.getElementById("maploading") as any,
    note,
    /** Ask the script's tile layer for n pictures, as Leaflet would. */
    async tiles(n: number) {
      const imgs: any[] = [];
      for (let i = 0; i < n; i++)
        imgs.push(
          tileLayerCtor.layer.createTile(
            { z: 13, x: 100 + i, y: 100 },
            () => {},
          ),
        );
      await new Promise((r) => setTimeout(r, 20));
      return imgs;
    },
  };
}

describe("the map while its pictures load (SYC-619 §5.4)", () => {
  it("makes a pane below the tile pane and puts the outline in it before any picture", () => {
    const t = setUp();
    const pane = t.panes.find((p) => p.name === "outlineBelow");
    expect(pane).toBeDefined();
    expect(Number(pane!.style["zIndex"])).toBeLessThan(200);
    const loading = t.polygons.find((p) => p.opts.pane === "outlineBelow");
    expect(loading).toBeDefined();
    expect(loading!.added).toBe(true);
    expect(loading!.layerBuilt).toBe(false); // in place before any picture can be asked for
    expect(loading!.pts).toEqual(SYROS_OUTLINE.map((p) => [...p]));
    expect(loading!.opts).toMatchObject({
      stroke: true,
      weight: 1,
      color: "#b8b3a6",
      fillColor: "#e3dfd3",
      fillOpacity: 1,
      interactive: false,
    });
  });

  it("shows the loading line at the start", () => {
    const t = setUp();
    const line = t.loadingLine();
    expect(line).not.toBeNull();
    expect(line!.textContent).toBe("Loading the map…");
    expect(line!.className).toBe("maploading");
    expect(t.w.document.getElementById("island-map").parentNode).toBe(
      line!.parentNode,
    );
  });

  it("skips the loading outline, not the line, when data-outline is missing or invalid", () => {
    for (const outline of [null, "not json", '"x"', "[]"]) {
      const t = setUp({ outline });
      expect(t.polygons.some((p) => p.opts.pane === "outlineBelow")).toBe(
        false,
      );
    }
  });
});

describe("the loading line goes with the first picture, or the failure note", () => {
  it("is removed when the first picture's onload fires", async () => {
    const t = setUp({ fetchMode: "tokens" });
    const [img] = await t.tiles(1);
    expect(t.loadingLine()).not.toBeNull(); // asked for, not arrived
    img.onload();
    expect(t.loadingLine()).toBeNull();
  });

  it("shows the failure note, and the line is gone, when the only picture fails for good", async () => {
    const t = setUp({ fetchMode: "tokens" });
    const [img] = await t.tiles(1);
    img.onerror(); // first failure: asks for a new token
    await new Promise((r) => setTimeout(r, 20));
    expect(t.loadingLine()).not.toBeNull(); // still being retried
    expect(t.note().hidden).toBe(true);
    img.onerror(); // second failure is final
    expect(t.loadingLine()).toBeNull();
    expect(t.note().hidden).toBe(false);
  });

  it("shows the failure note, and the line is gone, when the token request fails", async () => {
    const t = setUp({ fetchMode: "reject" });
    await t.tiles(1);
    expect(t.loadingLine()).toBeNull();
    expect(t.note().hidden).toBe(false);
  });

  it("keeps the line while one square is off the island and the real picture is still loading", async () => {
    const t = setUp({ fetchMode: "mixed" });
    const [img] = await t.tiles(2);
    expect(t.loadingLine()).not.toBeNull(); // the blank square must not clear it
    expect(t.note().hidden).toBe(true);
    img.onload();
    expect(t.loadingLine()).toBeNull();
  });

  it("removes the line, with no note, when every square in view is off the island", async () => {
    const t = setUp({ fetchMode: "empty" });
    await t.tiles(2);
    expect(t.loadingLine()).toBeNull();
    expect(t.note().hidden).toBe(true);
  });

  it("is replaced by the failure note, with its own outline, when pictures fail", async () => {
    const t = setUp({ fetchMode: "reject" });
    expect(t.loadingLine()).not.toBeNull();
    await t.tiles(3);
    expect(t.loadingLine()).toBeNull();
    expect(t.note().hidden).toBe(false);
    expect(
      t.w.document
        .getElementById("island-map")
        .classList.contains("tilesfailed"),
    ).toBe(true);
    const failure = t.polygons.find((p) => p.opts.pane === undefined);
    expect(failure).toBeDefined();
    expect(failure!.added).toBe(true);
    expect(failure!.opts).toMatchObject({ color: "#8a877e", fillOpacity: 1 });
  });
});

describe("one outline for both the page and the script (SYC-619 §8.4)", () => {
  let page = "";
  beforeAll(() => {
    process.env["TEAM_SESSION_KEYS"] =
      "vitest-mapload-key-0123456789abcdef-0123456789ab";
    page = renderCatMapPage({
      personName: "T",
      filters: {},
      colonies: [],
      cats: [],
      catCount: 0,
      sites: [],
      focus: null,
      view: { z: 13, x: 0, y: 0 } as never,
      now: new Date("2026-10-23T00:00:00Z"),
      scripted: true,
    } as CatMapOptions);
  });

  it("puts data-outline on #island-map equal to SYROS_OUTLINE", () => {
    const el = new JSDOM(page).window.document.getElementById("island-map");
    expect(el).not.toBeNull();
    expect(el!.getAttribute("data-outline")).toBe(
      JSON.stringify(SYROS_OUTLINE),
    );
  });

  it("SYROS_OUTLINE holds exactly the script's OUTLINE points", () => {
    const m = /var OUTLINE = (\[[\s\S]*?\]);\n/.exec(SRC);
    expect(m).not.toBeNull();
    const fromScript = JSON.parse(m![1]!.replace(/,\s*\]/g, "]"));
    expect(fromScript).toHaveLength(20);
    expect(SYROS_OUTLINE.map((p) => [...p])).toEqual(fromScript);
  });
});
