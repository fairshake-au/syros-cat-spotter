/**
 * SYC-2 PR 2.1 (coat-markings-and-health.md §6.5, §9, §10.4, §10.6; plan
 * "PR 2.1" tests T-leak and T-rabies, invariant 1 item 1).
 *
 * A cat's colour and markings reach the public as two lists of codes and
 * nothing else; vaccinations and team notes never do, by name and by word.
 * Three cats, described by the team: two colours plus marks and a
 * vaccination and a team note; one colour; nothing at all. SYC-398 PR A2
 * (coat-colours-and-pattern.md §6) adds two: Brown · Ginger · Stripes, and
 * Brown alone, which has no old code.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { like } from "drizzle-orm";
import { catsTable, db, photosTable, pool } from "@workspace/db";
import { CatCoatItem, CatMarkingsItem } from "@workspace/api-zod";
import { writeObservation } from "../lib/observations";
import { COAT_COLOURS, COAT_PATTERNS, LEGACY_COAT_CODES, MARKS } from "../lib/appearance";
import app from "../app";

const PREFIX = "vitest-syc2-public-";
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const REPO = resolve(__dirname, "../../../..");

const cats: { described: number; oneColour: number; undescribed: number; brownGinger: number; brownAlone: number } = {
  described: 0,
  oneColour: 0,
  undescribed: 0,
  brownGinger: 0,
  brownAlone: 0,
};

async function seedCat(label: string): Promise<number> {
  const [photo] = await db
    .insert(photosTable)
    .values({ publicId: `${PREFIX}${label}`, data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  const [cat] = await db
    .insert(catsTable)
    .values({
      name: `${PREFIX}${label}`,
      description: "By the harbour steps",
      primaryPhotoId: photo!.id,
      lat: 37.4448,
      lng: 24.9425,
      discovererDeviceId: `${PREFIX}discoverer`,
    })
    .returning({ id: catsTable.id });
  return cat!.id;
}

async function cleanup() {
  // Observations are append-only (a trigger) and carry no foreign key.
  await db.delete(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  await db.delete(photosTable).where(like(photosTable.publicId, `${PREFIX}%`));
}

beforeAll(async () => {
  await cleanup();
  cats.described = await seedCat("described");
  cats.oneColour = await seedCat("one-colour");
  cats.undescribed = await seedCat("undescribed");
  cats.brownGinger = await seedCat("brown-ginger");
  cats.brownAlone = await seedCat("brown-alone");
  const staff = { accountId: "person:vitest-syc2-staff", roleAtTime: "staff", observedAt: new Date("2026-10-01T10:00:00Z") };
  const d = cats.described;
  // SYC-398: written as Ginger · Stripes, sent to older phones as the old
  // codes ginger · tabby (coat-colours-and-pattern.md §6).
  await writeObservation(db, { ...staff, catId: d, kind: "coat", value: { colours: ["ginger"], pattern: "stripes" } });
  await writeObservation(db, { ...staff, catId: d, kind: "markings", value: { marks: ["missing_eye", "white_paws"] } });
  await writeObservation(db, {
    ...staff,
    catId: d,
    kind: "vaccinated",
    value: { vaccines: ["rabies", "cat_flu_enteritis", { other: "feline leukaemia" }], clinic: "Ermoupoli" },
  });
  await writeObservation(db, { ...staff, catId: d, kind: "team_note", value: { text: "Rabies booster due; watch for enteritis" } });
  await writeObservation(db, { ...staff, catId: cats.oneColour, kind: "coat", value: { colours: ["black"] } });
  await writeObservation(db, {
    ...staff,
    catId: cats.brownGinger,
    kind: "coat",
    value: { colours: ["brown", "ginger"], pattern: "stripes" },
  });
  await writeObservation(db, { ...staff, catId: cats.brownAlone, kind: "coat", value: { colours: ["brown"] } });
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

/** Every key at every depth of a JSON value. */
function allKeys(v: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(v)) for (const x of v) allKeys(x, out);
  else if (v !== null && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      allKeys(x, out);
    }
  }
  return out;
}

/** The path of every `confidence` key, at every depth. */
function confidencePaths(v: unknown, at = "", out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x, i) => confidencePaths(x, `${at}[${i}]`, out));
  else if (v !== null && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (k === "confidence") out.push(`${at}.${k}`);
      confidencePaths(x, `${at}.${k}`, out);
    }
  }
  return out;
}

/** Keys that must never appear anywhere in a public cat response (spec §6.5,
 * §10.4). `confidence` is not here because `sterilised.confidence` is public
 * already (§10.4); inside the new fields it is ruled out by both being lists
 * of plain strings. */
const NEVER_PUBLIC = [
  "vaccinated",
  "vaccines",
  "vaccinations",
  "clinic",
  "team_note",
  "teamNote",
  "healthNotes",
  "checkReasons",
  "modelVersion",
  "supportingObservationIds",
  "conflicts",
  "asOf",
  // Who said it and how (review of PR 2.1, minor 1).
  "author",
  "accountId",
  "roleAtTime",
  "provenance",
  "observedAt",
  "voices",
];

