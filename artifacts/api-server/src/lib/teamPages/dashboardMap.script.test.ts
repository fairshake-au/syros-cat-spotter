import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// SYC-396 PR 1.5 (spec §6.3, §10.4): the island map's script asks our server
// for things in three ways only, each a fixed address with nothing after it:
// the square tokens and the cats (POSTs, everything in the body), and each
// square by its token alone. No position, no filter and no square number ever
// goes into an address it builds. This reads the script itself, so a change
// that puts something in a query string fails here before any browser runs it.
// (The browser check, docs/screenshots/syc-396-pr-1-5/check.mjs, watches the
// real requests too.)

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "assets", "dashboard-map.js");
const src = readFileSync(SCRIPT, "utf8");

/** The first argument of every call to `name(`, as written. */
function firstArgs(name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\b${name}\\(`, "g");
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < src.length && depth > 0; i++) {
      if ("([{".includes(src[i]!)) depth++;
      else if (")]}".includes(src[i]!)) depth--;
      else if (src[i] === "," && depth === 1) break;
    }
    out.push(src.slice(start, i).trim());
  }
  return out;
}

describe("the island map's script asks for fixed addresses only", () => {
  it("POSTs to exactly the two map routes, by fixed address", () => {
    const urls = firstArgs("postJson").filter((a) => a !== "url"); // the helper's own definition
    expect(urls.sort()).toEqual(['"/api/team/cats/positions"', '"/api/team/map-squares"']);
  });

  it("fetch is called only inside the POST helper", () => {
    expect(firstArgs("fetch")).toEqual(["url"]);
    expect(src).not.toMatch(/XMLHttpRequest|navigator\.sendBeacon|new\s+WebSocket|EventSource/);
  });

  it("a map square's address is the fixed path and its token, nothing else", () => {
    const srcs = [...src.matchAll(/\.src\s*=\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(srcs.sort()).toEqual(['"/api/team/map-square/" + token', "cat.photo"]);
    // The photo is only ever one of our own photo addresses, from the server.
    expect(src).toContain('c.photo.indexOf("/api/team/photos/") === 0');
  });

  it("no address it builds has a query string, but the page's own (the filter form's fields)", () => {
    // Every string literal that starts an address of ours.
    const literals = [...src.matchAll(/"(\/api\/[^"]*)"/g)].map((m) => m[1]!);
    for (const l of literals) expect(l, l).not.toContain("?");
    // The only "?" joined onto an address is the page's own, from query().
    const joins = [...src.matchAll(/\+\s*"\?"\s*\+\s*([\w.]+)/g)].map((m) => m[1]);
    for (const j of joins) expect(["qs", "gridQs", "findQs"]).toContain(j);
    expect(src).not.toMatch(/[?&](?:lat|lng|z|x|y)=/);
  });

  it("never builds HTML from strings", () => {
    expect(src).not.toMatch(/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write/);
    // Leaflet's divIcon gets an element, never an HTML string.
    for (const arg of [...src.matchAll(/L\.divIcon\(\{[^}]*html:\s*([\w.]+)/g)].map((m) => m[1]))
      expect(["el", "n"]).toContain(arg);
  });
});
