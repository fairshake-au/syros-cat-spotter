import { describe, expect, it } from "vitest";
import { catMapRig } from "./__fixtures__/catMapRig";

// SYC-619 §5.3: the map's "Find from a photo" link follows the filters the
// way the Grid link does, and carries only area, colony and colours. Run on
// the real page and scripts with the fake MapLibre (SYC-705).

async function setUp() {
  const t = await catMapRig({ page: { colonies: [{ id: 5, name: "Five" }] } });
  const find = () => t.document.querySelector(".viewrow .findentrylink").getAttribute("href");
  const box = (name: string, v: string) => t.document.querySelector(`#catfilters input[name="${name}"][value="${v}"]`);
  return { t, find, box };
}

describe("the map's photo link follows the filters", () => {
  it("carries colours, area and colony, and nothing else", async () => {
    const { t, find, box } = await setUp();
    expect(find()).toBe("/api/team/cats/find");
    t.change(() => {
      box("colours", "ginger").checked = true;
      box("sterilised", "not_known").checked = true;
      t.document.querySelector('select[name="area"]').value = "ermoupoli";
      t.document.querySelector('select[name="colony"]').value = "5";
      t.document.querySelector('input[name="q"]').value = "Mimi";
    });
    expect(find()).toBe("/api/team/cats/find?colours=ginger&area=ermoupoli&colony=5");
  });

  it("goes back to the bare address when the filters are cleared", async () => {
    const { t, find, box } = await setUp();
    t.change(() => (box("colours", "black").checked = true));
    expect(find()).toBe("/api/team/cats/find?colours=black");
    t.change(() => (box("colours", "black").checked = false));
    expect(find()).toBe("/api/team/cats/find");
  });
});