/** A public cat's keys, exactly (CatWithStats, catHelpers.ts). A described
 * cat must carry no key an undescribed one lacks: the byte-for-byte
 * snapshots only see undescribed cats (review of PR 2.1, minor 1). */
const PUBLIC_CAT_KEYS = [
  "coat",
  "coatColours",
  "coatPattern",
  "description",
  "discovererNickname",
  "discovererSpotterCode",
  "discovererUsername",
  "hasHome",
  "homeDescription",
  "homePin",
  "id",
  "lastSeenAt",
  "lat",
  "lifeStatus",
  "lng",
  "locationCellM",
  "locationPrecision",
  "markings",
  "name",
  "notSeenSince",
  "ownerName",
  "photoUrl",
  "sightingsCount",
  "sterilised",
];

async function publicResponses(): Promise<{ list: Record<string, unknown>[]; details: Record<string, unknown>[]; texts: string[] }> {
  const listRes = await request(app).get("/api/cats?pageSize=200");
  expect(listRes.status).toBe(200);
  const ids = [cats.described, cats.oneColour, cats.undescribed, cats.brownGinger, cats.brownAlone];
  const list = (listRes.body.cats as Record<string, unknown>[]).filter((c) => ids.includes(c["id"] as number));
  expect(list).toHaveLength(ids.length);
  const texts = [listRes.text];
  const details: Record<string, unknown>[] = [];
  for (const id of ids) {
    const res = await request(app).get(`/api/cats/${id}`);
    expect(res.status).toBe(200);
    texts.push(res.text);
    details.push(res.body as Record<string, unknown>);
  }
  return { list, details, texts };
}

function sorted(v: unknown): unknown {
  return Array.isArray(v) ? [...v].sort() : v;
}

describe("T-leak (C6): colour and markings reach the public as two lists of codes, nothing else", () => {
  it("GET /cats and GET /cats/:id carry coat and markings as exactly a list of strings each", async () => {
    const { list, details } = await publicResponses();
    const fromList = new Map(list.map((c) => [c["id"] as number, c]));
    const fromDetail = new Map(details.map((d) => [(d["cat"] as { id: number }).id, d["cat"] as Record<string, unknown>]));
    for (const source of [fromList, fromDetail]) {
      for (const cat of source.values()) {
        for (const field of ["coat", "coatColours", "markings"]) {
          expect(Array.isArray(cat[field]), `${field} is a list`).toBe(true);
          expect((cat[field] as unknown[]).every((x) => typeof x === "string"), `${field} holds codes only`).toBe(true);
        }
        expect(cat["coatPattern"] === null || typeof cat["coatPattern"] === "string", "coatPattern is a code or null").toBe(true);
      }
      expect(sorted(source.get(cats.described)!["coat"])).toEqual(["ginger", "tabby"]);
      expect(sorted(source.get(cats.described)!["markings"])).toEqual(["missing_eye", "white_paws"]);
      expect(source.get(cats.oneColour)!["coat"]).toEqual(["black"]);
      expect(source.get(cats.oneColour)!["markings"]).toEqual([]);
      expect(source.get(cats.undescribed)!["coat"]).toEqual([]);
      expect(source.get(cats.undescribed)!["markings"]).toEqual([]);
    }
  });

  it("SYC-398 A2: the coat's two parts sit beside the old field, which is worked out from them (§6)", async () => {
    const { list, details } = await publicResponses();
    const fromList = new Map(list.map((c) => [c["id"] as number, c]));
    const fromDetail = new Map(details.map((d) => [(d["cat"] as { id: number }).id, d["cat"] as Record<string, unknown>]));
    for (const source of [fromList, fromDetail]) {
      const pick = (id: number) => {
        const c = source.get(id)!;
        return { coat: sorted(c["coat"]), coatColours: c["coatColours"], coatPattern: c["coatPattern"] };
      };
      expect(pick(cats.brownGinger)).toEqual({ coat: ["ginger", "tabby"], coatColours: ["brown", "ginger"], coatPattern: "stripes" });
      // Brown has no old code, and there are no stripes: older phones see nothing.
      expect(pick(cats.brownAlone)).toEqual({ coat: [], coatColours: ["brown"], coatPattern: null });
      expect(pick(cats.described)).toEqual({ coat: ["ginger", "tabby"], coatColours: ["ginger"], coatPattern: "stripes" });
      expect(pick(cats.oneColour)).toEqual({ coat: ["black"], coatColours: ["black"], coatPattern: null });
      expect(pick(cats.undescribed)).toEqual({ coat: [], coatColours: [], coatPattern: null });
    }
    // Right after `coat`, in that order, on the wire.
    for (const cat of [...list, ...details.map((d) => d["cat"] as Record<string, unknown>)]) {
      const keys = Object.keys(cat);
      expect(keys.slice(keys.indexOf("coat"), keys.indexOf("coat") + 3)).toEqual(["coat", "coatColours", "coatPattern"]);
    }
  });

  it("SYC-443: the public never gets a team word: the coat fields only ever hold §2's codes (§15.5)", async () => {
    // Field by field, not a search of the whole payload: the old `coat`
    // legitimately holds "tabby", and a cat can be named "Calico".
    const { list, details } = await publicResponses();
    const all = [...list, ...details.map((d) => d["cat"] as Record<string, unknown>)];
    expect(all).toHaveLength(10);
    const legacy = LEGACY_COAT_CODES.filter((c) => c !== "not_sure") as readonly string[];
    for (const cat of all) {
      const name = String(cat["name"]);
      for (const c of cat["coatColours"] as unknown[]) expect(COAT_COLOURS as readonly unknown[], name).toContain(c);
      expect([...COAT_PATTERNS, null] as unknown[], name).toContain(cat["coatPattern"]);
      for (const c of cat["coat"] as unknown[]) expect(legacy, name).toContain(c);
    }
    // The striped cats really are striped, so a team word would have shown here.
    const striped = all.filter((c) => c["coatPattern"] === "stripes");
    expect(striped.length).toBeGreaterThanOrEqual(4);
  });

  it("a described cat carries exactly the public cat's keys, in the list and on its page", async () => {
    const { list, details } = await publicResponses();
    const cats = [...list, ...details.map((d) => d["cat"] as Record<string, unknown>)];
    expect(cats).toHaveLength(10);
    for (const cat of cats) {
      expect(Object.keys(cat).sort(), String(cat["name"])).toEqual(PUBLIC_CAT_KEYS);
      expect(Object.keys(cat["sterilised"] as object).sort()).toEqual(["clippedTipSightings", "confidence", "value"]);
    }
  });

  it("no vaccination, note, confidence-ladder or check key appears anywhere in either response", async () => {
    const { texts } = await publicResponses();
    for (const text of texts) {
      const keys = allKeys(JSON.parse(text));
      expect(NEVER_PUBLIC.filter((k) => keys.has(k))).toEqual([]);
      // SYC-398 A2: the only public confidence is the sterilised line's;
      // the coat's parts are values only (§6).
      expect(confidencePaths(JSON.parse(text)).filter((p) => !p.endsWith("sterilised.confidence"))).toEqual([]);
    }
  });
});

