// Real-browser check for SYC-705 Phase 2 (Task 2b.9): the team dashboard's
// MapLibre maps, from the BUILT server (dist/index.mjs) on a scratch database
// seeded by seed.mts. Chromium (software WebGL) and WebKit (standing in for
// Safari), at 390 px (phone, touch) and 1280 px.
//
// Every request the browser makes to anything but the local origin is blocked
// and recorded (there should be none). The SERVER fetches the map files from
// tiles.catspotters.com on its first request; that is not the browser's.
//
// Env: BASE (http://localhost:<proxy port>, origin-proxy.mjs), SEED (path to
// seed.mts's JSON output), OUT (screenshot folder), PLAYWRIGHT_CORE
// (playwright-core's index.mjs), DBNAME (the scratch database's name).
// Prints a JSON report and writes check-result.json; exits 1 on any failure.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../../../../artifacts/api-server/package.json"));
const sharp = require("sharp");
const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href);
const { BASE, OUT, DBNAME } = process.env;
const seed = JSON.parse(fs.readFileSync(process.env.SEED, "utf8"));
const ENGINES = (process.env.ENGINES ?? "chromium,webkit").split(",");
const WIDTHS = (process.env.WIDTHS ?? "390,1280").split(",").map(Number);

const report = [];
let failed = 0;
const extra = { coldLoads: [], mapFile: [], maplibreLoads: [] };
function check(engine, width, what, ok, detail) {
  report.push({ engine, width, what, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) });
  if (!ok) failed++;
  console.error(`${ok ? "ok  " : "FAIL"} ${engine}/${width} ${what}${detail === undefined ? "" : " :: " + JSON.stringify(detail)}`);
  fs.writeFileSync(path.join(OUT, "check-progress.json"), JSON.stringify(report, null, 1));
}

/** A position written into an address: two numbers like 37.4… and 24.9… */
const POSITION_IN_URL = /3[67]\.\d{2,}|2[45]\.\d{2,}|lat=|lng=/i;
const LAND = [0xf2, 0xef, 0xe9];
const SEA = [0xaa, 0xd3, 0xdf];
const near = (px, c, tol) => Math.abs(px[0] - c[0]) <= tol && Math.abs(px[1] - c[1]) <= tol && Math.abs(px[2] - c[2]) <= tol;

const psql = (sql) =>
  execFileSync("psql", ["-h", "/tmp", "-U", "samuelporter", "-d", DBNAME, "-Atc", sql], { encoding: "utf8" }).trim();

