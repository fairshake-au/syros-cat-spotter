// Screenshots for the PR: the island, Ermoupoli, and a tap there, at each width.
import { chromium } from "playwright-core";
const BASE = process.env.BASE; const OUT = process.env.OUT;
const [n, ...r] = process.env.COOKIE.split("="); const v = r.join("=");
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
for (const width of [320, 360, 375, 390, 1280]) {
  const phone = width < 600;
  const ctx = await b.newContext({ viewport: { width, height: phone ? 800 : 900 }, deviceScaleFactor: 2, hasTouch: phone, isMobile: phone });
  await ctx.addCookies([{ name: n, value: v, url: BASE.replace("http:", "https:") }]);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/api/team/map`); await p.waitForLoadState("networkidle");
  await p.screenshot({ path: `${OUT}/${width}-1-island.png`, fullPage: true });
  await Promise.all([p.waitForURL(`${BASE}/api/team/map`), p.click("button[value=ermoupoli]")]);
  await p.waitForLoadState("networkidle");
  await p.screenshot({ path: `${OUT}/${width}-2-ermoupoli.png`, fullPage: true });
  const box = await p.evaluate(() => { const i = [...document.querySelectorAll(".mapband")].find((b) => getComputedStyle(b).display !== "none").querySelectorAll("input[type=image]")[0]; const r = i.getBoundingClientRect(); return { x: r.left + r.width * 0.8, y: r.top + r.height * 0.75 }; });
  const nav = p.waitForURL(`${BASE}/api/team/map/tap`);
  if (phone) await p.touchscreen.tap(box.x, box.y); else await p.mouse.click(box.x, box.y);
  await nav; await p.waitForLoadState("networkidle");
  await p.screenshot({ path: `${OUT}/${width}-3-after-tap.png`, fullPage: true });
  await ctx.close();
}
await b.close();
