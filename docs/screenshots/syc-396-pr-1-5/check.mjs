// Browser check for SYC-396 PR 1.5: the island Map (/api/team/cats?view=map).
//
// Against the BUILT server (dist/index.mjs) on a scratch database seeded by
// seed.mts, with standin-tiles.mjs loaded into the server so it never reaches
// OpenStreetMap. Every request the browser makes to anything but the local
// server is blocked (and recorded). In Chromium, WebKit and Firefox, at 320,
// 360, 375, 390 and 1280 px:
//   - the map comes up from our own scripts, with no console errors and no
//     security-policy violations, and nothing scrolls sideways;
//   - dots show on land and on sea: the light ring and dark outline are there,
//     over a land-coloured and a sea-coloured background;
//   - a tap on a cat opens its card (a sheet at the bottom on a phone);
//   - a group zooms in when tapped; filters apply with no page load;
//   - map squares are fetched by token only, and no address holds a position.
// Once per engine (1280 px): Feeding sites layer, a cat's trail (?focus=),
// pictures failing, Leaflet failing to load, and the page with JavaScript off.
//
// Env: BASE (http://localhost:<port>), COOKIE (name=value), MAVROS (the trail
// cat's id), OUT (screenshot folder), PLAYWRIGHT_CORE (playwright-core's
// index.mjs). Prints one JSON report; exits 1 if any check fails.
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../../../artifacts/api-server/package.json"));
const sharp = require("sharp");
const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href);
const { BASE, OUT } = process.env;
const MAVROS = Number(process.env.MAVROS);
const [cookieName, ...rest] = process.env.COOKIE.trim().split("=");
const cookieValue = rest.join("=");

const WIDTHS = [320, 360, 375, 390, 1280];

const report = [];
let failed = 0;
function check(engine, width, what, ok, detail) {
  report.push({ engine, width, what, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) });
  if (!ok) failed++;
}

/** A position written into an address: two numbers like 37.4… and 24.9… */
const POSITION_IN_URL = /3[67]\.\d{2,}|2[45]\.\d{2,}|lat=|lng=/i;

async function context(browser, engine, width, extra = {}) {
  const phone = width < 600;
  const opts = { viewport: { width, height: phone ? 760 : 900 }, deviceScaleFactor: phone ? 2 : 1, hasTouch: phone, ...extra };
  if (phone && engine !== "firefox") opts.isMobile = true;
  const ctx = await browser.newContext(opts);
  const seen = { outside: [], urls: [], posts: [] };
  await ctx.route(
    (url) => !url.href.startsWith(`${BASE}/`),
    (route) => {
      seen.outside.push(route.request().url());
      return route.abort();
    },
  );
  // Every request to the dashboard is recorded. BASE is origin-proxy.mjs,
  // which gives POSTs the dashboard's own Origin (a browser may not be told to).
  await ctx.route(`${BASE}/api/team/**`, (route) => {
    const req = route.request();
    seen.urls.push(req.url());
    if (req.method() === "POST") seen.posts.push({ url: req.url(), body: req.postData() ?? "" });
    return route.continue();
  });
  // Test harness only: keep a handle on the page's map (Leaflet keeps none),
  // so the check can move it. The page itself exposes nothing.
  await ctx.addInitScript(() => {
    let leaflet;
    Object.defineProperty(window, "L", {
      configurable: true,
      get: () => leaflet,
      set: (v) => {
        leaflet = v;
        if (v && v.Map && v.Map.addInitHook) v.Map.addInitHook(function () { window.__testMap = this; });
      },
    });
  });
  if (engine === "webkit") await ctx.addCookies([{ name: cookieName, value: cookieValue, url: BASE }]);
  else await ctx.addCookies([{ name: cookieName, value: cookieValue, url: BASE.replace("http:", "https:") }]);
  return { ctx, seen };
}

