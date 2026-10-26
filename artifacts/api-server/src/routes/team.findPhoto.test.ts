import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { and, like, sql } from "drizzle-orm";
import { catsTable, db, photosTable, pool } from "@workspace/db";

// SYC-396 PR 2.5, Task 2.5.2: the Find-from-a-photo page, its upload and its
// daily caps. The matching service is mocked in every test (no real call is
// ever made). The caps are proved with a few requests: the counts are filled
// straight through the limiter, never by firing 20 or 100 requests.

const spies = vi.hoisted(() => ({ logLines: [] as string[] }));
vi.mock("../lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/logger")>();
  const { default: pino } = await import("pino");
  const logger = pino(
    { level: "trace", redact: actual.REDACT_PATHS, serializers: actual.LOG_SERIALIZERS },
    { write: (line: string) => void spies.logLines.push(line) },
  );
  return { ...actual, logger };
});
vi.mock("../lib/matching", () => ({ matchCatPhoto: vi.fn() }));
// SYC-527 piece 3: the model is mocked; a fingerprint is made from a photo's colour.
vi.mock("../lib/fingerprint/model", async (orig) => {
  const real = (await orig()) as typeof import("../lib/fingerprint/model");
  return { ...real, fingerprintOf: vi.fn() };
});
// The island test seam (SYC-527 piece 1): with no area and no colony the real
// list would return every cat on the shared test database, so "the island" is
// narrowed to this file's own island cats (names starting with ISLE).
vi.mock("../lib/teamCatList", async (orig) => {
  const real = (await orig()) as typeof import("../lib/teamCatList");
  return {
    ...real,
    allTeamCats: vi.fn(async (f: Parameters<typeof real.allTeamCats>[0], now?: Date) => {
      const out = await real.allTeamCats(f, now);
      if (f.area !== undefined || f.colony !== undefined) return out;
      const cats = out.cats.filter((c) => c.name.startsWith(ISLE));
      return { ...out, cats, catCount: cats.length };
    }),
  };
});

import app from "../app";
import { matchCatPhoto, type CandidateInput } from "../lib/matching";
import { DIMENSIONS, fingerprintOf } from "../lib/fingerprint/model";
import { __fillClock } from "../lib/fingerprint";
import { FIND_SHORTLIST_K } from "../lib/findFromPhoto";
import { TEAM_ORIGIN, clearWelfareTables, seedReport } from "../lib/teamAuth/__fixtures__/queueKit";
import {
  _resetFindLimitsForTests,
  checkFindLimits,
  FIND_PHOTO_PERSON_LIMIT,
  FIND_PHOTO_TEAM_LIMIT,
  findPersonHits,
  findTeamHits,
} from "../middlewares/rateLimit";
import {
  INDEX_DOWN_WORDS,
  LESS_SURE,
  LESS_SURE_SHORTLIST,
  lessSureShortlist,
  noCloseMatchShortlist,
  leftOutWords,
  NO_CLOSE_MATCH_SHORTLIST,
  SHORTLIST_EXPLAINER,
  shortlistResultsLine,
  MATCHING_DOWN_WORDS,
  PERSON_CAP_WORDS,
  STALE_PLACE_WORDS,
  TEAM_CAP_WORDS,
  TOO_BIG_WORDS,
  WHERE_HINT,
  WHERE_HINT_SHORT,
} from "../lib/teamPages/findPhotoPage";
import { areaFor, currentAreas } from "../lib/areas/namedAreas";
import { guardianOn, newColony, putInColony, RUN, signedPerson, type Signed } from "../test/roleKit";
import { assetUrl } from "../lib/teamAssets";
import { PHOTO_CSP, STRICT_CSP, WIDE_CSP } from "../test/wideCsp";

const KEY = "vitest-find-key-0123456789abcdef-0123456789";
const PREFIX = `vt-findroute-${RUN}-`;
// The island's own scope: only cats named with ISLE are "the island" in the seam above.
const ISLE = `${PREFIX}isle-`;
const matchMock = vi.mocked(matchCatPhoto);
const fingerprintMock = vi.mocked(fingerprintOf);
const html = (t: string) => t.replace(/'/g, "&#39;");

/** A fingerprint read from a photo's red: photos with near reds are close. */
async function vecFromRed(bytes: Buffer): Promise<Float32Array> {
  const red = Math.round((await sharp(bytes).stats()).channels[0]!.mean);
  const v = new Float32Array(DIMENSIONS);
  let sum = 0;
  for (let j = 0; j < DIMENSIONS; j++) {
    v[j] = Math.exp(-Math.abs(j - red) / 12);
    sum += v[j]! * v[j]!;
  }
  for (let j = 0; j < DIMENSIONS; j++) v[j] = v[j]! / Math.sqrt(sum);
  return v;
}

let guardian: Signed;
let colony: number;
let bigColony: number;
let photoBytes: Buffer;
let catIds: number[] = [];
let n = 0;

async function jpeg(colour: string, size = 64): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 3, background: colour } }).jpeg().toBuffer();
}

async function catIn(colonyId: number, photoId: number): Promise<number> {
  const [c] = await db
    .insert(catsTable)
    .values({ name: `${PREFIX}${n++}`, primaryPhotoId: photoId, lat: 37.4447, lng: 24.9417, discovererDeviceId: `${PREFIX}d` })
    .returning({ id: catsTable.id });
  await putInColony(c!.id, colonyId);
  return c!.id;
}

