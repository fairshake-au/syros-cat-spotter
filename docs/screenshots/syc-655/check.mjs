// SYC-655 browser check: the CSS-only tabs on the team cat page, in Chromium, WebKit and Firefox.
// Serves the fixture render (render-fixture.ts.txt) from a localhost server and aborts every request that
// is not to it, then writes check-result.json and the screenshots.
//
//   PLAYWRIGHT_CORE=<path to playwright-core/index.mjs> HTML_DIR=<dir with cat.html, bare.html, readonly.html, img/> \
//   OUT=<dir for check-result.json and the pngs> node check.mjs
//
// Browser binaries are looked up in ~/Library/Caches/ms-playwright (override with MS_PLAYWRIGHT).
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href);
const { HTML_DIR, OUT } = process.env;
const MS = process.env.MS_PLAYWRIGHT ?? `${process.env.HOME}/Library/Caches/ms-playwright`;
const ENGINES = {
  chromium: [pw.chromium, `${MS}/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`],
  webkit: [pw.webkit, `${MS}/webkit-2370/pw_run.sh`],
  firefox: [pw.firefox, `${MS}/firefox-1555/firefox/Nightly.app/Contents/MacOS/firefox`],
};

// A tiny static server on an ephemeral port: nothing else is reachable.
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

const ADDRESSES = [
  ["none", "", "history"],
  ["#tab-photos", "#tab-photos", "photos"],
  ["#s-<id>", "#s-301", "history"],
  ["#s-<id> inside a folded run", "FOLDED_S", "history"],
  ["#sg-<id>", "#sg-900", "history"],
  ["#sg-<id> inside a folded run", "FOLDED_SG", "history"],
  ["#p-<id>", "#p-s2", "photos"],
  ["#p-<id> (the hidden photo)", "#p-s3", "photos"],
  ["#appearance", "#appearance", "coat"],
  ["#a-<id>", "#a-603", "coat"],
  ["#a-<id> (a past change)", "#a-601", "coat"],
  ["#issue-strip", "#issue-strip", "reports"],
  ["#corrections", "#corrections", "history"],
  ["#nonsense", "#nonsense", "history"],
  ["#history", "#history", "history"],
  ["#photos", "#photos", "photos"],
  ["#map", "#map", "map"],
  ["#vet-visits", "#vet-visits", "history"],
  ["#vv-<id>", "#vv-280", "history"],
];