function watch(p) {
  const errors = [];
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  p.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

async function mapReady(p) {
  await p.waitForSelector("#island-map.leaflet-container", { timeout: 15000 });
  await p.waitForFunction(() => document.querySelectorAll("#island-map .catpinicon").length > 0, null, { timeout: 15000 });
  await p.waitForFunction(() => document.querySelectorAll("#island-map .leaflet-tile-loaded").length > 0, null, { timeout: 15000 });
  await p.waitForTimeout(300);
}

const tap = async (p, locator, phone) => {
  if (phone) await locator.tap();
  else await locator.click();
};

/** Pixels of a 44px box around an element: is there a white ring, a dark outline, and what's behind it? */
async function ringAround(p, handle) {
  await handle.scrollIntoViewIfNeeded();
  await p.waitForTimeout(300);
  const shot = await handle.screenshot();
  const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
  let white = 0, dark = 0;
  // What's behind the dot: the most common colour along the box's edge (one
  // pixel can land on the stand-in tiles' faint grid line).
  const edge = new Map();
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      if (x !== 0 && y !== 0 && x !== info.width - 1 && y !== info.height - 1) continue;
      const i = (y * info.width + x) * info.channels;
      const k = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      edge.set(k, (edge.get(k) ?? 0) + 1);
    }
  const corner = [...edge.entries()].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    if (r > 245 && g > 245 && b > 245) white++;
    // The 1px outline (#1d1d1b) is smoothed at 1x, so "dark" is any grey well below the dot's own teal.
    if (Math.max(r, g, b) < 75 && Math.abs(r - g) < 20 && Math.abs(g - b) < 20) dark++;
  }
  return { white, dark, corner };
}
const isSea = ([r, g, b]) => Math.abs(r - 0xaa) < 14 && Math.abs(g - 0xd3) < 14 && Math.abs(b - 0xdf) < 14;
const isLand = ([r, g, b]) => Math.abs(r - 0xf2) < 10 && Math.abs(g - 0xef) < 10 && Math.abs(b - 0xe9) < 10;

async function flyTo(p, lat, lng, z) {
  // Through the map's own controls would take many taps; this moves the view only.
  await p.evaluate(
    ([a, b, zz]) => {
      if (window.__testMap) window.__testMap.setView([a, b], zz, { animate: false });
    },
    [lat, lng, z],
  );
}

/**
 * The check signs in as one person and loads the map dozens of times, which
 * the real 300-squares-per-10-minutes limit rightly stops. So each run starts
 * that person's count afresh, on the scratch database only (RESET_LIMIT is a
 * command the runner gives; the check never knows the database's address).
 */
function freshLimit() {
  if (process.env.RESET_LIMIT) execSync(process.env.RESET_LIMIT, { stdio: "ignore" });
}

