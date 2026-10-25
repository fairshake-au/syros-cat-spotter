// SYC-677 Task 6 browser check: the vet visit batch page at 390px and 1280px.
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
    const body = await readFile(join(HTML_DIR, path));
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" }).end(body);
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
  // NAMES (comma-separated) picks the pages to shoot; the default is Task 6's set.
  for (const name of (process.env.NAMES ?? "empty,mixed,failed,saved,cat-saved").split(",")) {
    await page.goto(`${ORIGIN}/${name}.html`);
    // Open the folds for a second shot.
    const m = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
      smallText: [...document.querySelectorAll("body *")].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 12 && e.offsetParent !== null).map((e) => `${e.tagName}.${e.className}: ${e.textContent.trim().slice(0, 30)}`),
    }));
    result.pages[`${name}-${w}`] = m;
    await page.screenshot({ path: `${OUT}/${w}-${name}.png`, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
server.close();
await writeFile(`${OUT}/${process.env.RESULT ?? "check-result.json"}`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
