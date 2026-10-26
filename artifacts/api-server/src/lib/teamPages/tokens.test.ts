import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderPage } from "./layout";
import { DARK_TOKENS, LIGHT_TOKENS, PAPER_SELECTORS, THEME_CSS } from "./tokens";
import { assetUrl } from "../teamAssets";
import { howFold, pageIntro, renderWordsPage, whatHappens, WORDS, WORDS_PATH } from "./help";

// SYC-579: the dashboard wears the app's look. SYC-739: in-page help.

const names = (tokens: string) => tokens.split(";").map((d) => d.split(":")[0]).filter((n) => n.startsWith("--"));
const page = () => renderPage({ title: "T", personName: "Eleni", body: "<p>x</p>" });

describe("the theme (SYC-579)", () => {
  it("has the app's Aegean primary, whitewash page and ink", () => {
    expect(LIGHT_TOKENS).toContain("--accent:#1c77c3");
    expect(LIGHT_TOKENS).toContain("--page:#f4f2ec");
    expect(LIGHT_TOKENS).toContain("--ink:#1b2a38");
  });

  it("defines every token in both themes", () => {
    expect(names(DARK_TOKENS).sort()).toEqual(names(LIGHT_TOKENS).sort());
  });

  it("goes dark only when the device asks, on screen, and keeps maps and charts on light paper", () => {
    expect(THEME_CSS.startsWith(`:root{${LIGHT_TOKENS}}`)).toBe(true);
    expect(THEME_CSS).toContain(`@media screen and (prefers-color-scheme:dark){:root{${DARK_TOKENS}}`);
    for (const s of PAPER_SELECTORS) expect(THEME_CSS).toContain(s);
  });

  it("marks Issues in slate, not a blue that reads as a button", () => {
    expect(LIGHT_TOKENS).toContain("--issue:#2c3e4f");
    expect(LIGHT_TOKENS).not.toContain("#2f5d9e");
  });

  it("puts the variables and Inter's faces before the rest of the stylesheet", () => {
    const html = page();
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
    expect(style.indexOf(":root{")).toBeLessThan(style.indexOf("body{"));
    const latin = assetUrl("inter-latin.woff2");
    expect(latin).toMatch(/^\/api\/team\/assets\/inter-latin\.[0-9a-f]{12}\.woff2$/);
    expect(style).toContain(`src:url(${latin}) format("woff2")`);
    expect(style).toContain("font-display:swap");
    expect(assetUrl("inter-greek.woff2")).not.toBeNull();
  });
});

describe("no colour typed into a stylesheet (SYC-579)", () => {
  // Every CSS colour is a token from tokens.ts. Fixed colours are allowed only
  // where something is drawn on light paper (charts, maps, the cat's own coat).
  const ALLOWED = new Set(["tokens.ts", "coatDrawing.ts", "teamCoatWords.ts"]);
  const dir = path.dirname(new URL(import.meta.url).pathname);
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.includes(".test.") && !ALLOWED.has(f));

  it.each(files)("%s", (f) => {
    const src = readFileSync(path.join(dir, f), "utf8");
    const found = [...src.matchAll(/\b(color|background(?:-color)?|border(?:-[a-z]+)*|outline|box-shadow|fill|stroke)\s*:\s*[^;{}"'`<>]*?(#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b)/g)].map((m) => `${m[1]}: ${m[2]}`);
    expect(found).toEqual([]);
  });
});

describe("in-page help (SYC-739)", () => {
  it("escapes every piece", () => {
    expect(pageIntro("<b>")).toBe('<p class="intro">&lt;b&gt;</p>');
    expect(whatHappens("a & b")).toBe('<p class="what">a &amp; b</p>');
    expect(whatHappens("x", { warn: true })).toBe('<p class="what warn">x</p>');
  });

  it("folds are closed, say How this page works, and link to Words we use", () => {
    const f = howFold(["One.", "Two."]);
    expect(f.startsWith('<details class="hownote howpage"><summary>How this page works</summary>')).toBe(true);
    expect(f).not.toContain("<details open");
    expect(f).toContain(`<a href="${WORDS_PATH}">Words we use</a>`);
    expect(howFold(["x"], { words: false })).not.toContain(WORDS_PATH);
    expect(howFold([])).toBe("");
  });

  it("Words we use lists every word once, each with its own anchor", () => {
    const html = renderWordsPage({ personName: "Eleni" });
    const ids = WORDS.flatMap((g) => g.words.map((w) => w.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(html).toContain(`<dt id="${id}">`);
    expect(html).toContain("<title>Words we use</title>");
  });

  it("says terminology the way the charity does", () => {
    const all = JSON.stringify(WORDS);
    expect(all).toContain("Cat guardian");
    expect(all).not.toMatch(/colony carer|snapper/i);
    expect(all).toContain("€50–60 per cat");
  });
});
