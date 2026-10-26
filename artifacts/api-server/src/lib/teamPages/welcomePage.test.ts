import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CATALOGUE, type Language } from "./strings";
import { escapeHtml } from "./escape";
import {
  PROMISES_VERSION,
  PROMISE_KEYS,
  STATEMENT_KEYS,
  renderWelcomePage,
} from "./welcomePage";

// T29d (SYC-53 PR 1.1; plan review M5): the accept page carries EXACTLY three
// promises, word for word as the spec has them, AND the rest the spec
// requires: what she will be able to see and do, the request to keep a lock
// on her phone, and the sentence that a phone never opened again keeps its
// saved list until the browser clears it. None of that extra text is phrased
// as a promise, and nothing on the page is about keeping places private
// (spec §13.4, §14.1). All in three languages with key parity; the promises
// version is recorded with the acceptance (team.invite.test.ts checks the
// event). A builder must not remove the extra text to satisfy "exactly three".

const ALL: Language[] = ["en", "el", "fr"];
const here = path.dirname(fileURLToPath(import.meta.url));
const spec = readFileSync(path.resolve(here, "../../../../../docs/specs/roles-and-invites.md"), "utf8");

/** The three bullets under "The three promises on the accept page" in spec §4.1. */
function specPromises(): string[] {
  const start = spec.indexOf("**The three promises on the accept page**");
  expect(start).toBeGreaterThan(0);
  const lines = spec.slice(start).split("\n").slice(1);
  const out: string[] = [];
  for (const line of lines) {
    if (line.startsWith("- ")) out.push(line.slice(2).trim());
    else if (out.length && line.trim() === "") break;
  }
  return out;
}

const input = {
  name: "Eleni",
  inviterName: "Susan",
  roles: ["guardian"],
  colonies: ["Vaporia — Eleni's"],
};
const page = (language: Language, roles = input.roles) =>
  renderWelcomePage({ ...input, roles, language }, ALL);
const promisesOn = (html: string) => {
  const list = html.match(/<ol class="promises">(.*?)<\/ol>/s);
  expect(list).not.toBeNull();
  return [...list![1]!.matchAll(/<li>(.*?)<\/li>/gs)].map((m) => m[1]!);
};