function metres(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

let counter = 0;
/** Letters only: a counter spelt in letters (SYC-709). */
const letters = () => {
  let n = ++counter + 15;
  let s = "";
  do {
    s = "bcdfghjkmpqrvwxz"[n % 16] + s;
    n = Math.floor(n / 16);
  } while (n > 0);
  return s;
};

async function newSession(browser, engine, width, who = "en", extraOpts = {}) {
  const phone = width < 600;
  const opts = { viewport: { width, height: phone ? 760 : 900 }, deviceScaleFactor: phone ? 2 : 1, hasTouch: phone, ...extraOpts };
  if (phone) opts.isMobile = true;
  const ctx = await browser.newContext(opts);
  const seen = { outside: [], urls: [], console: [], csp: [], errors: [], mapRequests: [] };
  await ctx.route(
    (url) => !url.href.startsWith(`${BASE}/`),
    (route) => {
      seen.outside.push(route.request().url());
      return route.abort();
    },
  );
  ctx.on("request", (req) => {
    seen.urls.push(req.url());
  });
  ctx.on("response", async (res) => {
    const u = res.url();
    if (/\/syros\.pmtiles$/.test(u)) {
      const req = res.request();
      let headers = {};
      try {
        headers = await req.allHeaders();
      } catch {}
      let bytes = null;
      try {
        bytes = (await res.body()).length;
      } catch {}
      seen.mapRequests.push({ url: u, status: res.status(), range: headers["range"] ?? null, bytes, contentLength: res.headers()["content-length"] ?? null, encoding: res.headers()["content-encoding"] ?? null });
    }
  });
  await ctx.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.log("CSPVIOLATION " + e.violatedDirective + " " + e.blockedURI);
    });
  });
  const cookie = who === "el" ? seed.cookieEl : seed.cookie;
  const [cookieName, ...rest] = cookie.split("=");
  const value = rest.join("=");
  if (engine === "webkit") await ctx.addCookies([{ name: cookieName, value, url: BASE }]);
  else await ctx.addCookies([{ name: cookieName, value, url: BASE.replace("http:", "https:") }]);
  const watch = (p) => {
    p.on("console", (m) => {
      const t = m.text();
      if (/Content Security Policy|CSPVIOLATION/i.test(t)) seen.csp.push(t.slice(0, 300));
      else if (m.type() === "error") seen.errors.push(`console error at ${p.url().replace(BASE, "")}: ${t.slice(0, 300)}`);
    });
    p.on("pageerror", (e) => seen.errors.push("pageerror at " + p.url().replace(BASE, "") + ": " + String(e).slice(0, 300) + " | " + String(e.stack ?? "").split("\n").slice(1, 4).join(" <- ").slice(0, 300)));
  };
  ctx.on("page", watch);
  return { ctx, seen, phone };
}

const SHOT = (engine, width, n, name) => path.join(OUT, `${engine}-${width}-${n}-${name}.png`);

/** Waits for .map.maplive; returns milliseconds from `t0`. */
async function live(p, t0, sel = ".map.maplive") {
  await p.waitForSelector(sel, { timeout: 60000 });
  return Date.now() - t0;
}

/** Screenshots the first canvas and counts distinct colours and land/sea pixels. */
async function canvasStats(p) {
  await p.waitForTimeout(1200);
  const canvas = p.locator(".maplibregl-canvas").first();
  await canvas.scrollIntoViewIfNeeded();
  const shot = await canvas.screenshot();
  const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
  const colours = new Set();
  let land = 0;
  let sea = 0;
  const total = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    const px = [data[i], data[i + 1], data[i + 2]];
    colours.add(px.join(","));
    if (near(px, LAND, 12)) land++;
    else if (near(px, SEA, 12)) sea++;
  }
  return { distinct: colours.size, landPx: land, seaPx: sea, total, w: info.width, h: info.height };
}
const drew = (s) => s.distinct > 1 && s.landPx > 0;

async function shot(p, file, { full = false } = {}) {
  await p.screenshot({ path: file, fullPage: full });
}
/** Scrolls the map box to the top of the view, then takes a viewport screenshot. */
async function shotMap(p, file, sel = ".map[data-map]") {
  const box = p.locator(sel).first();
  await box.scrollIntoViewIfNeeded();
  await p.evaluate((s) => {
    const el = document.querySelector(s);
    if (el) window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 12);
  }, sel);
  await p.waitForTimeout(300);
  await p.screenshot({ path: file });
}

async function mapChecks(p, engine, width, what, t0, file, sel) {
  const ms = await live(p, t0);
  const s = await canvasStats(p);
  await shotMap(p, file, sel);
  check(engine, width, `${what}: map draws (.maplive, canvas not blank)`, drew(s), { ...s, msToLive: ms });
  return { ms, s };
}