// Run in the page: which panels show, and where the target is relative to the sticky tab row.
const measure = (hash) => {
  const panels = [...document.querySelectorAll(".catpanel")];
  const visible = panels.filter((p) => getComputedStyle(p).display !== "none").map((p) => p.id.replace("tab-", ""));
  const tabs = document.querySelector(".cattabs");
  const tabsRect = tabs ? tabs.getBoundingClientRect() : { top: 0, bottom: 0 };
  const tabsBottom = tabsRect.bottom;
  const id = decodeURIComponent(hash.replace(/^#/, ""));
  const el = id ? document.getElementById(id) : null;
  let target = null;
  if (el) {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const shown = el.checkVisibility();
    const folds = [];
    for (let a = el.closest("details"); a; a = a.parentElement?.closest("details")) folds.push(a.open);
    target = {
      id, shown, top: Math.round(r.top), bottom: Math.round(r.bottom), tabsBottom: Math.round(tabsBottom),
      inViewport: shown && r.bottom > 0 && r.top < vh,
      // Not hidden under the sticky row: the point just inside the target's top edge is not inside the row's current box.
      // (A target in the header card sits above the row, which is then still in its place further down.)
      clearOfTabs: shown && !(tabsRect.top <= r.top + 4 && tabsRect.bottom > r.top + 4),
      openFoldsAbove: folds,
    };
  }
  return { visible, scrollY: Math.round(window.scrollY), target, selectedTabs: [...document.querySelectorAll(".cattabs a")].filter((a) => getComputedStyle(a).color === "rgb(255, 255, 255)").map((a) => a.getAttribute("href")) };
};

const settle = (p) => p.waitForTimeout(400);
const verdict = (m, expected, hash) => {
  const oneVisible = m.visible.length === 1;
  const matches = oneVisible && m.visible[0] === expected;
  const t = m.target;
  // A target is only judged when it has an element, is not a whole panel's header-card id, and sits in the page body.
  const targetOk = !t || (t.inViewport && t.clearOfTabs);
  return { exactlyOne: oneVisible, expected, isExpected: matches, targetOk, pass: matches && targetOk && (hash === "" || !t || t.shown) };
};

const report = { origin: "localhost (ephemeral port)", engines: {}, aborted: [] };

for (const [name, [type, executablePath]] of Object.entries(ENGINES)) {
  const browser = await type.launch({ executablePath });
  const eng = { version: browser.version(), widths: {} };
  report.engines[name] = eng;
  for (const width of [1280, 390]) {
    const phone = width < 600;
    const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, hasTouch: phone && name !== "firefox", isMobile: phone && name !== "firefox" });
    // Nothing leaves the machine: only this server's pages and pictures load. Registered before the first navigation.
    await ctx.route((url) => !url.href.startsWith(ORIGIN), (r) => { report.aborted.push(r.request().url()); return r.abort(); });
    const w = { addresses: [], hashchange: [], tabClicks: [], keyboard: null, noHas: null, consoleErrors: [] };
    eng.widths[width] = w;

    // The folded-run targets come from the page itself.
    const probe = await ctx.newPage();
    await probe.goto(`${ORIGIN}/cat.html`);
    const folded = await probe.evaluate(() => {
      const run = document.querySelector("details:has(> summary .runwords):not([open])");
      return { s: run?.querySelector('[id^="s-"]')?.id ?? null, sg: run?.querySelector('[id^="sg-"]')?.id ?? null };
    });
    await probe.close();
    eng.foldedRun = folded;

    for (const [label, rawHash, expected] of ADDRESSES) {
      const hash = rawHash === "FOLDED_S" ? (folded.s ? `#${folded.s}` : null) : rawHash === "FOLDED_SG" ? (folded.sg ? `#${folded.sg}` : null) : rawHash;
      if (hash === null) { w.addresses.push({ label, error: "no folded run found in the fixture" }); continue; }
      const p = await ctx.newPage();
      p.on("pageerror", (e) => w.consoleErrors.push(String(e)));
      await p.goto(`${ORIGIN}/cat.html${hash}`);
      await p.waitForLoadState("load");
      await settle(p);
      const m = await p.evaluate(measure, hash);
      w.addresses.push({ label, hash, ...m, ...verdict(m, expected, hash) });
      await p.close();
    }

    // A hashchange from the default page, with no reload (a window marker proves it).
    const hp = await ctx.newPage();
    await hp.goto(`${ORIGIN}/cat.html`);
    await hp.evaluate(() => { window.__noReload = true; });
    for (const [hash, expected] of [["#p-s2", "photos"], ["#s-301", "history"], ["#a-601", "coat"], ["#issue-strip", "reports"], ["#s-399", "history"]]) {
      await hp.evaluate((h) => { location.hash = h; }, hash);
      await settle(hp);
      const m = await hp.evaluate(measure, hash);
      const kept = await hp.evaluate(() => window.__noReload === true);
      w.hashchange.push({ hash, noReload: kept, ...m, ...verdict(m, expected, hash) });
    }
    await hp.close();

    // Click each tab, one after another on the same page.
    const cp = await ctx.newPage();
    await cp.goto(`${ORIGIN}/cat.html`);
    for (const [tab, expected] of [["photos", "photos"], ["map", "map"], ["coat", "coat"], ["reports", "reports"], ["history", "history"]]) {
      await cp.click(`.cattabs a[href="#tab-${tab}"]`);
      await settle(cp);
      const m = await cp.evaluate(measure, `#tab-${tab}`);
      const v = verdict(m, expected, `#tab-${tab}`);
      w.tabClicks.push({ tab, hash: await cp.evaluate(() => location.hash), ...m, ...v, selectedIsClicked: m.selectedTabs.length === 1 && m.selectedTabs[0] === `#tab-${tab}` });
    }
    await cp.close();

    // Keyboard: Tab from the top reaches the tab links in order, and each shows a focus ring.
    const kp = await ctx.newPage();
    await kp.goto(`${ORIGIN}/cat.html`);
    const seen = [];
    const scroller = [];
    // Safari/WebKit on macOS skips links with plain Tab (its own setting); Option+Tab is its way to reach them.
    const tabKey = name === "webkit" ? "Alt+Tab" : "Tab";
    for (let i = 0; i < 80 && seen.length < 5; i++) {
      await kp.keyboard.press(tabKey);
      const f = await kp.evaluate(() => {
        const a = document.activeElement;
        if (!a?.closest(".cattabs")) return null;
        const cs = getComputedStyle(a);
        // Firefox makes a sideways-scrolling row a tab stop of its own: note it, it is not a tab link.
        if (a.matches(".cattabs")) return { scroller: true, focusVisible: a.matches(":focus-visible") };
        return { href: a.getAttribute("href"), focusVisible: a.matches(":focus-visible"), outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, boxShadow: cs.boxShadow };
      });
      if (f?.scroller) scroller.push(f);
      else if (f) seen.push(f);
    }
    const expectedOrder = await kp.evaluate(() => [...document.querySelectorAll(".cattabs a")].map((a) => a.getAttribute("href")));
    w.keyboard = {
      key: tabKey, scrollerTabStops: scroller.length, domOrder: expectedOrder, reached: seen.map((s) => s.href), inOrder: JSON.stringify(seen.map((s) => s.href)) === JSON.stringify(expectedOrder),
      focusShown: seen.map((s) => s.focusVisible && (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0 || s.boxShadow !== "none")), detail: seen,
    };
    await kp.close();

    // Without :has() support: delete the @supports rule from the page's stylesheet; every panel must show.
    const np = await ctx.newPage();
    await np.goto(`${ORIGIN}/cat.html`);
    w.noHas = await np.evaluate(() => {
      let removed = 0;
      for (const sheet of document.styleSheets) {
        for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
          if (sheet.cssRules[i] instanceof CSSSupportsRule && sheet.cssRules[i].conditionText.includes(":has(a)")) { sheet.deleteRule(i); removed++; }
        }
      }
      const panels = [...document.querySelectorAll(".catpanel")];
      return { removedSupportsBlocks: removed, panels: panels.map((p) => p.id), shown: panels.filter((p) => getComputedStyle(p).display !== "none").map((p) => p.id), allShown: removed > 0 && panels.every((p) => getComputedStyle(p).display !== "none") };
    });
    await np.close();

    // Screenshots from Chromium only.
    if (name === "chromium") {
      const sp = await ctx.newPage();
      const shot = async (file, url, full) => {
        await sp.goto(`${ORIGIN}/${url}`);
        await sp.waitForLoadState("load");
        await settle(sp);
        await sp.screenshot({ path: `${OUT}/${width}-${file}.png`, fullPage: full });
      };
      await shot("cat-default", "cat.html", false);
      await shot("cat-full", "cat.html", true);
      for (const t of ["history", "photos", "map", "coat", "reports"]) await shot(`tab-${t}`, `cat.html#tab-${t}`, true);
      await shot("readonly", "readonly.html", true);
      await shot("bare", "bare.html", true);
      await sp.close();
    }
    await ctx.close();
  }
  await browser.close();
}
server.close();

