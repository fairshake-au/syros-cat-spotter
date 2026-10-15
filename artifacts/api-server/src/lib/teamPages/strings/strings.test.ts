import { describe, expect, it } from "vitest";
import { normaliseEmail, pool } from "@workspace/db";
import { en } from "./en";
import {
  CATALOGUE,
  LIVE_LANGUAGES,
  formatDate,
  formatDateTime,
  pageLanguage,
  tr,
  type Language,
} from "./index";
import { accessEndedPage, forbiddenPage } from "../../teamAuth/refuse";

// T25 (SYC-53 PR 1.0): the dashboard's three-language catalogue.

const LANGS: Language[] = ["en", "el", "fr"];

describe("the catalogue", () => {
  it("has every key in every language, none empty", () => {
    const keys = Object.keys(en).sort();
    for (const lang of LANGS) {
      const dict = CATALOGUE[lang] as Record<string, string>;
      expect({ lang, keys: Object.keys(dict).sort() }).toEqual({ lang, keys });
      for (const key of keys) {
        const value = dict[key];
        expect({ lang, key, blank: typeof value !== "string" || value.trim() === "" }).toEqual({
          lang,
          key,
          blank: false,
        });
      }
    }
  });

  it("keeps the same {placeholders} in every language", () => {
    const holes = (s: string) => [...(s.match(/\{\w+\}/g) ?? [])].sort();
    for (const [key, text] of Object.entries(en)) {
      for (const lang of LANGS) {
        const other = (CATALOGUE[lang] as Record<string, string>)[key]!;
        expect({ lang, key, holes: holes(other) }).toEqual({ lang, key, holes: holes(text) });
      }
    }
  });

  it("never says colony carer or snapper", () => {
    for (const lang of LANGS) {
      for (const text of Object.values(CATALOGUE[lang])) {
        expect(text).not.toMatch(/colony carer|snapper/i);
      }
    }
  });
});

describe("LIVE_LANGUAGES and the silent fallback", () => {
  it("is English only today (Greek and French wait for SYC-283)", () => {
    expect([...LIVE_LANGUAGES]).toEqual(["en"]);
  });

  it("asking for Greek or French gives English", () => {
    expect(pageLanguage("el")).toBe("en");
    expect(pageLanguage("fr")).toBe("en");
    expect(pageLanguage("de")).toBe("en");
    expect(pageLanguage(null)).toBe("en");
    expect(tr("el", "ended.title")).toBe(en["ended.title"]);
    expect(tr("fr", "ended.title")).toBe(en["ended.title"]);
  });

  it("serves a language once it is live", () => {
    expect(pageLanguage("el", ["en", "el"])).toBe("el");
    expect(tr("el", "ended.title", undefined, ["en", "el"])).toBe(
      CATALOGUE.el["ended.title"],
    );
  });

  it("fills placeholders", () => {
    expect(tr("en", "shell.signedInAs", { name: "Eleni" })).toBe("Signed in as Eleni");
  });
});

describe("dates are in the person's language, Athens time", () => {
  // 22:30 UTC on 14 Oct is 01:30 on 15 Oct in Athens (UTC+3 in October).
  const at = new Date("2026-10-14T22:30:00Z");
  const all: Language[] = ["en", "el", "fr"];

  it("English", () => {
    expect(formatDate("en", at, all)).toBe("15 October 2026");
    expect(formatDateTime("en", at, all)).toMatch(/15 October 2026.*01:30/);
  });
  it("Greek", () => {
    expect(formatDate("el", at, all)).toBe("15 Οκτωβρίου 2026");
    expect(formatDateTime("el", at, all)).toMatch(/15 Οκτωβρίου 2026.*01:30/);
  });
  it("French", () => {
    expect(formatDate("fr", at, all)).toBe("15 octobre 2026");
    expect(formatDateTime("fr", at, all)).toMatch(/15 octobre 2026.*01:30/);
  });
  it("falls back to English while Greek is not live", () => {
    expect(formatDate("el", at)).toBe("15 October 2026");
  });
});

