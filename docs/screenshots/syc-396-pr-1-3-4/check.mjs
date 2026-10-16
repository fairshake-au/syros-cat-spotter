// Browser check for SYC-396 PR 1.3.4: the Cats grid's filters apply as you
// tap, and the page still works with JavaScript off.
//
// Against a real server (the built dist/index.mjs) on a scratch database
// seeded by seed.mts, signed in with the team session cookie it prints.
// Env: BASE (http://localhost:<port>), COOKIE (name=value), OUT (folder for
// the screenshots), PLAYWRIGHT_CORE (path to playwright-core's index.mjs).
// Prints one JSON report; exits 1 if any check fails.
import { pathToFileURL } from "node:url";
const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href);
const { BASE, OUT } = process.env;
const [cookieName, ...rest] = process.env.COOKIE.trim().split("=");
const cookieValue = rest.join("=");

const report = [];
let failed = 0;
function check(engine, what, ok, detail) {
  report.push({ engine, what, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) });
  if (!ok) failed++;
}

async function context(browser, opts, engine) {
  const ctx = await browser.newContext(opts);
  // Nothing leaves this machine: a refused sign-in would otherwise follow the
  // 401 page's refresh to the real sign-in site.
  await ctx.route((url) => !url.href.startsWith(`${BASE}/`), (route) => route.abort());
  if (engine === "webkit") {
    // WebKit won't send a Secure (__Host-) cookie to http://localhost, so the
    // same session goes in as a plain cookie for this local address only.
    await ctx.addCookies([{ name: cookieName, value: cookieValue, url: BASE }]);
  } else {
    // As in docs/screenshots/syc-209-pr-3-1: Chromium and Firefox treat
    // localhost as a secure place, so the Secure cookie is sent.
    await ctx.addCookies([{ name: cookieName, value: cookieValue, url: BASE.replace("http:", "https:") }]);
  }
  return ctx;
}

// The Ginger chip, tapped as a person would (the box itself is drawn as a chip).
const GINGER = 'label.choicechip:has(input[name="colours"][value="ginger"])';

/** On a phone the filters fold under "Filters (n)"; on a desktop they're always shown. */
async function openFilters(p) {
  const summary = p.locator("details.filters > summary");
  if ((await summary.isVisible()) && !(await p.locator("details.filters").evaluate((d) => d.open))) await summary.click();
}

const count = (p) => p.locator("#catresults .count, #catresults .notice").first().textContent();

for (const engine of ["chromium", "webkit", "firefox"]) {
  let browser;
  try {
    browser = await pw[engine].launch();
  } catch (err) {
    report.push({ engine, skipped: `not installed: ${String(err.message).split("\n")[0]}` });
    continue;
  }
  try {
    await runEngine(engine, browser);
  } catch (err) {
    check(engine, "the run finished", false, String(err.message).split("\n").slice(0, 3).join(" | "));
  }
  await browser.close();
}

console.log(JSON.stringify({ failed, report }, null, 1));
process.exit(failed ? 1 : 0);