async function runSession(engine, width, browser, first) {
  const { ctx, seen, phone } = await newSession(browser, engine, width);
  const p = await ctx.newPage();
  const sh = (n, name) => SHOT(engine, width, n, name);
  const tap = (loc) => (phone ? loc.tap() : loc.click());

  // ── 1. Cats map ──────────────────────────────────────────────────────────
  {
    const t0 = Date.now();
    await p.goto(`${BASE}/api/team/cats?view=map`);
    const ms = await live(p, t0);
    extra.coldLoads.push({ engine, width, page: "cats map, fresh context", msToLive: ms, first, mapRequests: [...seen.mapRequests] });
    const s = await canvasStats(p);
    await shotMap(p, sh(1, "cats-map"), "#island-map");
    check(engine, width, "1 cats map: draws (.maplive, canvas not blank)", drew(s), { ...s, msToLive: ms });
    const sideways = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(engine, width, "1 cats map: nothing scrolls sideways", sideways <= 0, { overflowPx: sideways });
    await p.waitForTimeout(800);

    const markers = await p.$$eval("#island-map button.catpinicon", (els) =>
      els.map((e) => ({ label: e.getAttribute("aria-label"), r: e.getBoundingClientRect().toJSON() })),
    );
    check(engine, width, "1 cats map: cat markers present", markers.length >= 6, { count: markers.length });
    const group = markers.map((m) => ({ ...m, n: Number((/^(\d+) cats here/.exec(m.label ?? "") ?? [])[1] ?? 0) })).filter((m) => m.n >= 12);
    check(engine, width, "1 cats map: group count in Ermoupoli at island view", group.length >= 1, group.map((g) => g.label));
    const bad = markers.filter((m) => Math.abs(m.r.width - 44) > 0.6 || Math.abs(m.r.height - 44) > 0.6);
    check(engine, width, "1 cats map: markers' bounding boxes are 44x44", markers.length > 0 && bad.length === 0, bad.length ? bad.slice(0, 4) : { checked: markers.length });

    // Tap a cat: its card opens, then Escape closes it.
    const portokali = p.locator('#island-map button.catpinicon[aria-label^="Portokali"]').first();
    await portokali.scrollIntoViewIfNeeded();
    await tap(portokali);
    await p.waitForTimeout(500);
    const open = await p.evaluate(() => {
      const s = document.getElementById("catsheet");
      return s && !s.hidden ? { text: s.innerText.slice(0, 200), links: [...s.querySelectorAll("a")].map((a) => a.textContent) } : null;
    });
    await p.screenshot({ path: sh(2, "cat-card") });
    check(engine, width, "1 cats map: tapping a cat opens its card", Boolean(open && /Portokali/.test(open.text) && open.links.includes("Open the cat")), open);
    await p.keyboard.press("Escape");
    await p.waitForTimeout(300);
    const closed = await p.evaluate(() => document.getElementById("catsheet")?.hidden === true);
    check(engine, width, "1 cats map: card closes with Escape", closed);
  }

  // ── 2. Trail ─────────────────────────────────────────────────────────────
  {
    const t0 = Date.now();
    await p.goto(`${BASE}/api/team/cats?view=map&focus=${seed.mavros}`);
    const ms = await live(p, t0);
    const s = await canvasStats(p);
    await p.waitForTimeout(800);
    const trail = await p.$$eval("#island-map .trailpt", (els) => els.map((e) => e.textContent));
    await shotMap(p, sh(3, "trail"), "#island-map");
    check(engine, width, "2 focus trail: map draws and numbered trail markers present", drew(s) && trail.length >= 3, { numbers: trail, ...s, msToLive: ms });
  }

  // ── 3. Site pages ────────────────────────────────────────────────────────
  for (const [id, label, approx] of [[seed.publicSite, "public site", false], [seed.approxSite, "approximate site", true]]) {
    const t0 = Date.now();
    await p.goto(`${BASE}/api/team/sites/${id}`);
    const { ms, s } = await mapChecks(p, engine, width, `3 ${label}`, t0, sh(4, approx ? "site-approx" : "site-public"), ".map[data-map]");
    const pins = await p.$$eval(".map .maplibregl-marker.pin", (els) => els.map((e) => e.className.replace(/maplibregl-\S+/g, "").trim()));
    const note = await p.evaluate(() => /Position approximate/.test(document.body.innerText));
    check(engine, width, `3 ${label}: site marker present`, pins.some((c) => /site-/.test(c)), pins);
    check(engine, width, `3 ${label}: "Position approximate" note ${approx ? "shows" : "absent"}`, note === approx, { note });
  }

  // ── 4. Add a site: drag the map, check the spot, save ───────────────────
  {
    const t0 = Date.now();
    await p.goto(`${BASE}/api/team/sites/new`);
    await mapChecks(p, engine, width, "4 add a site", t0, sh(5, "add-picker"), ".map[data-map]");
    const useVisible = await p.locator("button:has-text('Use this spot')").isVisible();
    check(engine, width, '4 add a site: "Use this spot" appears', useVisible);
    // Zoom in so the map can be dragged on both axes (at the start zoom the island fills the box sideways).
    const plus = p.locator('.mapctl button').first();
    await plus.click();
    await p.waitForTimeout(700);
    await plus.click();
    await p.waitForTimeout(900);
    const b = await p.locator(".map canvas").first().boundingBox();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const before = await p.evaluate(() => ({ lat: document.querySelector("#pickform [name=lat]")?.value, lng: document.querySelector("#pickform [name=lng]")?.value }));
    await p.mouse.move(cx, cy);
    await p.mouse.down();
    await p.mouse.move(cx - 90, cy + 50, { steps: 10 });
    await p.mouse.up();
    await p.waitForTimeout(1000);
    const pre = await p.evaluate(() => ({ lat: document.querySelector("#pickform [name=lat]")?.value, lng: document.querySelector("#pickform [name=lng]")?.value }));
    await p.screenshot({ path: sh(6, "add-dragged") });
    check(engine, width, "4 add a site: dragging the map moves the pin's position (hidden inputs change)", pre.lat && pre.lng && (pre.lat !== before.lat || pre.lng !== before.lng), { before, pre });
    await p.locator("button:has-text('Use this spot')").click();
    await p.waitForLoadState();
    const t1 = Date.now();
    const { s } = await mapChecks(p, engine, width, '4 "Check the spot" page', t1, sh(7, "add-check-the-spot"), ".map[data-map]");
    const h1 = await p.locator("h1").first().innerText();
    const mid = await p.evaluate(() => ({ lat: document.querySelector("#detailsform [name=lat]")?.value, lng: document.querySelector("#detailsform [name=lng]")?.value }));
    check(engine, width, '4 "Check the spot" page: title and carried position', h1 === "Check the spot" && metres([+pre.lat, +pre.lng], [+mid.lat, +mid.lng]) < 1, { h1, mid });
    const name = `Pin${letters()}`;
    await p.fill("#detailsform [name=name]", name);
    await Promise.all([p.waitForURL(/\/api\/team\/sites\/\d+(\?|$)/), p.locator("button:has-text('Save the site')").click()]);
    const siteId = Number(/sites\/(\d+)/.exec(p.url())[1]);
    const row = psql(`select lat, lng, position_approximate from feeding_sites where id = ${siteId} and name = '${name}'`).split("|");
    const d = row.length === 3 ? metres([+pre.lat, +pre.lng], [+row[0], +row[1]]) : NaN;
    check(engine, width, "4 add a site: saved position within 30 m of the pin at submit; not approximate", d < 30 && row[2] === "f", { name, siteId, pin: pre, saved: row, metresApart: d });
    const t2 = Date.now();
    await live(p, t2);
    await shotMap(p, sh(8, "add-saved-site"), ".map[data-map]");
  }

  // ── 6. Colony centre picker ──────────────────────────────────────────────
  {
    const t0 = Date.now();
    await p.goto(`${BASE}/api/team/colonies/${seed.colony}/centre`);
    await mapChecks(p, engine, width, "6 colony centre picker", t0, sh(9, "colony-centre"), ".map[data-map]");
    const st = await p.evaluate(() => {
      const vis = (e) => !!e && e.getBoundingClientRect().height > 0;
      return {
        centreMarkers: document.querySelectorAll(".map .maplibregl-marker").length,
        fixedPin: !!document.querySelector(".map .placepin"),
        revealedControls: [...document.querySelectorAll("[data-mapon]")].map((e) => vis(e)),
        hiddenInputs: [...document.querySelectorAll("#pickform input[type=hidden]")].map((i) => i.name + "=" + i.value).filter((x) => /^(lat|lng)=/.test(x)),
      };
    });
    check(engine, width, "6 colony centre picker: the fixed pin and the revealed Use-this-spot controls are there (place mode finished starting)", st.fixedPin && st.revealedControls.length > 0 && st.revealedControls.every(Boolean), st);
  }

  // ── 6b. Move picker for a site (also has a marker for the current spot) ──
  {
    const t0 = Date.now();
    await p.goto(`${BASE}/api/team/sites/${seed.publicSite}/move`);
    await mapChecks(p, engine, width, "6b move-a-site picker", t0, sh(9, "site-move-picker"), ".map[data-map]");
    const st = await p.evaluate(() => {
      const vis = (e) => !!e && e.getBoundingClientRect().height > 0;
      return {
        siteMarkers: document.querySelectorAll(".map .maplibregl-marker").length,
        fixedPin: !!document.querySelector(".map .placepin"),
        revealedControls: [...document.querySelectorAll("[data-mapon]")].map((e) => vis(e)),
      };
    });
    check(engine, width, "6b move-a-site picker: the fixed pin and the revealed controls are there", st.fixedPin && st.revealedControls.length > 0 && st.revealedControls.every(Boolean), st);
  }

  // ── 7. "Show on our map" from a sighting ─────────────────────────────────
  {
    await p.goto(`${BASE}/api/team/cats/${seed.mavros}`);
    await p.waitForLoadState();
    const form = p.locator('form[action^="/api/team/sites/map-at-sighting"] button').first();
    let found = (await form.count()) > 0;
    if (found && !(await form.isVisible())) {
      const tab = p.locator('a[href="#tab-history"]').first();
      if (await tab.count()) await tab.click().catch(() => {});
      await p.waitForTimeout(300);
      const summaries = p.locator("details > summary");
      const n = await summaries.count();
      for (let i = 0; i < n && !(await form.isVisible()); i++) {
        const sm = summaries.nth(i);
        if (await sm.isVisible()) await sm.click().catch(() => {});
      }
    }
    check(engine, width, '7 "Show on our map": button found on the cat page', found && (await form.isVisible()), { found });
    if (found && (await form.isVisible())) {
      const t0 = Date.now();
      await Promise.all([p.waitForURL(/map-at-sighting/), form.click()]);
      const { ms, s } = await mapChecks(p, engine, width, '7 "Show on our map"', t0, sh(10, "show-on-our-map"), ".map[data-map]");
      await p.waitForTimeout(500);
      const geo = await p.evaluate(() => {
        const box = document.querySelector(".map[data-map]").getBoundingClientRect();
        const sg = document.querySelector(".map .maplibregl-marker.sighting");
        if (!sg) return null;
        const r = sg.getBoundingClientRect();
        return { dx: r.x + r.width / 2 - (box.x + box.width / 2), dy: r.y + r.height / 2 - (box.y + box.height / 2) };
      });
      check(engine, width, '7 "Show on our map": the sighting marker is centred in the map', Boolean(geo && Math.abs(geo.dx) < 30 && Math.abs(geo.dy) < 30), geo);
    }
  }

  // ── 9. Language: the Greek-language person's map ─────────────────────────
  // (separate context below)

  // ── 8. Throughout (per session) ──────────────────────────────────────────
  const posUrls = seen.urls.filter((u) => POSITION_IN_URL.test(u));
  const nonLocal = seen.urls.filter((u) => !u.startsWith(`${BASE}/`));
  check(engine, width, "8 no console errors", seen.errors.length === 0, seen.errors.slice(0, 5));
  check(engine, width, "8 no CSP violations", seen.csp.length === 0, seen.csp.slice(0, 5));
  check(engine, width, "8 no request left localhost (none blocked, none recorded outside)", seen.outside.length === 0 && nonLocal.length === 0, { blocked: seen.outside, nonLocal: nonLocal.slice(0, 5), requests: seen.urls.length });
  check(engine, width, "8 no request URL matches the position pattern", posUrls.length === 0, posUrls.slice(0, 5));
  const mf = seen.mapRequests;
  check(
    engine,
    width,
    "8 syros.pmtiles: requested, no Range header, status 200",
    mf.length >= 1 && mf.every((m) => m.range === null && m.status === 200),
    mf,
  );
  extra.mapFile.push({ engine, width, requests: mf });
  await ctx.close();
}