async function runWidth(engine, browser, width) {
  freshLimit();
  const phone = width < 600;
  const { ctx, seen } = await context(browser, engine, width);
  const p = await ctx.newPage();
  const errors = watch(p);
  let loads = 0;
  p.on("load", () => loads++);
  await p.goto(`${BASE}/api/team/cats?view=map`);
  try {
    await mapReady(p);
    check(engine, width, "the map comes up with cats and map pictures", true);
  } catch (err) {
    check(engine, width, "the map comes up with cats and map pictures", false, String(err).slice(0, 200));
    await ctx.close();
    return;
  }
  if (OUT) await p.screenshot({ path: path.join(OUT, `${engine}-${width}-1-map.png`), fullPage: false });

  const layout = await p.evaluate(() => ({
    sideways: document.documentElement.scrollWidth > window.innerWidth,
    fallbackShown: Boolean(document.querySelector(".mapfallback")),
    legend: Boolean(document.querySelector("#maplegend")),
    legendOpen: document.querySelector("#maplegend")?.open,
  }));
  check(engine, width, "nothing scrolls sideways", !layout.sideways);
  check(engine, width, "the button map stays in <noscript> when the script runs", !layout.fallbackShown);
  check(engine, width, "the key is there, folded on a phone and open on a computer", layout.legend && layout.legendOpen === !phone);

  // A group at the island view, tapped: it zooms in.
  const cluster = p.locator("#island-map .catcluster").first();
  check(engine, width, "nearby cats are grouped with a count when zoomed out", (await cluster.count()) > 0);
  if ((await cluster.count()) > 0) {
    const before = await p.evaluate(() => window.__testMap.getZoom());
    await tap(p, cluster, phone);
    await p.waitForTimeout(700);
    const after = await p.evaluate(() => window.__testMap.getZoom());
    check(engine, width, "tapping a group zooms in", after > before, { before, after });
  }

  // A dot on the sea (Thalassa) and one on land (Portokali), at zoom 16.
  for (const [name, lat, lng, behind] of [
    ["Thalassa", 37.444, 24.952, "sea"],
    ["Portokali", 37.4228, 24.8838, "land"],
  ]) {
    await flyTo(p, lat, lng, 16);
    await p.waitForTimeout(900);
    const marker = p.locator(`#island-map .leaflet-marker-icon[title^="${name}:"]`);
    if ((await marker.count()) !== 1) {
      check(engine, width, `${name}'s dot is on the map`, false, { count: await marker.count() });
      continue;
    }
    const ring = await ringAround(p, await marker.elementHandle());
    const bg = behind === "sea" ? isSea(ring.corner) : isLand(ring.corner);
    check(engine, width, `${name}'s dot shows on the ${behind}: a light ring and a dark outline`, ring.white > 20 && ring.dark >= 5 && bg, ring);
    if (name === "Portokali") {
      await tap(p, marker, phone);
      await p.waitForTimeout(300);
      const sheet = await p.evaluate(() => {
        const s = document.getElementById("catsheet");
        const r = s.getBoundingClientRect();
        const m = document.getElementById("island-map").getBoundingClientRect();
        return {
          hidden: s.hidden,
          text: s.textContent,
          open: Boolean(s.querySelector('a.primary[href^="/api/team/cats/"]')),
          trail: Boolean([...s.querySelectorAll("a")].find((a) => /where else/.test(a.textContent))),
          inView: r.left >= 0 && r.right <= window.innerWidth + 0.5,
          atBottom: Math.abs(r.bottom - (m.bottom - 8)) < 3,
          atTopLeft: Math.abs(r.top - (m.top + 8)) < 3 && Math.abs(r.left - (m.left + 8)) < 3,
        };
      });
      check(engine, width, "a tap opens the cat's card, with Open the cat and Where else it's been seen", !sheet.hidden && /Portokali/.test(sheet.text) && /Sterilised/.test(sheet.text) && sheet.open && sheet.trail, sheet.text.slice(0, 120));
      check(engine, width, phone ? "on a phone the card is a sheet at the bottom" : "on a computer the card sits top-left", sheet.inView && (phone ? sheet.atBottom : sheet.atTopLeft), sheet);
      if (OUT) await p.screenshot({ path: path.join(OUT, `${engine}-${width}-2-card.png`) });
      await tap(p, p.locator("#catsheet .sheetclose"), phone);
      check(engine, width, "the card closes", await p.evaluate(() => document.getElementById("catsheet").hidden));
    }
  }

  // Filters apply with no page load: only the sterilised cats.
  const loadsBefore = loads;
  const panel = p.locator("details.filters > summary");
  if (await panel.isVisible()) await tap(p, panel, phone);
  await tap(p, p.locator('label.choicechip:has(input[name="sterilised"][value="sterilised"])'), phone);
  await p.waitForTimeout(900);
  const filtered = await p.evaluate(() => ({
    url: location.search,
    count: document.getElementById("mapcount").textContent,
  }));
  check(engine, width, "a filter applies with no page load, and the address keeps it", loads === loadsBefore && /sterilised=sterilised/.test(filtered.url) && /view=map/.test(filtered.url) && /cats on the map/.test(filtered.count), { ...filtered, loads: loads - loadsBefore });

  // Addresses and bodies.
  check(engine, width, "nothing outside this server was asked for", seen.outside.length === 0, seen.outside.slice(0, 3));
  const squares = seen.urls.filter((u) => u.includes("/map-square/"));
  check(engine, width, "map squares are fetched by token only", squares.length > 0 && squares.every((u) => /\/api\/team\/map-square\/[A-Za-z0-9_-]{59}$/.test(u)), squares.slice(0, 2));
  check(engine, width, "no address holds a position", seen.urls.every((u) => !POSITION_IN_URL.test(decodeURIComponent(u))), seen.urls.filter((u) => POSITION_IN_URL.test(u)).slice(0, 3));
  const posBodies = seen.posts.filter((x) => x.url.endsWith("/api/team/cats/positions")).map((x) => x.body);
  check(engine, width, "the cats are asked for in the body, with no position in it", posBodies.length >= 2 && posBodies.every((b) => !/lat|lng/.test(b)), posBodies.slice(-1));
  const sqBodies = seen.posts.filter((x) => x.url.endsWith("/api/team/map-squares")).map((x) => JSON.parse(x.body));
  check(engine, width, "square tokens are asked for by square numbers, at most 64 at a time", sqBodies.length > 0 && sqBodies.every((b) => Object.keys(b).sort().join() === "xMax,xMin,yMax,yMin,z" && (b.xMax - b.xMin + 1) * (b.yMax - b.yMin + 1) <= 64), sqBodies.slice(0, 2));
  const csp = errors.filter((e) => /Content Security Policy|Content-Security-Policy|violates/i.test(e));
  check(engine, width, "no security-policy violations", csp.length === 0, csp);
  check(engine, width, "no console errors", errors.length === 0, errors.slice(0, 3));
  await ctx.close();
}