/** First-person, promise-shaped openings, per language. */
const PROMISE_SHAPED: Record<Language, RegExp> = {
  en: /^(I will|I'll|I promise|I understand|I agree|I )|\bpromise/i,
  el: /^(Θα |Υπόσχομαι|Καταλαβαίνω|Συμφωνώ)|υπόσχ/i,
  fr: /^(Je |J’|J')|promet/i,
};
/** Anything about keeping places private or secret, per language. */
const ABOUT_PRIVACY: Record<Language, RegExp> = {
  en: /private|privacy|secret|confidential|(don't|do not|never) share|keep .*(places|positions|locations)/i,
  el: /ιδιωτικ|απόρρητ|μυστικ|μη(ν)? μοιρ/i,
  fr: /privé|confidenti|secret|ne (les )?partage/i,
};

describe("T29d: exactly three promises, word for word", () => {
  it("the catalogue has exactly three promise keys, in every language", () => {
    expect(PROMISE_KEYS).toHaveLength(3);
    for (const lang of ALL) {
      const keys = Object.keys(CATALOGUE[lang]).filter((k) => k.startsWith("welcome.promise"));
      expect({ lang, keys: keys.sort() }).toEqual({ lang, keys: [...PROMISE_KEYS].sort() });
    }
  });

  it("the English promises are the spec's §4.1 bullets, word for word", () => {
    const fromSpec = specPromises();
    expect(fromSpec).toHaveLength(3);
    expect(PROMISE_KEYS.map((k) => CATALOGUE.en[k])).toEqual(fromSpec);
  });

  it("each page, in each language, lists exactly those three and no more", () => {
    for (const lang of ALL) {
      expect({ lang, promises: promisesOn(page(lang)) }).toEqual({
        lang,
        promises: PROMISE_KEYS.map((k) => escapeHtml(CATALOGUE[lang][k])),
      });
    }
  });

  it("the version accepted is recorded as promises-v1", () => {
    expect(PROMISES_VERSION).toBe("promises-v1");
  });
});

describe("T29d: and the text the spec requires beside them (review M5)", () => {
  it("what she will be able to see and do, the lock request and the never-reopened sentence, in every language", () => {
    for (const lang of ALL) {
      const t = CATALOGUE[lang];
      const g = page(lang);
      expect(g).toContain(escapeHtml(t["welcome.seeDo.title"]));
      for (const key of ["welcome.seeDo.guardianSee", "welcome.seeDo.guardianChange", "welcome.seeDo.guardianRead"] as const) expect(g).toContain(escapeHtml(t[key]));
      expect(g).toContain(escapeHtml(t["welcome.lock"]));
      expect(g).toContain(escapeHtml(t["welcome.neverReopened"]));
      const m = page(lang, ["staff", "management"]);
      expect(m).toContain(escapeHtml(t["welcome.seeDo.team"]));
      expect(m).toContain(escapeHtml(t["welcome.seeDo.management"]));
      expect(m).toContain(escapeHtml(t["welcome.lock"]));
      expect(m).toContain(escapeHtml(t["welcome.neverReopened"]));
    }
  });

  it("the extra text sits outside the promises list, and none of it is phrased as a promise", () => {
    expect([...STATEMENT_KEYS]).toEqual(["welcome.lock", "welcome.neverReopened"]);
    for (const lang of ALL) {
      const t = CATALOGUE[lang];
      const listed = promisesOn(page(lang));
      for (const key of [...STATEMENT_KEYS, "welcome.seeDo.guardianSee", "welcome.seeDo.guardianChange", "welcome.seeDo.guardianRead", "welcome.seeDo.team", "welcome.seeDo.management"] as const) {
        expect({ lang, key, inList: listed.includes(escapeHtml(t[key])) }).toEqual({ lang, key, inList: false });
        expect({ lang, key, promiseShaped: PROMISE_SHAPED[lang].test(t[key]) }).toEqual({ lang, key, promiseShaped: false });
      }
    }
  });

  it("nothing on the page is about keeping places private (spec §13.4, §14.1)", () => {
    for (const lang of ALL) {
      const t = CATALOGUE[lang];
      const keys = Object.keys(t).filter((k) => k.startsWith("welcome.")) as (keyof typeof t)[];
      for (const key of keys) {
        expect({ lang, key, aboutPrivacy: ABOUT_PRIVACY[lang].test(t[key]) }).toEqual({ lang, key, aboutPrivacy: false });
      }
    }
  });

  it("review minor 8: the see-and-do text covers what spec §2.2, §2.4 and §6.2 give each role", () => {
    // SYC-572: three short lines for a guardian with a colony, and no "Report an issue" clause.
    const see = CATALOGUE.en["welcome.seeDo.guardianSee"];
    const change = CATALOGUE.en["welcome.seeDo.guardianChange"];
    const read = CATALOGUE.en["welcome.seeDo.guardianRead"];
    expect(see).toMatch(/^For your own colonies only: the area each cat was first seen in/);
    expect(read).toMatch(/reports of cats in trouble about your colonies' cats/);
    expect(change).toMatch(/create a new colony/);
    expect(change).toMatch(/choose which cats are in your colonies/);
    expect(`${see} ${change} ${read}`).not.toMatch(/Report an issue/);
    expect(Object.keys(CATALOGUE.en)).not.toContain("welcome.seeDo.guardian");
    const m = CATALOGUE.en["welcome.seeDo.management"];
    expect(m).toMatch(/invite people/);
    expect(m).toMatch(/take them off the list/);
    expect(m).toMatch(/sign anyone out everywhere/);
    // Review nit 4 (spec §2.4): and data-deletion requests, in every language.
    expect(m).toMatch(/act on requests to delete someone's data/);
    expect(CATALOGUE.el["welcome.seeDo.management"]).toMatch(/αιτήματα διαγραφής δεδομένων/);
    expect(CATALOGUE.fr["welcome.seeDo.management"]).toMatch(/traiter les demandes de suppression de données/);
    expect(CATALOGUE.fr["welcome.seeDo.management"]).not.toMatch(/'/);
    // French: a non-breaking space before the colon; Greek: no accented capital letters.
    expect(CATALOGUE.fr["welcome.seeDo.guardianSee"]).toContain("uniquement\u00a0:");
    for (const key of Object.keys(CATALOGUE.el).filter((k) => k.startsWith("welcome.seeDo"))) {
      expect({ key, accentedCapital: /[ΆΈΉΊΌΎΏ]/.test(CATALOGUE.el[key as keyof typeof CATALOGUE.el]) }).toEqual({ key, accentedCapital: false });
    }
  });

  it("the lock request asks; the never-reopened sentence states (English wording pinned)", () => {
    expect(CATALOGUE.en["welcome.lock"]).toMatch(/^Please keep a lock on your phone/);
    expect(CATALOGUE.en["welcome.neverReopened"]).toMatch(
      /^If you lose your phone, the saved list stays on it\. Tell Syros Cats\./,
    );
  });

  it("falls back to English while Greek is not live", () => {
    const g = renderWelcomePage({ ...input, language: "el" });
    expect(g).toContain('<html lang="en">');
    expect(g).toContain(escapeHtml(CATALOGUE.en["welcome.promise1"]));
  });
});

describe("SYC-739: where she lands", () => {
  const base = { name: "Maria", language: "en", inviterName: null, colonies: [] as string[] };
  it("says Home for the team and her own page for a cat guardian", () => {
    expect(renderWelcomePage({ ...base, roles: ["staff"] })).toContain("you land on the dashboard Home page.");
    expect(renderWelcomePage({ ...base, roles: ["guardian"] })).toContain("you land on your own page for your colonies.");
  });
});
