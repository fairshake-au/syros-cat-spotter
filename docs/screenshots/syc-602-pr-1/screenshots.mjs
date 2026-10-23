import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href);
const { HTML_DIR, OUT } = process.env;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const report = [];
for (const width of [390, 1280]) {
  const phone = width < 600;
  const ctx = await b.newContext({ viewport: { width, height: phone ? 844 : 900 }, deviceScaleFactor: 2, hasTouch: phone, isMobile: phone });
  // Nothing leaves the machine: only file:// pages and pictures load.
  await ctx.route("**/*", (r) => (r.request().url().startsWith("file://") ? r.continue() : r.abort()));
  const p = await ctx.newPage();
  for (const page of ["cat", "bare", "readonly"]) {
    await p.goto(`file://${HTML_DIR}/${page}.html`);
    await p.waitForLoadState("load");
    await p.screenshot({ path: `${OUT}/${width}-${page}.png`, fullPage: page !== "cat" });
    if (page === "cat") {
      await p.screenshot({ path: `${OUT}/${width}-cat-full.png`, fullPage: true });
      // Open a routine group and a sighting's More menu.
      await p.evaluate(() => { document.querySelector("li.statement.routine details").open = true; document.querySelector("ul.sightings details.rowmenu").open = true; });
      await p.locator("ul.sightings").first().scrollIntoViewIfNeeded();
      await p.screenshot({ path: `${OUT}/${width}-cat-sighting-menu.png` });
      await p.locator("li.statement.routine").first().scrollIntoViewIfNeeded();
      await p.screenshot({ path: `${OUT}/${width}-cat-history-group.png` });
    }
    const check = await p.evaluate(() => {
      const root = document.documentElement;
      const small = [], tiny = [];
      for (const el of document.querySelectorAll("main *")) {
        if (!el.checkVisibility()) continue;
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (own && parseFloat(getComputedStyle(el).fontSize) < 12) tiny.push(el.className || el.tagName);
        if (el.matches("summary, button, .rowmenu>summary")) {
          const r = el.getBoundingClientRect();
          if (r.height < 43.5) small.push(`${el.className || el.tagName}:${el.textContent.trim().slice(0, 30)}:${Math.round(r.height)}`);
        }
      }
      return { scrollW: root.scrollWidth, clientW: root.clientWidth, tinyText: [...new Set(tiny)], shortTargets: small };
    });
    report.push({ width, page, ...check, sideways: check.scrollW > check.clientW });
  }
  await ctx.close();
}
await b.close();
console.log(JSON.stringify(report, null, 1));