async function runEngine(engine, browser) {
  // ── With JavaScript: a tap applies the filter without a page load. ──
  for (const width of engine === "chromium" ? [1280, 390] : [1280]) {
    const phone = width < 600;
    const ctx = await context(browser, { viewport: { width, height: phone ? 844 : 900 }, deviceScaleFactor: 2, hasTouch: phone, isMobile: phone && engine !== "firefox" }, engine);
    const p = await ctx.newPage();
    const where = `${engine} ${width}px`;
    const console_ = [];
    const violations = [];
    p.on("console", (m) => console_.push(`${m.type()}: ${m.text()}`));
    await p.addInitScript(() => {
      window.__violations = [];
      document.addEventListener("securitypolicyviolation", (e) =>
        window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`),
      );
    });
    let loads = 0;
    p.on("load", () => loads++);
    const fetched = [];
    p.on("request", (r) => {
      if (r.resourceType() === "fetch") fetched.push(r.url());
    });

    await p.goto(`${BASE}/api/team/cats`);
    await p.waitForLoadState("networkidle");
    check(where, "the page loads, signed in", (await p.title()) === "Cats", { title: await p.title(), url: p.url() });
    const scriptLoaded = await p.evaluate(() =>
      performance.getEntriesByType("resource").some((e) => /\/api\/team\/assets\/dashboard-grid\.[0-9a-f]{12}\.js$/.test(e.name)),
    );
    check(where, "our script loaded from /api/team/assets/", scriptLoaded);
    const before = (await count(p)).trim();
    check(where, "all 8 cats to start", before.startsWith("8 cats match"), before);
    if (width === 1280) await p.screenshot({ path: `${OUT}/${engine}-${width}-1-before.png`, fullPage: true });
    await p.evaluate(() => (window.__sameDocument = "yes"));

    await openFilters(p);
    await p.click(GINGER);
    await p.waitForFunction(() => /^2 cats match/.test(document.querySelector("#catresults .count")?.textContent ?? ""), null, { timeout: 5000 }).catch(() => {});
    const after = (await count(p)).trim();
    check(where, "ticking Ginger narrows the grid to the 2 ginger cats", after.startsWith("2 cats match"), after);
    check(where, "the grid shows 2 cards", (await p.locator("#catresults .catcard").count()) === 2);
    check(where, "no page load: the same document", (await p.evaluate(() => window.__sameDocument)) === "yes" && loads === 1, { loads });
    check(where, "it was a fetch of the same page", fetched.some((u) => u.startsWith(`${BASE}/api/team/cats?`) && u.includes("colours=ginger")), fetched);
    const url = new URL(p.url());
    check(where, "the address carries the filter", url.pathname === "/api/team/cats" && url.searchParams.getAll("colours").includes("ginger"), p.url());
    check(where, "the chip for Ginger shows", (await p.locator("#catresults a.fchip").allTextContents()).some((t) => t.includes("Ginger")));
    check(where, "the Filters label counts it", (await p.locator("details.filters > summary").textContent()).trim() === "Filters (1)");
    await p.screenshot({ path: `${OUT}/${engine}-${width}-2-after-ginger.png`, fullPage: true });

    // Typing waits for a pause, then applies.
    await p.click(GINGER);
    await p.waitForFunction(() => /^8 cats match/.test(document.querySelector("#catresults .count")?.textContent ?? ""), null, { timeout: 5000 }).catch(() => {});
    await p.fill("#q", "Mavros");
    await p.waitForFunction(() => /^1 cat matches/.test(document.querySelector("#catresults .count")?.textContent ?? ""), null, { timeout: 5000 }).catch(() => {});
    const typed = (await count(p)).trim();
    check(where, "typing a name narrows it after a pause", typed.startsWith("1 cat matches"), typed);
    check(where, "still the same document after typing", (await p.evaluate(() => window.__sameDocument)) === "yes" && loads === 1, { loads });
    check(where, "the address carries the typed name", new URL(p.url()).searchParams.get("q") === "Mavros", p.url());
    if (width === 1280) await p.screenshot({ path: `${OUT}/${engine}-${width}-3-typed.png`, fullPage: true });

    // A reload of the address gives the same view (it is bookmarkable).
    await p.reload();
    await p.waitForLoadState("networkidle");
    check(where, "reloading the address gives the same view", (await count(p)).trim().startsWith("1 cat matches"));

    const pageViolations = await p.evaluate(() => window.__violations);
    violations.push(...pageViolations);
    const cspConsole = console_.filter((m) => /content security policy|content-security-policy|refused to/i.test(m));
    check(where, "no security-policy violations", violations.length === 0 && cspConsole.length === 0, { violations, cspConsole });
    check(where, "no console errors", console_.filter((m) => m.startsWith("error")).length === 0, console_);
    await ctx.close();
  }

  // ── JavaScript off: Show cats still works. ──
  {
    const ctx = await context(browser, { viewport: { width: 1280, height: 900 }, javaScriptEnabled: false }, engine);
    const p = await ctx.newPage();
    const where = `${engine} no-JS`;
    await p.goto(`${BASE}/api/team/cats`);
    check(where, "the page loads with JavaScript off", (await count(p)).trim().startsWith("8 cats match"));
    await openFilters(p);
    await p.click(GINGER);
    await p.waitForTimeout(500);
    check(where, "ticking a box alone changes nothing (no script)", (await count(p)).trim().startsWith("8 cats match"));
    await Promise.all([p.waitForURL(/colours=ginger/), p.click('button[type="submit"]:has-text("Show cats")')]);
    const after = (await count(p)).trim();
    check(where, "Show cats applies the filter by an ordinary page load", after.startsWith("2 cats match"), after);
    await p.screenshot({ path: `${OUT}/${engine}-nojs-after-show-cats.png`, fullPage: true });
    await ctx.close();
  }
}
