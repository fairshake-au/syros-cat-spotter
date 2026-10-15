// SYC-209 PR 3.1: the team map's browser check (spec test 17's layout half,
// test 20). For each engine (Chromium, WebKit = Safari's engine, Firefox)
// and each width (320, 360, 375, 390 px phones, 1280 px desktop):
//   - exactly one picture set is shown, and it is the band for that width;
//   - every shown picture's displayed size equals the size in its form;
//   - every shown picture starts on a whole pixel (top and left);
//   - the page has no sideways scroll;
//   - a real tap (touch on phones, mouse on desktop) at a known point on a
//     picture is read back by the server at that point, within 1 px.
// Env: BASE (the server), COOKIE (name=value of a team session), OUT (a
// folder for screenshots, or empty). Dashboard POSTs must come from the
// dashboard's own Origin, and browsers send "Origin: null" from these pages
// (SYC-330), so BASE is a local proxy that sets it (proxy.mjs); the Origin
// each browser itself sent is recorded.
import { chromium, webkit, firefox } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:8131";
const [CNAME, ...rest] = (process.env.COOKIE ?? "").split("=");
const CVALUE = rest.join("=");
const OUT = process.env.OUT ?? "";
const TEAM_ORIGIN = "https://team.catspotters.com";
const WIDTHS = [
  [320, 144],
  [360, 164],
  [375, 171],
  [390, 179],
  [1280, 256],
];
// [x, y, picture]: the island at zoom 12 doesn't fill all four pictures,
// so each tap goes on a picture where that point is on Syros (a tap off the
// island is refused, correctly, and would prove nothing here).
const TAPS = [
  [17, 23, 1], // top right
  [1, 1, 1], // one pixel in from the corner ((0, 0) is refused by design)
  ["last", "last", 0], // top left's bottom-right corner
];

const rows = [];
const sentOrigins = new Set();
for (const [ename, engine] of [
  ["Chromium", chromium],
  ["WebKit", webkit],
  ["Firefox", firefox],
]) {
  // CHROMIUM_PATH: a Chromium build already on the machine, when the one this
  // Playwright expects isn't downloaded.
  const browser = await engine.launch(
    ename === "Chromium" && process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  for (const [width, size] of WIDTHS) {
    const phone = width < 600;
    const opts = {
      viewport: { width, height: phone ? 800 : 900 },
      deviceScaleFactor: phone ? 3 : 2,
      hasTouch: phone,
    };
    if (phone && ename !== "Firefox") opts.isMobile = true;
    const ctx = await browser.newContext(opts);
    // The session cookie is __Host- (Secure). Chromium and Firefox take it for
    // localhost when set as https; WebKit only when set for the http address.
    const url = ename === "WebKit" ? BASE : BASE.replace(/^http:/, "https:");
    await ctx.addCookies([{ name: CNAME, value: CVALUE, url }]);
    await ctx.route("**/api/team/**", async (route) => {
      const req = route.request();
      if (req.method() === "POST") sentOrigins.add(`${ename}: ${req.headers()["origin"] ?? "(none)"}`);
      return route.continue();
    });
    const page = await ctx.newPage();
    const pictureStatus = new Map();
    page.on("response", (r) => {
      if (r.url().includes("/api/team/map-tiles/")) pictureStatus.set(new URL(r.url()).pathname, r.status());
    });

    const measure = () =>
      page.evaluate(() => {
        const shown = [...document.querySelectorAll(".mapband")].filter(
          (b) => getComputedStyle(b).display !== "none",
        );
        const pics = shown.flatMap((b) =>
          [...b.querySelectorAll("input[type=image]")].map((i) => {
            const r = i.getBoundingClientRect();
            const s = Number(i.form.querySelector("input[name=size]").value);
            return { l: r.left + scrollX, t: r.top + scrollY, w: r.width, h: r.height, s, src: i.getAttribute("src") };
          }),
        );
        return {
          bands: shown.map((b) => b.className),
          pics,
          sw: document.documentElement.scrollWidth,
          iw: innerWidth,
        };
      });

    for (const [tx, ty, which] of TAPS) {
      await page.goto(`${BASE}/api/team/map`);
      await page.waitForLoadState("networkidle");
      const m = await measure();
      const layoutOk =
        m.bands.length === 1 &&
        m.bands[0] === `mapband b${size}` &&
        m.pics.length === 4 &&
        m.pics.every((p) => p.w === size && p.h === size && p.s === size && Number.isInteger(p.l) && Number.isInteger(p.t)) &&
        m.sw <= m.iw &&
        m.pics.every((p) => pictureStatus.get(p.src) === 200);
      if (tx === 17) {
        rows.push([
          ename, width, "layout",
          `band ${m.bands.join(",")}; pictures ${m.pics.map((p) => `${p.w}x${p.h}@(${p.l},${p.t})${pictureStatus.get(p.src) === 200 ? "" : ` picture ${pictureStatus.get(p.src) ?? "not fetched"}`}`).join(" ")}; page ${m.sw}/${m.iw}`,
          layoutOk ? "PASS" : "FAIL",
        ]);
        if (OUT && ename === "Chromium") await page.screenshot({ path: `${OUT}/${width}-map.png`, fullPage: true });
      }
      const pic = m.pics[which];
      const px = tx === "last" ? size - 1 : tx;
      const py = ty === "last" ? size - 1 : ty;
      await page.evaluate(() => scrollTo(0, 0));
      const x = pic.l + px + 0.5;
      const y = pic.t + py + 0.5;
      const nav = page.waitForURL(`${BASE}/api/team/map/tap`, { timeout: 8000 }).then(() => true, () => false);
      if (phone) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      const went = await nav;
      const text = went ? await page.textContent("main") : "";
      const got = /Point (\d+), (\d+) on a (\d+) px picture/.exec(text ?? "");
      const ok = got && Math.abs(+got[1] - px) <= 1 && Math.abs(+got[2] - py) <= 1 && +got[3] === size;
      rows.push([ename, width, `tap (${px}, ${py}) on picture ${which + 1}`, got ? `server read (${got[1]}, ${got[2]}) on ${got[3]} px` : "nothing posted", ok ? "PASS" : "FAIL"]);
      if (OUT && ename === "Chromium" && tx === 17) {
        await page.waitForLoadState("networkidle");
        const after = await measure();
        rows.push([ename, width, "layout after tap",
          `band ${after.bands.join(",")}; whole px: ${after.pics.every((p) => Number.isInteger(p.l) && Number.isInteger(p.t))}; page ${after.sw}/${after.iw}`,
          after.bands.length === 1 && after.pics.every((p) => Number.isInteger(p.l) && Number.isInteger(p.t) && p.w === size) && after.sw <= after.iw ? "PASS" : "FAIL"]);
        await page.screenshot({ path: `${OUT}/${width}-after-tap.png`, fullPage: true });
      }
    }
    await ctx.close();
  }
  await browser.close();
}
for (const r of rows) console.log(r.join(" | "));
console.log("Origin the browser sent on the map's form posts:", [...sentOrigins].join("; "));
console.log("FAILS", rows.filter((r) => r.at(-1) !== "PASS").length, "of", rows.length);
