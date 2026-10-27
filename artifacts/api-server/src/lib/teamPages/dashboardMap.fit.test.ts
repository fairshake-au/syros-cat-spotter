import { describe, expect, it } from "vitest";
import { catMapRig, posCat } from "./__fixtures__/catMapRig";

// SYC-573 (spec §3.2): the island map opens fitted to the cats, ONCE, on the
// first positions answer, and only if there is no focused cat and the person
// hasn't moved the map. Never again (filters, typing). This runs the real
// page and scripts (map-core.js, dashboard-map.js) on the fake MapLibre,
// whose camera moves fire `movestart` the way MapLibre does, so the "was that
// move ours?" logic is what is tested. SYC-705: fit with padding, never
// closer than app zoom 17 (MapLibre 16).

const fits = (m: { calls: any[][] }) => m.calls.filter((c) => c[0] === "fitBounds");

describe("the island map fits to the cats once (SYC-573)", () => {
  it("starts on the island, then fits the first answer with padding and a zoom cap of app 17", async () => {
    const t = await catMapRig();
    expect(fits(t.map())).toHaveLength(0); // the island, from the page's data-map
    expect(t.map().options.zoom).toBe(11); // app 12
    await t.answer(0, [posCat(1, 37.44, 24.94), posCat(2, 37.46, 24.97)]);
    expect(fits(t.map())).toHaveLength(1);
    const [, box, o] = fits(t.map())[0]!;
    expect(box).toEqual([
      [24.94, 37.44],
      [24.97, 37.46],
    ]);
    expect(o).toEqual({ padding: 40, maxZoom: 16 });
  });

  it("caps a fit to one cat at app zoom 17", async () => {
    const t = await catMapRig();
    await t.answer(0, [posCat(1, 37.44, 24.94)]);
    expect(t.map().getZoom()).toBe(16);
  });

  it("fits even when the cats arrive before the map has drawn itself", async () => {
    const t = await catMapRig({ cats: [posCat(1, 37.44, 24.94), posCat(2, 37.46, 24.97)], noSettle: true });
    await t.settle();
    expect(fits(t.map())).toHaveLength(1);
  });

  it("never refits on a later answer (a filter change or typing)", async () => {
    const t = await catMapRig();
    await t.answer(0, [posCat(1, 37.44, 24.94)]);
    expect(fits(t.map())).toHaveLength(1);
    t.change();
    expect(t.asks).toHaveLength(2);
    await t.answer(1, [posCat(3, 37.5, 25.0)]);
    expect(fits(t.map())).toHaveLength(1);
  });

  it("does not fit when a cat is in focus", async () => {
    const t = await catMapRig({ page: { focus: { id: 99, name: "Mimi", points: [] } } });
    await t.answer(0, [posCat(1, 37.44, 24.94)]);
    expect(fits(t.map())).toHaveLength(0);
  });

  it("does not fit after the person has moved the map", async () => {
    const t = await catMapRig();
    t.map().fire("movestart"); // a drag or zoom: not one of the script's own moves
    await t.answer(0, [posCat(1, 37.44, 24.94)]);
    expect(fits(t.map())).toHaveLength(0);
  });

  it("does not fit after the map's own + button", async () => {
    const t = await catMapRig();
    (t.document.querySelector(".mapctl button") as HTMLButtonElement).click();
    await t.answer(0, [posCat(1, 37.44, 24.94)]);
    expect(fits(t.map())).toHaveLength(0);
  });

  it("does not fit after a Go to press", async () => {
    const t = await catMapRig();
    t.document.querySelector("#mapgoto button[data-area]").click();
    expect(t.map().calls.filter((c) => c[0] === "easeTo")).toHaveLength(1);
    await t.answer(0, [posCat(1, 37.44, 24.94)]);
    expect(fits(t.map())).toHaveLength(0);
  });

  it("stays on the island when there are no cats, and does not fit later either", async () => {
    const t = await catMapRig();
    await t.answer(0, []);
    expect(fits(t.map())).toHaveLength(0);
    t.change();
    await t.answer(1, [posCat(1, 37.44, 24.94)]);
    expect(fits(t.map())).toHaveLength(0);
  });
});
