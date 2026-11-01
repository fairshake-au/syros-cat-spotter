import { describe, expect, it } from "vitest";
import { SEED_AREAS } from "./areas/seedAreas";
import {
  NEWS_LANGUAGES,
  dateWord,
  languageOf,
  newsText,
  roundUpWords,
  weekdayWord,
  type NewsPush,
} from "./newsWords";

// SYC-221 (news-in-your-language.md §3.1, §3.4, §6 tests 1-3, 7, 8).

const KINDS: NewsPush[] = [
  { kind: "sterilised", name: "Agatha" },
  { kind: "spotted_again", name: "Agatha" },
  { kind: "seen_weekday", name: "Agatha", day: "2026-10-27" },
  { kind: "seen_date", name: "Agatha", day: "2026-10-03" },
  { kind: "new_cat", name: "Agatha" },
  { kind: "home", name: "Agatha" },
  { kind: "rename", oldName: "Agatha", newName: "Tigris" },
  { kind: "home_details", name: "Agatha" },
];

const TIME_RE =
  /\b\d{1,2}[:.h]\d{2}\b|\b\d{1,2}\s*(am|pm)\b|\bat \d|\bago\b|\b(second|minute|hour)s?\b|o'clock/i;

describe("languageOf", () => {
  it("keeps Greek and French, and sends English for anything else", () => {
    expect(languageOf("el")).toBe("el");
    expect(languageOf("fr")).toBe("fr");
    for (const raw of [null, undefined, "", "en", "de", "EL", "el-GR"]) expect(languageOf(raw)).toBe("en");
  });
});

describe("every push in every language", () => {
  it.each(KINDS.map((k) => [k.kind, k] as const))("%s has a title and body in en, el and fr", (_, n) => {
    const seen = new Set<string>();
    for (const lang of NEWS_LANGUAGES) {
      const { title, body } = newsText(n, lang);
      expect(title.trim()).not.toBe("");
      expect(body.trim()).not.toBe("");
      expect(`${title} ${body}`).not.toContain("undefined");
      seen.add(body);
    }
    // Each language really is its own words, not English copied across.
    expect(seen.size).toBe(3);
  });

  it("the English is word for word what the app sent before", () => {
    const en = (n: NewsPush) => newsText(n, "en");
    expect(en(KINDS[0]!)).toEqual({ title: "Agatha", body: "Agatha has been sterilised!" });
    expect(en(KINDS[1]!).body).toBe("Agatha was spotted again!");
    expect(en(KINDS[2]!).body).toBe("Agatha was seen on Tuesday");
    expect(en(KINDS[3]!).body).toBe("Agatha was seen on 3 October");
    expect(en(KINDS[4]!).body).toBe("Agatha was just discovered on Syros!");
    expect(en(KINDS[5]!)).toEqual({ title: "Agatha has a home!", body: "Agatha now has a home." });
    expect(en(KINDS[6]!)).toEqual({ title: "Agatha is now Tigris!", body: "Tigris's owner renamed their cat." });
    expect(en(KINDS[7]!)).toEqual({
      title: "Agatha has an update",
      body: "Agatha's home details were updated by their owner.",
    });
  });

  it("names the cat and never a place on the island or a time", () => {
    const places = SEED_AREAS.map((a) => a.name.toLowerCase());
    for (const n of KINDS) {
      for (const lang of NEWS_LANGUAGES) {
        const words = Object.values(newsText(n, lang)).join(" ");
        expect(words).toMatch(/Agatha|Tigris/);
        for (const p of places) expect(words.toLowerCase()).not.toContain(p);
        expect(words).not.toMatch(TIME_RE);
      }
    }
  });
});

describe("days and dates (Syros days, already calendar days)", () => {
  it("weekdays in each language, Greek with its accusative article", () => {
    // 2026-10-25 is the Sunday the clocks go back; 26-31 follow.
    const week = ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"];
    expect(week.map((d) => weekdayWord(d, "en"))).toEqual([
      "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
    ]);
    expect(week.map((d) => weekdayWord(d, "el"))).toEqual([
      "την Κυριακή", "τη Δευτέρα", "την Τρίτη", "την Τετάρτη", "την Πέμπτη", "την Παρασκευή", "το Σάββατο",
    ]);
    expect(week.map((d) => weekdayWord(d, "fr"))).toEqual([
      "dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi",
    ]);
  });

  it("dates: Greek genitive month, French 1er", () => {
    expect(dateWord("2026-10-03", "en")).toBe("3 October");
    expect(dateWord("2026-10-03", "el")).toBe("3 Οκτωβρίου");
    expect(dateWord("2026-05-21", "el")).toBe("21 Μαΐου");
    expect(dateWord("2026-10-03", "fr")).toBe("3 octobre");
    expect(dateWord("2026-08-01", "fr")).toBe("1er août");
    expect(dateWord("2026-12-31", "en")).toBe("31 December");
  });

  it("the pushes put the day in the sentence", () => {
    expect(newsText(KINDS[2]!, "el").body).toBe("Η γάτα Agatha εντοπίστηκε την Τρίτη");
    expect(newsText(KINDS[3]!, "el").body).toBe("Η γάτα Agatha εντοπίστηκε στις 3 Οκτωβρίου");
    expect(newsText(KINDS[2]!, "fr").body).toBe("Agatha : vu mardi");
    expect(newsText(KINDS[3]!, "fr").body).toBe("Agatha : vu le 3 octobre");
  });
});

describe("the evening round-up in each language", () => {
  const cases: string[][] = [["Agatha"], ["Agatha", "Milo"], ["Agatha", "Milo", "Bramble"], ["Agatha", "Milo", "Bramble", "Fig"]];

  it("English is unchanged", () => {
    expect(roundUpWords(cases[0]!, "en")).toEqual({ title: "Cats you follow", body: "Agatha was spotted again." });
    expect(roundUpWords(cases[1]!, "en").body).toBe("Agatha and Milo were spotted again.");
    expect(roundUpWords(cases[3]!, "en").body).toBe("Agatha and 3 other cats you follow were spotted again.");
  });

  it("one, two and many cats in Greek and French", () => {
    expect(roundUpWords(cases[0]!, "el")).toEqual({ title: "Γάτες που ακολουθείς", body: "Η γάτα Agatha εντοπίστηκε ξανά." });
    expect(roundUpWords(cases[1]!, "el").body).toBe("Οι γάτες Agatha και Milo εντοπίστηκαν ξανά.");
    expect(roundUpWords(cases[2]!, "el").body).toBe("Η γάτα Agatha και 2 ακόμα γάτες που ακολουθείς εντοπίστηκαν ξανά.");
    expect(roundUpWords(cases[0]!, "fr")).toEqual({ title: "Les chats que tu suis", body: "Agatha : vu à nouveau." });
    expect(roundUpWords(cases[1]!, "fr").body).toBe("Agatha et Milo ont été revus.");
    expect(roundUpWords(cases[2]!, "fr").body).toBe("Agatha et 2 autres chats que tu suis ont été revus.");
  });

  it("never a time, in any language", () => {
    for (const lang of NEWS_LANGUAGES) {
      for (const names of cases) {
        const { title, body } = roundUpWords(names, lang);
        expect(`${title} ${body}`).not.toMatch(TIME_RE);
        expect(body).toContain(names[0]);
      }
    }
  });
});
