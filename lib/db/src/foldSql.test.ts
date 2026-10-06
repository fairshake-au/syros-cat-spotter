import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { foldName } from "./fold";
import { foldNameSql } from "./foldSql";
import { SPACE_CLASS, STRIP_CLASS } from "./foldSqlClasses";

// SYC-101: the proof the data spine plan asks for (PR 3b's section, and the
// flag on SYC-101) — the SQL folding behind cats.normalised_name gives the
// same answer as foldName, run over the same inputs. Read-only: it only
// evaluates the expression, so it needs a connection and nothing else.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");
let c: pg.Client;

beforeAll(async () => {
  c = new pg.Client({ connectionString: baseUrl });
  await c.connect();
});

afterAll(async () => {
  await c.end();
});

async function sqlFold(inputs: string[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < inputs.length; i += 20_000) {
    const r = await c.query<{ f: string }>(
      `select ${foldNameSql("x")} as f
         from unnest($1::text[]) with ordinality t(x, n) order by n`,
      [inputs.slice(i, i + 20_000)],
    );
    out.push(...r.rows.map((row) => row.f));
  }
  return out;
}

/**
 * Code points (as `subject`) whose input folds differently in SQL and in
 * foldName, as "U+XXXX" labels.
 */
async function mismatches(
  subjects: string[],
  wrap: (ch: string) => string = (ch) => ch,
): Promise<string[]> {
  const inputs = subjects.map(wrap);
  const folded = await sqlFold(inputs);
  return subjects
    .filter((_, i) => folded[i] !== foldName(inputs[i]!))
    .map((ch) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase()}`)
    .filter((label) => !NEWER_THAN_THE_DATABASE.has(label));
}

// Where Postgres can't agree with Node, because its tables are older:
//  - six decompositions added in Unicode 16 (Todhri, Tulu-Tigalari), which
//    Postgres 16's own normalize() predates (everywhere: CI, Neon, locally);
//  - capital letters added in Unicode 14–17, which an older ICU doesn't
//    lower-case. Neon's ICU (collation version 153.14) is about Unicode 13;
//    this list is exactly what it leaves unlowered, read on 6 Oct 2026 from
//    the development branch. CI's and a newer local ICU know a subset.
// None is a Greek, Cyrillic or everyday Latin letter (the test below holds
// that). The cost if a name ever used one: the database's folded form keeps
// that capital, so it and its lower-case spelling count as two names. The
// app's own lookups fold in SQL too (foldedNameEquals), so they still find
// exactly what the unique index holds.
const NEWER_THAN_THE_DATABASE = new Set(
  [
    // Unicode 16 decompositions
    "105c9 105e4 11383 11385 1138e 11391",
    // Unicode 14–17 capitals, as Neon's ICU leaves them
    "1c89 2c2f a7c0 a7cb a7cc a7ce a7d0 a7d2 a7d4 a7d6 a7d8 a7da a7dc",
    "10570 10571 10572 10573 10574 10575 10576 10577 10578 10579 1057a 1057c",
    "1057d 1057e 1057f 10580 10581 10582 10583 10584 10585 10586 10587 10588",
    "10589 1058a 1058c 1058d 1058e 1058f 10590 10591 10592 10594 10595",
    "10d50 10d51 10d52 10d53 10d54 10d55 10d56 10d57 10d58 10d59 10d5a 10d5b",
    "10d5c 10d5d 10d5e 10d5f 10d60 10d61 10d62 10d63 10d64 10d65",
    "16ea0 16ea1 16ea2 16ea3 16ea4 16ea5 16ea6 16ea7 16ea8 16ea9 16eaa 16eab",
    "16eac 16ead 16eae 16eaf 16eb0 16eb1 16eb2 16eb3 16eb4 16eb5 16eb6 16eb7",
    "16eb8",
  ]
    .join(" ")
    .split(" ")
    .map((hex) => `U+${hex.toUpperCase()}`),
);

function codePoints(from: number, to: number): string[] {
  const out: string[] = [];
  for (let cp = from; cp <= to; cp++) {
    if (cp === 0 || (cp >= 0xd800 && cp <= 0xdfff)) continue;
    out.push(String.fromCodePoint(cp));
  }
  return out;
}

/** The ranges a JavaScript regex matches, written the way foldSqlClasses.ts is. */
function classFor(re: RegExp): string {
  const esc = (cp: number) =>
    cp > 0xffff
      ? `\\U${cp.toString(16).padStart(8, "0")}`
      : `\\u${cp.toString(16).padStart(4, "0")}`;
  let out = "";
  let start = -1;
  for (let cp = 0; cp <= 0x110000; cp++) {
    const hit = cp < 0x110000 && re.test(String.fromCodePoint(cp));
    if (hit && start < 0) start = cp;
    if (!hit && start >= 0) {
      out += start === cp - 1 ? esc(start) : `${esc(start)}-${esc(cp - 1)}`;
      start = -1;
    }
  }
  return out;
}

describe("foldNameSql agrees with foldName (SYC-101)", () => {
  it("uses exactly JavaScript's own mark, formatting and space classes", () => {
    // Fails after a Node upgrade brings a newer Unicode. Regenerate
    // foldSqlClasses.ts from classFor and ship the change in a new migration
    // (never by editing an applied one).
    expect(STRIP_CLASS).toBe(classFor(/^[\p{M}\p{Cf}]$/u));
    expect(SPACE_CLASS).toBe(classFor(/^\s$/u));
  });

  it("folds the named Greek and Latin cases exactly as foldName does", async () => {
    const names = [
      "ΜΙΜΗ",
      "Μιμή".normalize("NFC"),
      "Μιμή".normalize("NFD"),
      "ΜΙΜΉ",
      "ΣΟΦΊΑΣ",
      "Σοφίας",
      "ΟΔΟΣ ΣΟΦΙΑΣ",
      "Zoë",
      "Zoe",
      "ZOË".normalize("NFD"),
      "ΪΑΣΩΝ",
      "Ιάσων",
      "Ϊάσων",
      "ΐ",
      "VAPORIA — Eleni's",
      "  Μιμή  ",
      "Μιμή​",
      "Mimi  \t Cat",
      "‮Mimi‬",
      "İstanbul",
      "Straße",
      "ǅemal",
      "Ætna Çağla Øyvind Łucja Šárka",
      "AΓAΘH",
      "",
    ];
    const folded = await sqlFold(names);
    expect(folded).toEqual(names.map(foldName));
    // The cases Part 2g names, as the column will see them.
    expect(folded[0]).toBe(folded[1]);
    expect(folded[1]).toBe(folded[2]);
    expect(folded[4]).toBe(folded[5]);
    expect(folded[7]).toBe(folded[8]);
  });

  it("agrees on every Latin, Greek and Cyrillic letter, mark and punctuation sign", async () => {
    const inputs = [
      ...codePoints(0x0001, 0x052f), // Basic Latin … Cyrillic Supplement
      ...codePoints(0x1d00, 0x1fff), // Phonetic extensions, Latin and Greek Extended
      ...codePoints(0x2000, 0x206f), // General Punctuation
      ...codePoints(0x2c60, 0x2c7f), // Latin Extended-C
      ...codePoints(0xa720, 0xa7ff), // Latin Extended-D
      ...codePoints(0xfb00, 0xfb06), // Latin ligatures
      ...codePoints(0xfe00, 0xfe2f), // variation selectors, combining half marks
      ...codePoints(0xff00, 0xffef), // full-width forms
    ];
    expect(await mismatches(inputs)).toEqual([]);
    // Each also inside a name, so case-folding in context (final sigma) and
    // whitespace collapsing between letters are exercised, not just alone.
    expect(await mismatches(inputs, (ch) => `Σ${ch}Σ ${ch}`)).toEqual([]);
  });

  it("differs nowhere else, on any code point", async () => {
    expect(await mismatches(codePoints(1, 0x10ffff))).toEqual([]);
  }, 120_000);

  it("excuses no Greek, Cyrillic or everyday Latin letter", () => {
    // Everything below U+1C80 (Basic Latin to Cyrillic Extended-C, which
    // includes Latin-1, Latin Extended-A/B, Greek and Cyrillic) must agree.
    const early = [...NEWER_THAN_THE_DATABASE].filter(
      (label) => parseInt(label.slice(2), 16) < 0x1c80,
    );
    expect(early).toEqual([]);
  });
});