/** `count` island cats (no colony, no area), deleted after each test. */
async function island(count: number): Promise<void> {
  const [p] = await db.select({ id: photosTable.id }).from(photosTable).where(like(photosTable.publicId, `${PREFIX}p`));
  await db.insert(catsTable).values(
    Array.from({ length: count }, () => ({
      name: `${ISLE}${n++}`,
      primaryPhotoId: p!.id,
      lat: 37.4447,
      lng: 24.9417,
      discovererDeviceId: `${PREFIX}d`,
    })),
  );
}

afterEach(async () => {
  __fillClock.now = () => Date.now();
  await db.delete(catsTable).where(like(catsTable.name, `${ISLE}%`));
});

/** `count` island cats with a photo each (so the fill has `count` photos to make). */
async function islandDistinct(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const [p] = await db
      .insert(photosTable)
      .values({
        publicId: `${PREFIX}d${n++}`,
        data: (await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10 + 6 * i, g: 90, b: 60 } } }).jpeg().toBuffer()).toString("base64"),
        mime: "image/jpeg",
      })
      .returning({ id: photosTable.id });
    await db.insert(catsTable).values({
      name: `${ISLE}${n++}`,
      primaryPhotoId: p!.id,
      lat: 37.4447,
      lng: 24.9417,
      discovererDeviceId: `${PREFIX}d`,
    });
  }
}

/** A team member of their own, so every test starts with its own 20. */
const teamMember = (label: string) => signedPerson(`find-${label}-${n++}`, ["staff"]);

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `${PREFIX}p`, data: (await jpeg("#336699")).toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  colony = await newColony("find route");
  for (let i = 0; i < 3; i++) catIds.push(await catIn(colony, p!.id));
  bigColony = await newColony("find route big");
  for (let i = 0; i < 31; i++) await catIn(bigColony, p!.id);
  guardian = await guardianOn("find-guardian", [colony]);
  photoBytes = await jpeg("#aa5500", 200);
});

beforeEach(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  spies.logLines.length = 0;
  fingerprintMock.mockReset();
  fingerprintMock.mockImplementation(vecFromRed);
  matchMock.mockReset();
  matchMock.mockImplementation(async (_p, candidates: CandidateInput[]) => ({
    isCatPhoto: true,
    matches: candidates.map((c, i) => ({ catId: c.catId, confidence: [0.9, 0.6, 0.2][i] ?? 0.1, reasoning: `same ear ${i}` })),
  }));
  await _resetFindLimitsForTests();
});

afterAll(async () => {
  await _resetFindLimitsForTests();
  await clearWelfareTables();
  await db.delete(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  await db.delete(photosTable).where(
    and(
      like(photosTable.publicId, `${PREFIX}%`),
      sql`not exists (select 1 from photo_visibility_events e where e.photo_id = ${photosTable.id})`,
    ),
  );
  await pool.end();
});

const form = (cookie: string, query = "") =>
  request(app).get(`/api/team/cats/find${query}`).set("Cookie", cookie).set("Accept", "text/html");

/** The multipart search, as the page's form sends it. */
function search(
  cookie: string,
  fields: Record<string, string | string[]>,
  file: { bytes: Buffer; name?: string } | null = { bytes: photoBytes },
) {
  let r = request(app).post("/api/team/cats/find").set("Origin", TEAM_ORIGIN).set("Cookie", cookie).set("Accept", "text/html");
  for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) r = r.field(k, one);
  if (file) r = r.attach("photo", file.bytes, { filename: file.name ?? "cat.jpg", contentType: "image/jpeg" });
  return r;
}

describe("who may", () => {
  it("a cat guardian gets the 403 for the island too", async () => {
    expect((await form(guardian.cookie)).status).toBe(403);
    expect((await search(guardian.cookie, {})).status).toBe(403);
    expect(matchMock).not.toHaveBeenCalled();
  });

  it("a cat guardian gets the 403, for the form and the search", async () => {
    expect((await form(guardian.cookie, `?colony=${colony}`)).status).toBe(403);
    expect((await search(guardian.cookie, { colony: String(colony) })).status).toBe(403);
    expect(matchMock).not.toHaveBeenCalled();
  });

  it("a search from another site is refused before anything is read", async () => {
    const team = await teamMember("origin");
    const res = await request(app)
      .post("/api/team/cats/find")
      .set("Origin", "https://evil.example")
      .set("Cookie", team.cookie)
      .attach("photo", photoBytes, "cat.jpg")
      .field("colony", String(colony));
    expect(res.status).toBe(401);
    expect(matchMock).not.toHaveBeenCalled();
  });
});

