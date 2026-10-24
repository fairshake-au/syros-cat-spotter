import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// SYC-619 §5.3: the map's "Find from a photo" link follows the filters the
// way the Grid link does, and carries only area, colony and colours.

const SRC = readFileSync(join(__dirname, "../../../assets/dashboard-map.js"), "utf8");

function chain(): any {
  return new Proxy(function () {}, {
    get: (_t, p) => (p === "then" ? undefined : p === Symbol.toPrimitive ? () => 0 : chain()),
    apply: () => chain(),
    construct: () => chain(),
  });
}

function setUp() {
  const dom = new JSDOM(
    "<!doctype html><html><body>" +
      '<form id="catfilters" action="/api/team/cats"><input type="hidden" name="view" value="map">' +
      '<input type="search" name="q" value="">' +
      '<input type="checkbox" name="colours" value="ginger"><input type="checkbox" name="colours" value="black">' +
      '<input type="checkbox" name="sterilised" value="not_known">' +
      '<select name="area"><option value="">Anywhere</option><option value="ermoupoli">Ermoupoli</option></select>' +
      '<select name="colony"><option value="">Any</option><option value="5">Five</option></select></form>' +
      '<div class="viewrow"><nav class="viewswitch"><a id="view-grid" href="/api/team/cats">Grid</a><a id="view-map" href="/api/team/cats?view=map">Map</a></nav>' +
      '<a class="findentrylink" href="/api/team/cats/find">Find from a photo</a></div>' +
      '<div id="mapcount"></div><div id="mapscripted"><div id="island-map" data-areas="[]"></div></div></body></html>',
    { url: "https://team.example/api/team/cats?view=map", runScripts: "outside-only" },
  );
  const w = dom.window as any;
  w.L = chain();
  w.fetch = () => new Promise(() => {});
  w.eval(SRC);
  const change = (fn: () => void) => {
    fn();
    w.document.getElementById("catfilters").dispatchEvent(new w.Event("change", { bubbles: true }));
  };
  const find = () => w.document.querySelector(".viewrow .findentrylink").getAttribute("href");
  const box = (v: string) => w.document.querySelector(`input[value="${v}"]`);
  return { w, change, find, box };
}

describe("the map's photo link follows the filters", () => {
  it("carries colours, area and colony, and nothing else", () => {
    const t = setUp();
    expect(t.find()).toBe("/api/team/cats/find");
    t.change(() => {
      t.box("ginger").checked = true;
      t.box("not_known").checked = true;
      t.w.document.querySelector('select[name="area"]').value = "ermoupoli";
      t.w.document.querySelector('select[name="colony"]').value = "5";
      t.w.document.querySelector('input[name="q"]').value = "Mimi";
    });
    expect(t.find()).toBe("/api/team/cats/find?colours=ginger&area=ermoupoli&colony=5");
  });

  it("goes back to the bare address when the filters are cleared", () => {
    const t = setUp();
    t.change(() => (t.box("black").checked = true));
    expect(t.find()).toBe("/api/team/cats/find?colours=black");
    t.change(() => (t.box("black").checked = false));
    expect(t.find()).toBe("/api/team/cats/find");
  });
});
