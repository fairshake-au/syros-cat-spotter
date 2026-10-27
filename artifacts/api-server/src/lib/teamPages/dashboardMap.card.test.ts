import { describe, expect, it } from "vitest";
import { SEED_AREAS } from "../areas/seedAreas";
import { catMapRig, posCat } from "./__fixtures__/catMapRig";

// SYC-396 PR 1.5 behaviours of the island map, kept on MapLibre (SYC-705
// Task 2b.6): the cat card and the group sheet (Escape and a map tap close
// them), the Feeding sites layer (off by default), a focused cat's numbered
// trail, and the Go to areas (from the named areas, by key, at app zoom 15).

const sheet = (t: { document: any }) => t.document.getElementById("catsheet");

describe("the cat card", () => {
  it("opens on a cat's tap with its name, mark, colony, place and links; Escape closes it", async () => {
    const t = await catMapRig({ page: { colonies: [{ id: 5, name: "Harbour" }] } });
    await t.answer(0, [{ ...posCat(1, 37.44, 24.94, "not_known"), colony: 5, photo: "/api/team/photos/abc/small" }]);
    const [pin] = t.markers("catdot");
    pin.click();
    expect(sheet(t).hidden).toBe(false);
    expect(sheet(t).querySelector(".sheetname").textContent).toBe("Cat ba");
    expect(sheet(t).textContent).toContain("Sterilised: not known yet");
    expect(sheet(t).textContent).toContain("Harbour");
    expect(sheet(t).textContent).toContain("Last seen today · Ermoupoli");
    expect(sheet(t).querySelector("img").getAttribute("src")).toBe("/api/team/photos/abc/small");
    const links = [...sheet(t).querySelectorAll("a")].map((a: any) => a.getAttribute("href"));
    expect(links).toContain("/api/team/cats/1");
    expect(links.some((h: string) => /focus=1$/.test(h))).toBe(true);
    t.document.dispatchEvent(new t.window.KeyboardEvent("keydown", { key: "Escape" }));
    expect(sheet(t).hidden).toBe(true);
  });

  it("a tap on the map itself closes it; the cat's own tap doesn't reach the map", async () => {
    const t = await catMapRig();
    await t.answer(0, [posCat(1, 37.44, 24.94)]);
    const mapClicks: unknown[] = [];
    t.document.getElementById("island-map").addEventListener("click", (e: unknown) => mapClicks.push(e));
    t.markers("catdot")[0].click();
    expect(mapClicks).toHaveLength(0);
    expect(sheet(t).hidden).toBe(false);
    t.map().fire("click");
    expect(sheet(t).hidden).toBe(true);
  });

  it("a focused cat's card opens by itself once the cats arrive", async () => {
    const t = await catMapRig({ page: { focus: { id: 1, name: "Cat ba", points: [] } } });
    await t.answer(0, [posCat(1, 37.44, 24.94)]);
    expect(sheet(t).hidden).toBe(false);
    expect(sheet(t).textContent).toContain("Hide where else it's been seen");
  });
});

describe("the Feeding sites layer", () => {
  const sites = [
    { id: 7, name: "Harbour wall", lat: 37.441, lng: 24.94, look: "public" as const },
    { id: 8, name: "Garden", lat: 37.45, lng: 24.95, look: "private" as const },
  ];

  it("is off by default, and its box puts the sites on and takes them off, without asking for the cats again", async () => {
    const t = await catMapRig({ page: { sites } });
    await t.answer(0, []);
    expect(t.markers("sitesq")).toHaveLength(0);
    const box = t.document.getElementById("layer-sites");
    box.checked = true;
    box.dispatchEvent(new t.window.Event("change", { bubbles: true }));
    const pins = t.markers("sitesq");
    expect(pins.map((p: any) => p.getAttribute("aria-label"))).toEqual([
      "Harbour wall, public feeding site",
      "Garden, private feeding site",
    ]);
    pins[0].click();
    expect(sheet(t).querySelector(".sheetname").textContent).toBe("Harbour wall");
    expect(sheet(t).querySelector("a.primary").getAttribute("href")).toBe("/api/team/sites/7");
    box.checked = false;
    box.dispatchEvent(new t.window.Event("change", { bubbles: true }));
    expect(t.markers("sitesq")).toHaveLength(0);
    expect(t.asks).toHaveLength(1);
  });

  it("the Cats box takes the cats off and puts them back", async () => {
    const t = await catMapRig();
    await t.answer(0, [posCat(1, 37.44, 24.94)]);
    const box = t.document.getElementById("layer-cats");
    box.checked = false;
    box.dispatchEvent(new t.window.Event("change", { bubbles: true }));
    expect(t.markers("catdot")).toHaveLength(0);
    box.checked = true;
    box.dispatchEvent(new t.window.Event("change", { bubbles: true }));
    expect(t.markers("catdot")).toHaveLength(1);
    expect(t.asks).toHaveLength(1);
  });
});

describe("a focused cat's trail", () => {
  const points = [
    { lat: 37.445, lng: 24.942, at: new Date("2026-09-01T10:00:00Z"), first: true },
    { lat: 37.4436, lng: 24.8889, at: new Date("2026-10-06T10:00:00Z"), first: false },
    { lat: 37.4447, lng: 24.9417, at: new Date("2026-10-24T10:00:00Z"), first: false },
  ];

  it("numbers each point in time order with its date, joins them with a dashed line, and fits them", async () => {
    const t = await catMapRig({ page: { focus: { id: 1, name: "Cat ba", points } } });
    const dots = t.markers("trailpt");
    expect(dots.map((d: any) => d.textContent)).toEqual(["1", "2", "3"]);
    expect(dots[0].title).toBe("1. First recorded 1 Sept 2026");
    expect(dots[2].title).toBe("3. Seen 24 Oct 2026");
    const layer = t.map().getLayer("cattrail") as any;
    expect(layer.type).toBe("line");
    expect(layer.paint["line-dasharray"]).toEqual([2, 2]);
    expect((t.map().getSource("cattrail") as any).data.geometry.coordinates).toEqual([
      [24.942, 37.445],
      [24.8889, 37.4436],
      [24.9417, 37.4447],
    ]);
    const fit = t.map().calls.filter((c) => c[0] === "fitBounds");
    expect(fit).toHaveLength(1);
    expect(fit[0]![2]).toEqual({ padding: 40, maxZoom: 16 });
  });

  it("one point: the map opens there, close", async () => {
    const t = await catMapRig({ page: { focus: { id: 1, name: "Cat ba", points: points.slice(0, 1) } } });
    const jump = t.map().calls.filter((c) => c[0] === "jumpTo");
    expect(jump.at(-1)![1]).toEqual({ center: [24.942, 37.445], zoom: 15 });
  });
});

describe("Go to an area", () => {
  it("has a button per named area, by key, and each opens that area at app zoom 15", async () => {
    const t = await catMapRig();
    const buttons = [...t.document.querySelectorAll("#mapgoto button")] as any[];
    expect(buttons.map((b) => b.getAttribute("data-area"))).toEqual(SEED_AREAS.map((a) => a.key));
    expect(buttons.map((b) => b.textContent)).toEqual(SEED_AREAS.map((a) => a.name));
    const kini = SEED_AREAS.find((a) => a.key === "kini")!;
    buttons.find((b) => b.getAttribute("data-area") === "kini").click();
    const ease = t.map().calls.filter((c) => c[0] === "easeTo").at(-1)!;
    expect(ease[1]).toEqual({ center: [kini.lng, kini.lat], zoom: 14 });
  });
});