/** Lower-cased with accents removed, so "Λύσσα" and "λυσσα" both match. */
function plain(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Spec §6.3, §9: no public string names a vaccine, in any language. */
const VACCINE_WORDS: RegExp[] = [
  /rabies/,
  /cat[\s_-]?flu/,
  /enteritis/,
  /λυσσα/,
  /γριπη/,
  /εντεριτιδα/,
  /(^|[^\p{L}])rage([^\p{L}]|$)/u,
  /coryza/,
  /typhus/,
  /enterite/,
  /panleucopenie/,
];

function vaccineWordsIn(text: string): string[] {
  const p = plain(text);
  return VACCINE_WORDS.filter((re) => re.test(p)).map(String);
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe("T-rabies: no vaccine is named in any public payload, app string or generated client", () => {
  it("GET /cats and GET /cats/:id, for a cat with every vaccine and a note recorded", async () => {
    const { texts } = await publicResponses();
    for (const text of texts) {
      expect(vaccineWordsIn(text)).toEqual([]);
      // The free text seeded above: a typed vaccine name, the clinic and the
      // team note's words (review of PR 2.1, minor 2).
      expect(plain(text)).not.toMatch(/leukaemia|ermoupoli|booster|watch for/);
    }
  });

  it("the patterns catch the words, in every language", () => {
    for (const sample of ["Rabies", "cat_flu_enteritis", "Λύσσα", "Γρίπη των γατών", "Εντερίτιδα", "la rage", "Typhus", "entérite"]) {
      expect(vaccineWordsIn(sample), sample).not.toEqual([]);
    }
    for (const sample of ["garage", "courage", "Ermoupoli"]) {
      expect(vaccineWordsIn(sample), sample).toEqual([]);
    }
  });

  it("the app's strings (cat-spotter/lib/i18n.ts) name no vaccine", () => {
    const src = readFileSync(join(REPO, "artifacts/cat-spotter/lib/i18n.ts"), "utf8");
    expect(vaccineWordsIn(src)).toEqual([]);
  });

  it("the generated client and zod types name no vaccine", () => {
    const files = [
      ...filesUnder(join(REPO, "lib/api-client-react/src/generated")),
      ...filesUnder(join(REPO, "lib/api-zod/src/generated")),
    ];
    expect(files.length).toBeGreaterThan(2);
    for (const f of files) expect(vaccineWordsIn(readFileSync(f, "utf8")), f).toEqual([]);
  });
});

describe("T-words, server half: the public enums are the vocabulary", () => {
  it("the Cat schema's coat codes are the seven old public codes, LEGACY_COAT_CODES without not_sure ([] is not known)", () => {
    expect(Object.values(CatCoatItem)).toEqual(LEGACY_COAT_CODES.filter((c) => c !== "not_sure"));
  });

  it("the Cat schema's markings codes are MARKS, in order", () => {
    expect(Object.values(CatMarkingsItem)).toEqual([...MARKS]);
  });
});