async function runOnce(engine, browser) {
  freshLimit();
  const width = 1280;
  // Feeding sites layer, and a cat's trail.
  {
    const { ctx } = await context(browser, engine, width);
    const p = await ctx.newPage();
    const errors = watch(p);
    await p.goto(`${BASE}/api/team/cats?view=map&focus=${MAVROS}`);
    await mapReady(p);
    await p.waitForTimeout(500);
    const trail = await p.evaluate(() => ({
      points: document.querySelectorAll("#island-map .trailpt").length,
      card: document.getElementById("catsheet").hidden ? "" : document.getElementById("catsheet").textContent,
    }));
    check(engine, width, "?focus= draws the cat's trail as numbered dots, and opens its card", trail.points === 3 && /Mavros/.test(trail.card) && /Hide where else/.test(trail.card), trail);
    if (OUT) await p.screenshot({ path: path.join(OUT, `${engine}-${width}-3-trail.png`) });
    await p.locator("#layer-sites").check();
    await p.waitForTimeout(300);
    const sites = await p.locator("#island-map .sitesq").count();
    check(engine, width, "the Feeding sites layer shows the two sites as squares", sites === 2, { sites });
    await p.locator("#layer-cats").uncheck();
    await p.waitForTimeout(200);
    check(engine, width, "the Cats layer can be switched off", (await p.locator("#island-map .catdot").count()) === 0);
    if (OUT) await p.screenshot({ path: path.join(OUT, `${engine}-${width}-4-sites-layer.png`) });
    check(engine, width, "no console errors (trail and layers)", errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }
  // Map pictures failing: the cats stay, over a plain outline, with the words.
  {
    const { ctx } = await context(browser, engine, width);
    await ctx.route(`${BASE}/api/team/map-square/**`, (route) => route.fulfill({ status: 503, body: "" }));
    const p = await ctx.newPage();
    await p.goto(`${BASE}/api/team/cats?view=map`);
    await p.waitForFunction(() => document.querySelectorAll("#island-map .catpinicon").length > 0, null, { timeout: 15000 });
    await p.waitForTimeout(1500);
    const state = await p.evaluate(() => ({
      note: !document.getElementById("mapnote").hidden ? document.getElementById("mapnote").textContent : "",
      outline: document.querySelectorAll("#island-map path.leaflet-interactive, #island-map svg path").length,
      cats: document.querySelectorAll("#island-map .catpinicon").length,
    }));
    check(engine, width, "pictures failing: the words, a plain island outline, and the cats still shown", state.note === "Map pictures aren't loading. The cats are still shown." && state.outline > 0 && state.cats > 0, state);
    if (OUT) await p.screenshot({ path: path.join(OUT, `${engine}-${width}-5-pictures-failing.png`) });
    await ctx.close();
  }
  // Leaflet fails to load: the button map comes back.
  {
    const { ctx } = await context(browser, engine, width);
    await ctx.route(`${BASE}/api/team/assets/leaflet.*.js`, (route) => route.fulfill({ status: 404, body: "" }));
    const p = await ctx.newPage();
    await p.goto(`${BASE}/api/team/cats?view=map`);
    await p.waitForTimeout(800);
    const state = await p.evaluate(() => ({
      fallback: Boolean(document.querySelector(".mapfallback .mapband")),
      pins: document.querySelectorAll(".mapfallback .pin.catpin").length,
      scriptedHidden: document.getElementById("mapscripted").hidden,
    }));
    check(engine, width, "if Leaflet fails to load, the button map comes back with the cats", state.fallback && state.pins > 0 && state.scriptedHidden, state);
    await ctx.close();
  }
  // JavaScript off: the button map with the cats, and its buttons work.
  for (const w of [390, 1280]) {
    const phone = w < 600;
    const { ctx } = await context(browser, engine, w, { javaScriptEnabled: false });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/api/team/cats?view=map`);
    const before = await p.evaluate(() => ({
      fallback: Boolean(document.querySelector(".mapfallback")) && getComputedStyle(document.querySelector(".mapfallback")).display !== "none",
      pins: document.querySelectorAll(".mapfallback .pin.catpin").length,
      scripted: !document.getElementById("mapscripted") || document.getElementById("mapscripted").hidden,
      sideways: document.documentElement.scrollWidth > window.innerWidth,
    }));
    check(engine, w, "JavaScript off: the button map shows the cats, and the draggable map's box stays hidden", before.fallback && before.pins > 0 && before.scripted && !before.sideways, before);
    if (OUT) await p.screenshot({ path: path.join(OUT, `${engine}-${w}-6-nojs.png`), fullPage: true });
    await Promise.all([
      p.waitForURL(`${BASE}/api/team/cats/map`, { timeout: 15000 }),
      tap(p, p.locator('.mapfallback button[name="area"][value="ermoupoli"]'), phone),
    ]);
    await p.waitForLoadState("load");
    const after = await p.evaluate(() => ({
      url: location.pathname + location.search,
      zoom: document.querySelector('.mapfallback input[name="vz"]')?.value,
      pins: document.querySelectorAll(".mapfallback .pin.catpin").length,
    }));
    check(engine, w, "JavaScript off: Go to Ermoupoli works, with nothing in the address", after.url === "/api/team/cats/map" && after.zoom === "15" && after.pins > 0, after);
    if (OUT) await p.screenshot({ path: path.join(OUT, `${engine}-${w}-7-nojs-ermoupoli.png`), fullPage: true });
    await ctx.close();
  }
}

for (const engine of ["chromium", "webkit", "firefox"]) {
  let browser;
  try {
    browser = await pw[engine].launch();
  } catch (err) {
    report.push({ engine, skipped: `not installed: ${String(err.message).split("\n")[0]}` });
    failed++;
    continue;
  }
  try {
    for (const w of WIDTHS) await runWidth(engine, browser, w);
    await runOnce(engine, browser);
  } catch (err) {
    check(engine, 0, "ran to the end", false, String(err).slice(0, 300));
  } finally {
    await browser.close();
  }
}

const passed = report.filter((r) => r.ok).length;
console.log(JSON.stringify({ passed, failed, checks: report }, null, 2));
process.exit(failed ? 1 : 0);
