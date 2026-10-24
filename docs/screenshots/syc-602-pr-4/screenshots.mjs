import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href);
const { HTML_DIR, OUT } = process.env;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const report = [];
for (const width of [390, 600, 1280]) {
  const phone = width < 600;
  const ctx = await b.newContext({ viewport: { width, height: phone ? 844 : 900 }, deviceScaleFactor: 2, hasTouch: phone, isMobile: phone });
  // Nothing leaves the machine: only file:// pages and pictures load.
  await ctx.route("**/*", (r) => (r.request().url().startsWith("file://") ? r.continue() : r.abort()));
  const p = await ctx.newPage();
  for (const page of width === 600 ? ["cat"] : ["cat", "bare", "readonly"]) {
    await p.goto(`file://${HTML_DIR}/${page}.html`);
    await p.waitForLoadState("load");
    await p.screenshot({ path: `${OUT}/${width}-${page}.png`, fullPage: page === "bare" || page === "readonly" });
    if (page === "cat") {
      await p.screenshot({ path: `${OUT}/${width}-cat-full.png`, fullPage: true });
      // The "Add a note" form open (a details in Update this cat), then History with the note rows.
      const noteOpen = await p.evaluate(() => {
        const sum = [...document.querySelectorAll("summary")].find((s) => s.textContent.trim() === "Add a note");
        if (!sum) return null;
        sum.parentElement.open = true;
        sum.scrollIntoView({ block: "center" });
        const cs = getComputedStyle(sum, "::before"), mk = getComputedStyle(sum, "::marker");
        return { summaryText: sum.textContent.trim(), listStyle: getComputedStyle(sum).listStyleType, display: getComputedStyle(sum).display, beforeContent: cs.content, markerContent: mk.content, height: Math.round(sum.getBoundingClientRect().height), hasTextarea: !!sum.parentElement.querySelector("textarea") };
      });
      report.push({ width, page: "add-a-note", noteOpen });
      await p.screenshot({ path: `${OUT}/${width}-note-form.png` });
      await p.evaluate(() => { [...document.querySelectorAll("summary")].find((s) => s.textContent.trim() === "Add a note").parentElement.open = false; });
      await p.evaluate(() => { document.querySelector("#s-310").scrollIntoView({ block: "center" }); });
      await p.screenshot({ path: `${OUT}/${width}-history-notes.png` });
      await p.evaluate(() => { document.querySelector(".catfacts").scrollIntoView(); });
      await p.screenshot({ path: `${OUT}/${width}-facts.png` });
      // The Photos grid with one photo's menu open, then the Coat fold (open by itself: a reason to look).
      await p.evaluate(() => { document.querySelectorAll(".gallery details")[1].open = true; document.querySelector("#photos").scrollIntoView(); });
      await p.screenshot({ path: `${OUT}/${width}-photo-menu.png` });
      await p.evaluate(() => { document.querySelectorAll(".gallery details")[1].open = false; document.querySelector("#appearance").scrollIntoView(); });
      await p.screenshot({ path: `${OUT}/${width}-coat-fold.png` });
      // The last photo's menu, nearest the right edge on a phone: does it stay on screen?
      const spill = await p.evaluate(() => {
        const out = [];
        for (const d of document.querySelectorAll(".gallery details")) {
          d.open = true;
          const m = d.querySelector(".rowmenuitems");
          if (m) { const r = m.getBoundingClientRect(); out.push(r.left < 0 || r.right > document.documentElement.clientWidth); }
          d.open = false;
        }
        return out;
      });
      report.push({ width, page: "menus-off-screen", spill });
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
      // No record number in History's words (spec §3.5).
      let hist = "";
      for (let el = document.querySelector("#history"); el && !(el.tagName === "H2" && el.id !== "history"); el = el.nextElementSibling) hist += ` ${el.textContent}`;
      const numbers = hist.match(/#\d+/g) ?? [];
      const box = document.querySelector(".openreports");
      const facts = document.querySelector(".catfacts");
      const side = document.querySelector(".catside");
      const sideBox = side && side.getBoundingClientRect();
      const mainBox = document.querySelector(".catmain")?.getBoundingClientRect();
      const healthDt = [...document.querySelectorAll(".catfacts dt")].find((d) => d.textContent === "Health note");
      const noteRows = ["s-310", "s-305", "s-309"].map((id) => { const li = document.getElementById(id)?.closest("li"); return li ? { id, tag: li.querySelector(".tag.note")?.textContent ?? null, struck: !!li.querySelector("del"), markWrong: /Mark wrong/.test(li.textContent) } : { id, missing: true }; });
      return { healthNote: healthDt ? { value: healthDt.nextElementSibling.firstChild.textContent, source: healthDt.nextElementSibling.querySelector(".how")?.textContent } : null, noteRows, addNoteButton: [...document.querySelectorAll("summary")].some((s) => s.textContent.trim() === "Add a note"),
        scrollW: root.scrollWidth, clientW: root.clientWidth, tinyText: [...new Set(tiny)], shortTargets: small, recordNumbersInHistory: numbers,
        reportsBoxAboveFacts: box && facts ? box.getBoundingClientRect().bottom <= facts.getBoundingClientRect().top : null,
        sideSticky: side ? getComputedStyle(side).position : null,
        sideOnRight: sideBox && mainBox ? sideBox.left >= mainBox.right : null,
        mainPhotoLabels: [...document.querySelectorAll(".gallery")].flatMap((g) => [...g.querySelectorAll("*")].filter((e) => e.children.length === 0 && /Main photo/.test(e.textContent)).map((e) => e.textContent.trim())) };
    });
    report.push({ width, page, ...check, sideways: check.scrollW > check.clientW });
  }
  await ctx.close();
}
await b.close();
console.log(JSON.stringify(report, null, 1));