// Summary: every check that failed, by engine and width.
const failures = [];
for (const [eng, e] of Object.entries(report.engines)) {
  for (const [width, w] of Object.entries(e.widths)) {
    for (const a of w.addresses) if (a.error || !a.pass) failures.push({ eng, width, check: "address", label: a.label, hash: a.hash, visible: a.visible, target: a.target, error: a.error });
    for (const h of w.hashchange) if (!h.pass || !h.noReload) failures.push({ eng, width, check: "hashchange", hash: h.hash, visible: h.visible, target: h.target, noReload: h.noReload });
    for (const c of w.tabClicks) if (!c.pass || !c.selectedIsClicked) failures.push({ eng, width, check: "tab click", tab: c.tab, visible: c.visible, selectedTabs: c.selectedTabs, target: c.target });
    if (!w.keyboard.inOrder || !w.keyboard.focusShown.every(Boolean) || w.keyboard.reached.length !== w.keyboard.domOrder.length) failures.push({ eng, width, check: "keyboard", keyboard: { reached: w.keyboard.reached, focusShown: w.keyboard.focusShown } });
    if (!w.noHas.allShown) failures.push({ eng, width, check: "no :has()", noHas: w.noHas });
    if (w.consoleErrors.length) failures.push({ eng, width, check: "page errors", errors: w.consoleErrors });
  }
}
report.failures = failures;
report.summary = { failureCount: failures.length, abortedRequests: report.aborted.length };
await writeFile(`${OUT}/check-result.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ summary: report.summary, aborted: report.aborted, failures }, null, 1));