/** Check 5: JavaScript off. */
async function runNoJs(engine, width, browser) {
  const { ctx, seen, phone } = await newSession(browser, engine, width, "en", { javaScriptEnabled: false });
  const p = await ctx.newPage();
  const sh = (n, name) => SHOT(engine, width, n, name);
  await p.goto(`${BASE}/api/team/sites/new`);
  await p.waitForLoadState();
  const view = await p.evaluate(() => {
    const vis = (e) => !!e && e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== "hidden";
    return {
      noMapLine: /Without the map, choose the area/.test(document.body.innerText),
      areaList: vis(document.querySelector("select[name=area]")),
      areas: document.querySelectorAll("select[name=area] option").length,
      useSpotVisible: vis(document.querySelector("button[data-mapon]")),
    };
  });
  await p.screenshot({ path: sh(11, "nojs-picker") });
  check(engine, width, "5 no JS: picker shows the no-map line and the area list (Use this spot hidden)", view.noMapLine && view.areaList && view.areas > 5 && !view.useSpotVisible, view);
  await p.selectOption("select[name=area]", "kini");
  await Promise.all([p.waitForLoadState(), p.locator("button:has-text('Use this area’s centre')").click()]);
  await p.waitForLoadState();
  const h1 = await p.locator("h1").first().innerText();
  await p.screenshot({ path: sh(12, "nojs-check-the-spot") });
  const approxHidden = await p.evaluate(() => document.querySelector("#detailsform [name=approximate]")?.value ?? null);
  check(engine, width, '5 no JS: area pick leads to "Check the spot" carrying approximate=1', h1 === "Check the spot" && approxHidden === "1", { h1, approxHidden });
  const name = `Area${letters()}`;
  await p.fill("#detailsform [name=name]", name);
  await Promise.all([p.waitForURL(/\/api\/team\/sites\/\d+(\?|$)/), p.locator("button:has-text('Save the site')").click()]);
  await p.waitForLoadState();
  const note = await p.evaluate(() => /Position approximate/.test(document.body.innerText));
  const siteId = Number(/sites\/(\d+)/.exec(p.url())[1]);
  const row = psql(`select position_approximate from feeding_sites where id = ${siteId} and name = '${name}'`);
  await p.screenshot({ path: sh(13, "nojs-site-approx") });
  check(engine, width, '5 no JS: saved site page says "Position approximate"', note && row === "t", { name, siteId, dbApproximate: row });
  const nonLocal = seen.urls.filter((u) => !u.startsWith(`${BASE}/`));
  check(engine, width, "5 no JS: nothing left localhost; no console errors or CSP violations", seen.outside.length === 0 && nonLocal.length === 0 && seen.errors.length === 0 && seen.csp.length === 0, { outside: seen.outside, errors: seen.errors, csp: seen.csp });
  check(engine, width, "5 no JS: no request URL matches the position pattern", seen.urls.every((u) => !POSITION_IN_URL.test(u)), seen.urls.filter((u) => POSITION_IN_URL.test(u)));
  await ctx.close();
}

