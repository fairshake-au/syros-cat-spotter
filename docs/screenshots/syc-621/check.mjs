// SYC-621 browser check: the trapping planner at 390px and 1280px, and the printed plan (print media + a PDF).
// Serves the fixture render (render-fixture.ts.txt) from a localhost server and aborts every request that is not to it.
//
//   PLAYWRIGHT_CORE=<path to playwright-core/index.mjs> HTML_DIR=<dir> OUT=<dir> node check.mjs
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href);
const { HTML_DIR, OUT } = process.env;
const MS = process.env.MS_PLAYWRIGHT ?? `${process.env.HOME}/Library/Caches/ms-playwright`;
const TYPES = { ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  try {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" }).end(await readFile(join(HTML_DIR, path)));
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const browser = await pw.chromium.launch({ executablePath: `${MS}/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing` });
const result = { blocked: [], pages: {} };
for (const [w, h] of [[390, 844], [1280, 900]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.route((u) => !u.href.startsWith(ORIGIN), (r) => { result.blocked.push(r.request().url()); return r.abort(); });
  const page = await ctx.newPage();
  for (const name of ["team", "guardian", "plan"]) {
    await page.goto(`${ORIGIN}/${name}.html`);
    // Open the folds for a second shot.
    const m = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
      smallText: [...document.querySelectorAll("body *")].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 12 && e.offsetParent !== null).map((e) => `${e.tagName}.${e.className}: ${e.textContent.trim().slice(0, 30)}`),
    }));
    result.pages[`${name}-${w}`] = m;
    await page.screenshot({ path: `${OUT}/${w}-${name}.png`, fullPage: true });
    if (name !== "plan") {
      await page.evaluate(() => document.querySelectorAll("details.planfold").forEach((d) => (d.open = true)));
      await page.screenshot({ path: `${OUT}/${w}-${name}-folds-open.png`, fullPage: true });
    }
  }
  if (w === 1280) {
    await page.goto(`${ORIGIN}/plan.html`);
    await page.emulateMedia({ media: "print" });
    await page.screenshot({ path: `${OUT}/print-media-plan.png`, fullPage: true });
    result.printSmallText = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.offsetParent !== null && parseFloat(getComputedStyle(e).fontSize) < 12).map((e) => e.tagName));
    await page.pdf({ path: `${OUT}/plan.pdf`, format: "A4", printBackground: true, preferCSSPageSize: true });
  }
  await ctx.close();
}
await browser.close();
server.close();
await writeFile(`${OUT}/check-result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