describe("the form", () => {
  it("the Cats page links to it, carrying the colours and the place chosen there", async () => {
    const team = await teamMember("entry");
    const res = await request(app)
      .get(`/api/team/cats?colours=black&colony=${colony}&sterilised=not_known`)
      .set("Cookie", team.cookie)
      .set("Accept", "text/html");
    // Only the three narrowing filters travel: not "Sterilised".
    expect(res.text).toContain(`<a class="findentrylink" href="/api/team/cats/find?colours=black&amp;colony=${colony}">Find from a photo</a>`);
  });

  it("opens with one line and a jump link to the photo (SYC-619 §9.4)", async () => {
    const team = await teamMember("intro");
    const res = await form(team.cookie, `?colony=${colony}`);
    expect(res.text).toContain("Use this when you have a photo of a cat and want to know whether it&#39;s already in the app.");
    expect(res.text).toContain(
      '<p class="hint">Always check the photos yourself before choosing a cat. <a href="#find-photo">Go to the photo</a></p>',
    );
    expect(res.text).not.toContain("Compare a photo, for example");
    expect(res.text).toContain('id="find-photo"');
  });

  it("counts the cats a colony leaves, and offers the photo form", async () => {
    const team = await teamMember("form");
    const res = await form(team.cookie, `?colony=${colony}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("3 cats to compare");
    expect(res.text).toContain('enctype="multipart/form-data"');
    expect(res.text).toContain(`<input type="hidden" name="colony" value="${colony}">`);
    // SYC-522: the form alone carries find-photo.js, which locks the button once
    // the search starts (one tap, one search); with no script it is a plain POST.
    expect(res.headers["content-security-policy"]).toBe(WIDE_CSP);
    expect([...res.text.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1])).toEqual([assetUrl("find-photo.js")]);
    expect(res.text).toContain('<p class="hint" id="find-progress" role="status" hidden>');
    expect(res.text).toContain('<form class="findphoto" method="post"');
  });

  it("over 30 cats in a colony, the form says what the shortlist does and offers the photo form", async () => {
    const team = await teamMember("over");
    const res = await form(team.cookie, `?colony=${bigColony}`);
    expect(res.text).toMatch(/31 cats in [^<]+\./);
    expect(html(res.text)).toContain(html(SHORTLIST_EXPLAINER));
    expect(res.text).not.toContain("That's too many");
    expect(res.text).toContain('type="file"');
  });

  it("with no place, the form counts the island's cats and offers the photo form", async () => {
    await island(12);
    const team = await teamMember("noplace");
    const res = await form(team.cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<option value="" selected>Anywhere on the island</option>');
    expect(res.text).toContain("12 cats to compare across the island");
    expect(res.text).toContain(WHERE_HINT);
    expect(res.text).toContain("compares every cat");
    expect(res.text).toContain("Compare with 12 cats");
    expect(res.text).toContain('type="file"');
  });

  it("arriving with an area keeps that area chosen, not Anywhere", async () => {
    const area = currentAreas()[0]!;
    const team = await teamMember("area");
    const res = await form(team.cookie, `?area=${encodeURIComponent(area.key)}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`<option value="${area.key}" selected>`);
    expect(res.text).toContain('<option value="">Anywhere on the island</option>');
    expect(res.text).not.toContain("selected>Anywhere on the island");
  });

  it("over 30 island cats, the form gives §9.2's words and offers the photo form", async () => {
    await island(31);
    const team = await teamMember("isleover");
    const res = await form(team.cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("31 cats on the island.");
    expect(html(res.text)).toContain(html(SHORTLIST_EXPLAINER));
    expect(SHORTLIST_EXPLAINER).toBe(
      `The app picks the ${FIND_SHORTLIST_K} whose photos look most like yours, then compares those closely. This can take up to a minute.`,
    );
    expect(res.text).toContain('type="file"');
    expect(res.text).not.toContain("too many");
    expect(res.text).toContain(WHERE_HINT_SHORT);
    expect(WHERE_HINT_SHORT).toBe("If you know where the photo was taken, choosing the area is surer.");
    expect(res.text).not.toContain("compares every cat");
    expect(res.text).not.toContain(WHERE_HINT);
  });

  it("a large area counts its own cats with the same words, naming the area", async () => {
    const team = await teamMember("placeover");
    const area = areaFor(37.4447, 24.9417);
    const res = await form(team.cookie, `?area=${encodeURIComponent(area.key)}`);
    expect(res.status).toBe(200);
    expect(html(res.text)).toMatch(new RegExp(`\\d+ cats in ${html(area.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`));
    expect(html(res.text)).toContain(html(SHORTLIST_EXPLAINER));
    expect(res.text).toContain('type="file"');
  });

  it("a colony chosen alone shows its own count, not the island's wording", async () => {
    const team = await teamMember("colonyalone");
    const res = await form(team.cookie, `?colony=${colony}`);
    expect(res.text).toContain("3 cats to compare");
    expect(res.text).not.toContain("across the island");
    expect(res.text).not.toContain("selected>Anywhere on the island");
    expect(res.text).toContain('<option value="">Any area</option>');
    expect(res.text).not.toContain("Anywhere on the island");
    expect(res.text).not.toContain(WHERE_HINT);
  });

  it("an empty area and colony in the address is the island", async () => {
    await island(12);
    const team = await teamMember("emptyplace");
    const res = await form(team.cookie, "?area=&colony=");
    expect(res.status).toBe(200);
    expect(res.text).toContain('<option value="" selected>Anywhere on the island</option>');
    expect(res.text).toContain("12 cats to compare across the island");
    expect(res.text).not.toContain(STALE_PLACE_WORDS);
  });

  it("an island over 30 cats, narrowed by colour to 30 or fewer, counts and offers the photo form", async () => {
    await island(31);
    const [p] = await db.select({ id: photosTable.id }).from(photosTable).where(like(photosTable.publicId, `${PREFIX}p`));
    const rows = await db.select({ id: catsTable.id }).from(catsTable).where(like(catsTable.name, `${ISLE}%`));
    const { observationsTable } = await import("@workspace/db");
    expect(p).toBeDefined();
    for (const r of rows.slice(0, 5)) {
      await db.insert(observationsTable).values({
        catId: r.id,
        kind: "coat",
        value: { colours: ["ginger"] } as never,
        deviceId: `${PREFIX}d`,
        roleAtTime: "staff",
        observedAt: new Date(Date.now() - 40 * 86400_000),
      });
    }
    const team = await teamMember("isleColour");
    const res = await form(team.cookie, "?colours=ginger");
    expect(res.text).toContain("5 cats to compare across the island");
    expect(res.text).toContain('type="file"');
  });

  it("an area or colony that isn't recognised is refused, never read as the island", async () => {
    await island(12);
    const team = await teamMember("stale");
    for (const query of ["?area=no-such-area", "?colony=999999999"]) {
      const res = await form(team.cookie, query);
      expect(res.status, query).toBe(200);
      expect(res.text, query).toContain(STALE_PLACE_WORDS.replace("isn't", "isn&#39;t"));
      expect(res.text, query).toContain('id="place-error"');
      expect(res.text, query).not.toContain('type="file"');
      expect(res.text, query).not.toContain("selected>Anywhere on the island");
    }
  });

  it("the island form's address carries nothing new", async () => {
    const team = await teamMember("isleaddr");
    const res = await form(team.cookie);
    const getForm = /<form class="findwhere" method="get"[\s\S]*?<\/form>/.exec(res.text)![0];
    const names = [...getForm.matchAll(/<(?:input|select)\b[^>]*\bname="([^"]+)"/g)].map((m) => m[1]);
    expect([...new Set(names)].sort()).toEqual(["area", "colony", "colours"]);
    expect(getForm).toContain('<option value="" selected>Anywhere on the island</option>');
    // An empty area is dropped from the address by the page's own filters.
    const { filtersToQuery } = await import("../lib/teamCatFilters");
    expect(filtersToQuery({ area: undefined, colony: undefined, colours: undefined })).toBe("");
  });

  it("the narrowing form is a GET with no file field, so no file name can reach an address", async () => {
    const team = await teamMember("get");
    const res = await form(team.cookie, `?colony=${colony}`);
    const getForm = /<form class="findwhere" method="get"[\s\S]*?<\/form>/.exec(res.text)![0];
    expect(getForm).not.toContain('type="file"');
  });
});

describe("the search", () => {
  it("shows the closest cats in bands, with the plain warning, and keeps no address", async () => {
    const team = await teamMember("results");
    const res = await search(team.cookie, { colony: String(colony) });
    expect(res.status).toBe(200);
    expect(res.text).toContain(LESS_SURE.replace("app's", "app&#39;s"));
    expect(res.text).toContain("Very likely");
    expect(res.text).toContain("Possible");
    expect(res.text).toMatch(/<details class="unlikely"><summary>Show unlikely matches \(1\)<\/summary>/);
    expect(res.text).toContain("Compared with 3 cats");
    // SYC-491: the results answer alone allows data: pictures, for the team's own photo.
    expect(res.headers["content-security-policy"]).toBe(PHOTO_CSP);
    expect(res.text).not.toContain("<script");
    expect(res.headers["location"]).toBeUndefined();
    expect(matchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the team's photo beside the matches: 640px at most, with no EXIF, and not the upload's bytes", async () => {
    const team = await teamMember("preview");
    const withGps = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#aa5500" } })
      .jpeg()
      .withMetadata({
        exif: {
          IFD0: { Copyright: "vitest fixture" },
          GPS: { GPSLatitudeRef: "N", GPSLatitude: "37/1 26/1 24/1", GPSLongitudeRef: "E", GPSLongitude: "24/1 56/1 0/1" },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      })
      .toBuffer();
    expect((await sharp(withGps).metadata()).exif).toBeDefined();
    const res = await search(team.cookie, { colony: String(colony) }, { bytes: withGps });
    const m = /<img src="data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})" alt="Your photo"/.exec(res.text);
    expect(m).not.toBeNull();
    const shown = Buffer.from(m![1]!, "base64");
    const meta = await sharp(shown).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBeLessThanOrEqual(640);
    expect(m![1]).not.toBe(withGps.toString("base64"));
    // Exactly one data: picture, and never in a log line.
    expect(res.text.match(/data:image/g)).toHaveLength(1);
    for (const line of spies.logLines) expect(line).not.toContain(m![1]!.slice(0, 200));
  });

  it("every answer but the results keeps the strict header, with no data: pictures", async () => {
    const team = await teamMember("strict");
    matchMock.mockResolvedValue({ isCatPhoto: false, matches: [] });
    const notCat = await search(team.cookie, { colony: String(colony) });
    expect(notCat.status).toBe(422);
    expect(notCat.headers["content-security-policy"]).toBe(STRICT_CSP);
    const big = await search(team.cookie, { colony: String(colony) }, { bytes: Buffer.alloc(10 * 1024 * 1024 + 1, 1) });
    expect(big.headers["content-security-policy"]).toBe(STRICT_CSP);
    // The form itself is the one 200 that loads find-photo.js (SYC-522).
    const page = await form(team.cookie, `?colony=${colony}`);
    expect(page.headers["content-security-policy"]).toBe(WIDE_CSP);
    for (const r of [notCat, big, page]) expect(r.text).not.toContain("data:image");
  });

  it("cats with no photo to compare say so, and use no search (review finding 2)", async () => {
    const team = await teamMember("nophotos");
    const blank = await newColony("find route no photos");
    const [p] = await db
      .insert(photosTable)
      .values({ publicId: `${PREFIX}unreadable`, data: Buffer.from("not an image").toString("base64"), mime: "image/jpeg" })
      .returning({ id: photosTable.id });
    await catIn(blank, p!.id);
    const res = await search(team.cookie, { colony: String(blank) });
    expect(res.status).toBe(422);
    expect(res.text).toContain("None of these cats has a photo to compare with. No search was used.");
    expect(matchMock).not.toHaveBeenCalled();
    expect(await findTeamHits()).toBe(0);
    expect(await findPersonHits(team.id)).toBe(0);
  });

  it("a search with no place compares the island's cats", async () => {
    await island(12);
    const team = await teamMember("isle");
    const res = await search(team.cookie, {});
    expect(res.status).toBe(200);
    expect(res.text).toContain("Compared with 12 cats");
    expect(res.text).toContain("Very likely");
    expect(matchMock).toHaveBeenCalled();
  });

  it("a search with an unrecognised area or colony is refused, uses no search, and doesn't read it as the island", async () => {
    await island(12);
    const team = await teamMember("stalepost");
    const stale: Record<string, string>[] = [{ area: "no-such-area" }, { colony: "999999999" }];
    for (const fields of stale) {
      const res = await search(team.cookie, fields);
      expect(res.status).toBe(400);
      expect(res.text).toContain(STALE_PLACE_WORDS.replace("isn't", "isn&#39;t"));
      expect(res.headers["content-security-policy"]).toBe(STRICT_CSP);
    }
    expect(matchMock).not.toHaveBeenCalled();
    expect(await findTeamHits()).toBe(0);
    expect(await findPersonHits(team.id)).toBe(0);
  });

  it("a place in the POST's address is refused, never ignored", async () => {
    await island(12);
    const team = await teamMember("addr");
    const area = currentAreas()[0]!.key;
    for (const q of ["?area=nope", `?area=${area}`, `?colony=${colony}`, "?colony=999999999"]) {
      const res = await request(app)
        .post(`/api/team/cats/find${q}`)
        .set("Origin", TEAM_ORIGIN)
        .set("Cookie", team.cookie)
        .set("Accept", "text/html")
        .attach("photo", photoBytes, { filename: "cat.jpg", contentType: "image/jpeg" });
      expect(res.status, q).toBe(400);
      expect(res.text, q).toContain(STALE_PLACE_WORDS.replace("isn't", "isn&#39;t"));
    }
    expect(matchMock).not.toHaveBeenCalled();
    expect(await findTeamHits()).toBe(0);
    expect(await findPersonHits(team.id)).toBe(0);
  });

  it("a place written as area[] or colony[] is a stale place, on the form and the search", async () => {
    await island(12);
    const team = await teamMember("brackets");
    const page = await form(team.cookie, "?area[]=x");
    expect(page.text).toContain(STALE_PLACE_WORDS.replace("isn't", "isn&#39;t"));
    expect(page.text).not.toContain('type="file"');
    const res = await search(team.cookie, { "colony[]": "1" });
    expect(res.status).toBe(400);
    expect(res.text).toContain(STALE_PLACE_WORDS.replace("isn't", "isn&#39;t"));
    expect(matchMock).not.toHaveBeenCalled();
    expect(await findTeamHits()).toBe(0);
  });

  it("every odd way of giving a place is refused: 400, no count, no search", async () => {
    await island(12);
    const team = await teamMember("odd");
    const good = currentAreas()[0]!.key;
    const cases: Record<string, string | string[]>[] = [
      { area: [good, good] },
      { area: [good, "nope"] },
      { area: "   " },
      { colony: "0" },
      { colony: "-1" },
      { colony: "1e3" },
      { colony: [String(colony), String(colony)] },
    ];
    for (const fields of cases) {
      const res = await search(team.cookie, fields);
      expect([JSON.stringify(fields), res.status]).toEqual([JSON.stringify(fields), 400]);
      expect(res.text, JSON.stringify(fields)).toContain(STALE_PLACE_WORDS.replace("isn't", "isn&#39;t"));
    }
    expect(matchMock).not.toHaveBeenCalled();
    expect(await findTeamHits()).toBe(0);
    expect(await findPersonHits(team.id)).toBe(0);
  });

  it("an unrecognised area with a file over 10 MB is still 413, and still not read as the island", async () => {
    await island(12);
    const team = await teamMember("stalebig");
    const res = await search(team.cookie, { area: "no-such-area" }, { bytes: Buffer.alloc(10 * 1024 * 1024 + 1, 1) });
    expect(res.status).toBe(413);
    expect(res.text).toContain(STALE_PLACE_WORDS.replace("isn't", "isn&#39;t"));
    expect(res.text).not.toContain("across the island");
    expect(res.text).not.toContain('type="file"');
    expect(matchMock).not.toHaveBeenCalled();
    expect(await findTeamHits()).toBe(0);
    expect(await findPersonHits(team.id)).toBe(0);
  });

  it("with only a tie, the search is the island and ties the report", async () => {
    await island(12);
    const team = await teamMember("tieisle");
    const report = await seedReport();
    const page = await form(team.cookie, `?tie=${report.publicId}`);
    expect(page.text).toContain(`<input type="hidden" name="tie" value="${report.publicId}">`);
    expect(page.text).toContain('type="file"');
    const res = await search(team.cookie, { tie: report.publicId });
    expect(res.status).toBe(200);
    expect(res.text).toContain("across the island");
    expect(res.text).toContain("This is the cat");
    expect(res.text).toContain(`<form method="post" action="/api/team/reports/${report.publicId}/cat">`);
  });

  it("over 30 island cats, a search uses the shortlist: 3 calls, §9.3's words, #252's header rules", async () => {
    await islandDistinct(31);
    const team = await teamMember("isleoversearch");
    const res = await search(team.cookie, {});
    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toBe(PHOTO_CSP);
    expect(html(res.text)).toContain(html(shortlistResultsLine(31)));
    expect(shortlistResultsLine(31)).toBe(`Compared closely with the ${FIND_SHORTLIST_K} of 31 cats whose photos look most like yours`);
    expect(html(res.text)).toContain(html(LESS_SURE_SHORTLIST));
    expect(res.text).not.toContain(html(LESS_SURE));
    expect(res.text).not.toContain("newer cat");
    expect(matchMock).toHaveBeenCalledTimes(3);
    expect(await findTeamHits()).toBe(1);
    expect(await findPersonHits(team.id)).toBe(1);
  });

  it("a colony over 30 uses the shortlist too, and #252's words stay for 30 or fewer", async () => {
    const team = await teamMember("toomany");
    const res = await search(team.cookie, { colony: String(bigColony) });
    expect(res.status).toBe(200);
    expect(html(res.text)).toContain(html(shortlistResultsLine(31)));
    const small = await search(team.cookie, { colony: String(colony) });
    expect(small.text).toContain("Compared with 3 cats");
    expect(small.text).not.toContain("Compared closely");
    expect(html(small.text)).toContain(html(LESS_SURE));
  });

  it("the index down gives §9.4's words and uses no search, for the island and for a large area", async () => {
    await islandDistinct(31);
    const team = await teamMember("indexdown");
    fingerprintMock.mockRejectedValue(new Error("the model is not available"));
    for (const fields of [{}, { colony: String(bigColony) }] as Record<string, string>[]) {
      const res = await search(team.cookie, fields);
      expect([JSON.stringify(fields), res.status]).toEqual([JSON.stringify(fields), 503]);
      expect(res.text).toContain(html(INDEX_DOWN_WORDS));
      expect(INDEX_DOWN_WORDS).toBe("Searching the whole island isn't working right now. Choose an area or a colony to search without it.");
      expect(res.headers["content-security-policy"]).toBe(STRICT_CSP);
    }
    expect(matchMock).not.toHaveBeenCalled();
    expect(await findTeamHits()).toBe(0);
    expect(await findPersonHits(team.id)).toBe(0);
  });

  it("cats whose photos weren't fingerprinted in time are counted on the results page", async () => {
    await islandDistinct(31);
    let t = 0;
    __fillClock.now = () => (t += 1000);
    const team = await teamMember("leftout");
    const res = await search(team.cookie, {});
    expect(res.status).toBe(200);
    expect(res.text).toContain(html(leftOutWords(17)));
    expect(leftOutWords(17)).toBe("17 newer cats weren't included this time. Choose an area to include them.");
    expect(leftOutWords(1)).toBe("1 newer cat wasn't included this time. Choose an area to include them.");
  });

  it("with fewer fingerprinted cats than the shortlist size, every line says the real count, not 20", async () => {
    await islandDistinct(31);
    let t = 0;
    __fillClock.now = () => (t += 1000);
    const team = await teamMember("fewerthank");
    const res = await search(team.cookie, {});
    expect(res.status).toBe(200);
    const compared = Number(/Compared closely with the (\d+) of 31 cats/.exec(html(res.text))?.[1]);
    expect(compared).toBeGreaterThan(0);
    expect(compared).toBeLessThan(FIND_SHORTLIST_K);
    expect(html(res.text)).toContain(html(shortlistResultsLine(31, compared)));
    expect(html(res.text)).toContain(html(lessSureShortlist(compared)));
    expect(html(res.text)).not.toContain(`the ${FIND_SHORTLIST_K} cats whose photos`);
    expect(html(res.text)).not.toContain(`the ${FIND_SHORTLIST_K} of 31`);
    expect(noCloseMatchShortlist(compared)).toBe(
      `No close match among the ${compared} cats whose photos look most like yours. Try choosing an area, or`,
    );
  });

  it("nothing close among fewer than the shortlist size names the real count", async () => {
    await islandDistinct(31);
    let t = 0;
    __fillClock.now = () => (t += 1000);
    matchMock.mockImplementation(async (_p, candidates: CandidateInput[]) => ({
      isCatPhoto: true,
      matches: candidates.map((c) => ({ catId: c.catId, confidence: 0.1, reasoning: "" })),
    }));
    const team = await teamMember("fewernomatch");
    const res = await search(team.cookie, {});
    expect(res.status).toBe(200);
    const compared = Number(/Compared closely with the (\d+) of 31 cats/.exec(html(res.text))?.[1]);
    expect(compared).toBeLessThan(FIND_SHORTLIST_K);
    expect(html(res.text)).toContain(html(noCloseMatchShortlist(compared)));
    expect(html(res.text)).not.toContain(`among the ${FIND_SHORTLIST_K} cats`);
  });

  it("nothing above Unlikely among the shortlist says §9.3's words, and the browse link keeps the area", async () => {
    const team = await teamMember("nomatchshort");
    matchMock.mockImplementation(async (_p, candidates: CandidateInput[]) => ({
      isCatPhoto: true,
      matches: candidates.map((c) => ({ catId: c.catId, confidence: 0.1, reasoning: "" })),
    }));
    const res = await search(team.cookie, { colony: String(bigColony) });
    expect(res.status).toBe(200);
    expect(html(res.text)).toContain(html(NO_CLOSE_MATCH_SHORTLIST));
    expect(NO_CLOSE_MATCH_SHORTLIST).toBe(
      `No close match among the ${FIND_SHORTLIST_K} cats whose photos look most like yours. Try choosing an area, or`,
    );
    expect(res.text).toContain(`href="/api/team/cats?colony=${bigColony}">browse the cats</a>`);
    expect(res.text).not.toContain("No close match among these");
  });

  it("no photo is named next to the photo field", async () => {
    const team = await teamMember("nophoto");
    const res = await search(team.cookie, { colony: String(colony) }, null);
    expect(res.status).toBe(400);
    expect(res.text).toContain("Choose or take a photo first.");
    expect(matchMock).not.toHaveBeenCalled();
  });

  it("an upload over 10 MB gets 413 with words, not a crash", async () => {
    const team = await teamMember("big");
    const res = await search(team.cookie, { colony: String(colony) }, { bytes: Buffer.alloc(10 * 1024 * 1024 + 1, 1) });
    expect(res.status).toBe(413);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain(TOO_BIG_WORDS);
    expect(matchMock).not.toHaveBeenCalled();
    expect(await findTeamHits()).toBe(0);
  });

  it("a file that isn't a photo gets 400 with words, and uses no search", async () => {
    const team = await teamMember("wrongtype");
    const res = await search(team.cookie, { colony: String(colony) }, { bytes: Buffer.from("%PDF-1.4 not a photo"), name: "notes.pdf" });
    expect(res.status).toBe(400);
    expect(res.text).toContain("That file isn&#39;t a photo we can read.");
    expect(matchMock).not.toHaveBeenCalled();
    expect(await findTeamHits()).toBe(0);
  });

  it("two files are refused with words", async () => {
    const team = await teamMember("two");
    const res = await search(team.cookie, { colony: String(colony) }).attach("photo", photoBytes, "second.jpg");
    expect(res.status).toBe(400);
    expect(res.text).toContain("Choose one photo");
    expect(matchMock).not.toHaveBeenCalled();
  });

  it("matching down gives §5.2's words and a link to the grid", async () => {
    const team = await teamMember("down");
    matchMock.mockRejectedValue(new Error("down"));
    const res = await search(team.cookie, { colony: String(colony) });
    expect(res.status).toBe(503);
    expect(res.text).toContain(MATCHING_DOWN_WORDS.replace("isn't", "isn&#39;t").replace("area's", "area&#39;s"));
    expect(res.text).toContain(`href="/api/team/cats?colony=${colony}"`);
  });

  it("matching down on the island says to browse the cats, not an area's cats", async () => {
    await island(3);
    const team = await teamMember("isledown");
    matchMock.mockRejectedValue(new Error("down"));
    const res = await search(team.cookie, {});
    expect(res.status).toBe(503);
    expect(res.text).toContain("Matching isn&#39;t working right now. Try again in a few minutes, or browse the cats.");
    expect(res.text).not.toContain("this area");
  });

  it("nothing above Unlikely says so, and offers the grid", async () => {
    const team = await teamMember("none");
    matchMock.mockImplementation(async (_p, candidates: CandidateInput[]) => ({
      isCatPhoto: true,
      matches: candidates.map((c) => ({ catId: c.catId, confidence: 0.1, reasoning: "" })),
    }));
    const res = await search(team.cookie, { colony: String(colony) });
    expect(res.text).toContain("No close match among these 3 cats.");
    expect(res.text).toContain("Browse these cats as a grid");
  });

  it("the access log line holds no file name", async () => {
    const team = await teamMember("log");
    const name = `IMG_${RUN}_secret-name.jpg`;
    await search(team.cookie, { colony: String(colony) }, { bytes: photoBytes, name });
    const completed = spies.logLines.filter((l) => l.includes('"request completed"') && l.includes("/api/team/cats/find"));
    expect(completed).toHaveLength(1);
    expect(spies.logLines.some((l) => l.includes('"find from a photo"'))).toBe(true);
    for (const line of spies.logLines) {
      expect(line).not.toContain(name);
      expect(line).not.toContain("secret-name");
    }
  });
});

describe("every answer but the results keeps the strict header (second review, finding 1)", () => {
  it("each non-200 answer of the search carries STRICT_CSP and no data: picture", async () => {
    const empty = await newColony("find route strict empty");
    const blank = await newColony("find route strict blank");
    const [p] = await db
      .insert(photosTable)
      .values({ publicId: `${PREFIX}strict-unreadable`, data: Buffer.from("not an image").toString("base64"), mime: "image/jpeg" })
      .returning({ id: photosTable.id });
    await catIn(blank, p!.id);
    await island(31);
    const answers: [string, number, () => Promise<request.Response>][] = [
      [
        "index down",
        503,
        async () => {
          fingerprintMock.mockRejectedValueOnce(new Error("down"));
          return search((await teamMember("t1")).cookie, {});
        },
      ],
      ["no photo", 400, async () => search((await teamMember("t2")).cookie, { colony: String(colony) }, null)],
      ["not a photo", 400, async () => search((await teamMember("t3")).cookie, { colony: String(colony) }, { bytes: Buffer.from("nope") })],
      ["too big", 413, async () => search((await teamMember("t4")).cookie, { colony: String(colony) }, { bytes: Buffer.alloc(10 * 1024 * 1024 + 1, 1) })],
      ["none to compare", 400, async () => search((await teamMember("t6")).cookie, { colony: String(empty) })],
      ["no photos", 422, async () => search((await teamMember("t7")).cookie, { colony: String(blank) })],
      ["no such report", 404, async () => search((await teamMember("t8")).cookie, { colony: String(colony), tie: "no-such-report" })],
      [
        "matching down",
        503,
        async () => {
          matchMock.mockRejectedValueOnce(new Error("down"));
          return search((await teamMember("t9")).cookie, { colony: String(colony) });
        },
      ],
      [
        "not a cat",
        422,
        async () => {
          matchMock.mockResolvedValueOnce({ isCatPhoto: false, matches: [] });
          return search((await teamMember("t10")).cookie, { colony: String(colony) });
        },
      ],
      [
        "over the cap",
        429,
        async () => {
          const t = await teamMember("t11");
          for (let i = 0; i < FIND_PHOTO_PERSON_LIMIT; i++) await checkFindLimits(t.id);
          return search(t.cookie, { colony: String(colony) });
        },
      ],
    ];
    for (const [what, status, send] of answers) {
      const res = await send();
      expect([what, res.status], what).toEqual([what, status]);
      expect(res.headers["content-type"], what).toMatch(/text\/html/);
      expect(res.headers["content-security-policy"], what).toBe(STRICT_CSP);
      expect(res.text, what).not.toContain("data:image");
    }
  });
});

describe("refused before any work", () => {
  it("a tie to a report that doesn't exist runs no search and uses none (second review, finding 4)", async () => {
    const team = await teamMember("noreport");
    const res = await search(team.cookie, { colony: String(colony), tie: "no-such-report" });
    expect(res.status).toBe(404);
    expect(res.text).toContain("That report couldn't be found.");
    expect(matchMock).not.toHaveBeenCalled();
    expect(await findTeamHits()).toBe(0);
    expect(await findPersonHits(team.id)).toBe(0);
  });

  it("someone over their cap is refused before the photo is even read (second review, finding 5)", async () => {
    const team = await teamMember("early");
    for (let i = 0; i < FIND_PHOTO_PERSON_LIMIT; i++) await checkFindLimits(team.id);
    // An unreadable file would be a 400 if it were read first; the cap answers first.
    const res = await search(team.cookie, { colony: String(colony) }, { bytes: Buffer.from("not a photo") });
    expect(res.status).toBe(429);
    expect(res.text).toContain("They reset overnight.");
  });
});

describe("tying a welfare report", () => {
  it("from ?tie=, each result's This is the cat posts to the report's tie route", async () => {
    const team = await teamMember("tie");
    const report = await seedReport();
    const page = await form(team.cookie, `?colony=${colony}&tie=${report.publicId}`);
    expect(page.text).toContain(`<input type="hidden" name="tie" value="${report.publicId}">`);
    const res = await search(team.cookie, { colony: String(colony), tie: report.publicId });
    expect(res.status).toBe(200);
    expect(res.text).toContain(`<form method="post" action="/api/team/reports/${report.publicId}/cat">`);
    expect(res.text).toContain('<input type="hidden" name="expectedCatId" value="">');
    expect(res.text).toContain(`<input type="hidden" name="catId" value="${catIds[0]}">`);
    expect(res.text).toContain("This is the cat");
  });
});

describe("the daily caps", () => {
  it("a team member's 21st search in a day is refused with the words, and the service isn't called", async () => {
    const team = await teamMember("cap");
    for (let i = 0; i < FIND_PHOTO_PERSON_LIMIT; i++) expect(await checkFindLimits(team.id)).toBe("ok");
    const res = await search(team.cookie, { colony: String(colony) });
    expect(res.status).toBe(429);
    expect(res.text).toContain(PERSON_CAP_WORDS.replace("You've", "You&#39;ve").replace("today's", "today&#39;s"));
    expect(matchMock).not.toHaveBeenCalled();
    // And the form says so before a photo is chosen.
    const page = await form(team.cookie, `?colony=${colony}`);
    expect(page.text).not.toContain('type="file"');
    expect(page.text).toContain("They reset overnight.");
  });

  it("the 21st personal search doesn't use up the team's", async () => {
    const team = await teamMember("noleak");
    const now = Date.now();
    for (let i = 0; i < FIND_PHOTO_PERSON_LIMIT; i++) await checkFindLimits(team.id, now);
    expect(await findTeamHits(now)).toBe(FIND_PHOTO_PERSON_LIMIT);
    expect(await checkFindLimits(team.id, now)).toBe("person");
    expect(await checkFindLimits(team.id, now)).toBe("person");
    expect(await findTeamHits(now)).toBe(FIND_PHOTO_PERSON_LIMIT);
  });

  it("the team's 101st search is refused for everyone, with the team's words", async () => {
    const now = Date.now();
    const people = Array.from({ length: FIND_PHOTO_TEAM_LIMIT / FIND_PHOTO_PERSON_LIMIT }, (_, i) => `vt-find-team-${RUN}-${i}`);
    for (const id of people) for (let i = 0; i < FIND_PHOTO_PERSON_LIMIT; i++) expect(await checkFindLimits(id, now)).toBe("ok");
    const team = await teamMember("teamcap");
    const res = await search(team.cookie, { colony: String(colony) });
    expect(res.status).toBe(429);
    expect(res.text).toContain(TEAM_CAP_WORDS.replace("today's", "today&#39;s"));
    expect(matchMock).not.toHaveBeenCalled();
  });

  it("while the team's 100 are used up, trying again doesn't use up a person's own 20 (review finding 4)", async () => {
    const now = Date.now();
    for (let p = 0; p < FIND_PHOTO_TEAM_LIMIT / FIND_PHOTO_PERSON_LIMIT; p++) {
      for (let i = 0; i < FIND_PHOTO_PERSON_LIMIT; i++) await checkFindLimits(`vt-find-full-${RUN}-${p}`, now);
    }
    const team = await teamMember("waiting");
    for (let i = 0; i < 5; i++) expect(await checkFindLimits(team.id, now)).toBe("team");
    expect(await findPersonHits(team.id, now)).toBe(0);
  });

  it("a sliding day: spending the 20 late in a window gives no fresh 20 just after it", async () => {
    const team = await teamMember("slide");
    const DAY = 24 * 60 * 60 * 1000;
    const lateInWindow = Math.floor(Date.now() / DAY) * DAY + DAY - 60_000;
    for (let i = 0; i < FIND_PHOTO_PERSON_LIMIT; i++) await checkFindLimits(team.id, lateInWindow);
    expect(await checkFindLimits(team.id, lateInWindow + 120_000)).toBe("person");
  });
});