describe("SYC-101: Greek local parts, Postgres lower() and JavaScript toLowerCase()", () => {
  // FINDING (PR 1.0): the two do NOT agree on a word-final capital sigma.
  // JavaScript applies the Unicode final-sigma rule (ΟΔΥΣΣΕΑΣ -> οδυσσεας,
  // ending in ς); Postgres lower() on a libc collation (macOS and CI's
  // postgres:16 here) lowers every Σ to σ (οδυσσεασ). So `normaliseEmail(x)`
  // is NOT always `select lower(x)`. It is safe today because the address is
  // always normalised in JavaScript first and the table's
  // `people_email_lowercase_ck` (email = lower(btrim(email))) only needs the
  // stored value to be a fixed point of lower(), which ς is. It would break
  // the moment any SQL compared lower(@input) with a stored address. Reported
  // to Samuel for a decision; these tests pin what is true and what matters.
  const agree = [
    "Νίκος.Κ@Example.gr",
    "ΜΑΡΊΑ@EXAMPLE.GR",
    "ΣΟΦΊΑ.Π@example.gr",
    "Samuel.Porter@Example.com",
  ];
  const finalSigma = [
    "ΟΔΥΣΣΕΑΣ@example.gr",
    "Νίκος.ΚΑΣ@Example.gr",
    "Σοφία.ΣΑΣ@example.gr",
    "ΑΘΗΝΑΪΣ@example.gr",
  ];

  it.each(agree)("lower-cases identically in Postgres and JavaScript: %s", async (address) => {
    const { rows } = await pool.query<{ lowered: string }>(
      "select lower($1::text) as lowered",
      [address],
    );
    expect(normaliseEmail(address)).toBe(rows[0]!.lowered);
  });

  it.each(finalSigma)(
    "final sigma: the JavaScript result is accepted by the people_email_lowercase_ck rule (a fixed point of Postgres lower): %s",
    async (address) => {
      const normalised = normaliseEmail(address);
      const { rows } = await pool.query<{ fixed: boolean }>(
        "select lower(btrim($1::text)) = $1::text as fixed",
        [normalised],
      );
      expect(rows[0]!.fixed).toBe(true);
    },
  );

  it("normalising twice changes nothing", () => {
    for (const address of [...agree, ...finalSigma]) {
      expect(normaliseEmail(normaliseEmail(address))).toBe(normaliseEmail(address));
    }
  });
});

describe("the guardian-facing refusal pages", () => {
  const guardian = { name: "Eleni", island: false } as const;

  it("render English with lang=en while only English is live, whatever was asked", () => {
    for (const language of ["en", "el", "fr"]) {
      const page = forbiddenPage({ ...guardian, language });
      expect(page).toContain('<html lang="en">');
      expect(page).toContain(en["refused.forTeam"]);
      expect(page).toContain("Signed in as Eleni");
      const ended = accessEndedPage({ name: "Eleni", language });
      expect(ended).toContain('<html lang="en">');
      expect(ended).toContain(en["ended.title"]);
    }
  });

  it("render Greek with lang=el once Greek is live (injected, no global change)", () => {
    const live: Language[] = ["en", "el"];
    const page = forbiddenPage({ ...guardian, language: "el" }, live);
    expect(page).toContain('<html lang="el">');
    expect(page).toContain(CATALOGUE.el["refused.forTeam"]);
    expect(page).toContain(CATALOGUE.el["shell.signOut"]);
    expect(page).not.toContain(en["refused.forTeam"]);
    const ended = accessEndedPage({ name: "Eleni", language: "el" }, live);
    expect(ended).toContain('<html lang="el">');
    expect(ended).toContain(CATALOGUE.el["ended.body"]);
    // French is still not live in that call.
    expect(forbiddenPage({ ...guardian, language: "fr" }, live)).toContain('<html lang="en">');
    // And the default is untouched afterwards.
    expect(forbiddenPage({ ...guardian, language: "el" })).toContain('<html lang="en">');
  });
});