/**
 * Check 9: language. Greek and French aren't live on the dashboard yet
 * (LIVE_LANGUAGES = ["en"], SYC-283), so no signed-in person can be served an
 * "el" page, a guardian included. The Greek style is therefore exercised by
 * calling the page's own CatMap.start with lang "el" on a second map box
 * made on the live cats-map page. Nothing in the app is changed.
 */
async function runGreek(engine, width, browser) {
  const { ctx, seen } = await newSession(browser, engine, width, "en");
  const p = await ctx.newPage();
  await p.goto(`${BASE}/api/team/cats?view=map`);
  await live(p, Date.now());
  const started = await p.evaluate(async () => {
    const src = document.getElementById("island-map");
    const d = document.createElement("div");
    d.id = "greekmap";
    d.className = "map";
    for (const a of ["data-maplibre", "data-worker", "data-words"]) d.setAttribute(a, src.getAttribute(a));
    d.style.cssText = "position:relative;width:100%;height:440px;margin:12px 0";
    src.parentElement.insertBefore(d, src);
    try {
      await window.CatMap.start(d, { lang: "el", centre: [37.4447, 24.9417], zoom: 14, rotate: false });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
  await p.waitForSelector("#greekmap.maplive", { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(2500);
  const canvas = p.locator("#greekmap .maplibregl-canvas").first();
  let s = null;
  if (await canvas.count()) {
    await canvas.scrollIntoViewIfNeeded();
    const { data, info } = await sharp(await canvas.screenshot()).raw().toBuffer({ resolveWithObject: true });
    const colours = new Set();
    let land = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      colours.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      if (near([data[i], data[i + 1], data[i + 2]], LAND, 12)) land++;
    }
    s = { distinct: colours.size, landPx: land };
  }
  await p.evaluate(() => {
    const el = document.getElementById("greekmap");
    if (el) window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 12);
  });
  await p.waitForTimeout(300);
  await p.screenshot({ path: SHOT(engine, width, 14, "map-greek-labels") });
  const styleReq = seen.urls.filter((u) => /style-(en|el)\.json/.test(u));
  check(engine, width, "9 Greek style: map made with lang el draws, style-el.json requested", started.ok && Boolean(s && s.distinct > 1 && s.landPx > 0) && styleReq.some((u) => /style-el\.json/.test(u)), { started, styleReq, ...s });
  check(engine, width, "9 Greek style: no console errors or CSP violations", seen.errors.length === 0 && seen.csp.length === 0, { errors: seen.errors, csp: seen.csp });
  check(engine, width, "9 Greek style: nothing left localhost", seen.outside.length === 0, seen.outside);
  await ctx.close();
}

const launchers = { chromium: pw.chromium, webkit: pw.webkit };
let first = true;
for (const engine of ENGINES) {
  const opts = engine === "chromium" ? { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } : {};
  const browser = await launchers[engine].launch(opts);
  extra.versions = { ...(extra.versions ?? {}), [engine]: browser.version() };
  for (const width of WIDTHS) {
    for (const [name, fn] of [["main", () => runSession(engine, width, browser, first)], ["nojs", () => runNoJs(engine, width, browser)], ["greek", () => runGreek(engine, width, browser)]]) {
      try {
        await fn();
      } catch (e) {
        check(engine, width, `${name} run aborted`, false, String(e.stack ?? e).slice(0, 800));
      }
      first = false;
    }
  }
  await browser.close();
}

const summary = { total: report.length, passed: report.length - failed, failed, ...extra };
fs.writeFileSync(path.join(OUT, "check-result.json"), JSON.stringify({ summary, checks: report }, null, 1));
console.log(JSON.stringify(summary, null, 1));
process.exit(failed ? 1 : 0);
