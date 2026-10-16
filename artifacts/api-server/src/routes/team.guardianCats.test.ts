import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { catIdentityTable, catsTable, db, feedingSitesTable, markLeft, observationsTable, photosTable, sightingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import app from "../app";
import { catTarget } from "../lib/capabilityTargets";
import { GUARDIAN_CAT_FIELDS } from "../lib/guardianCatView";
import { CATALOGUE } from "../lib/teamPages/strings";
import { removeTestPerson } from "../test/removeTestPerson";
import {
  guardianOn,
  hidePhoto,
  newColony,
  putInColony,
  RUN,
  seedCat,
  signedPerson,
  type SeededCat,
  type Signed,
} from "../test/roleKit";

// SYC-53 PR 2.1: a cat guardian's own cat pages (roles-and-invites.md §2.2,
// §6.1; plan tests T4 and T5, and SYC-333's merged-cat hand-off).
//
// T4: outside her colonies (another guardian's colony, or none), every route
// that returns a cat gives EXACTLY the public view, field by field, the
// `cat` of GET /api/cats/:id. Inside, exactly spec §2.2's fields: the list
// below is written out here on purpose, not imported, so adding a field to
// the serialiser (a team note, say) turns this red until someone decides it
// belongs on her page.
//
// T5: the target is read from the record. A request that names her colony
// about another colony's cat gets that cat's public view; a cat moved out of
// her colony is public to her at once.

const KEY = "vitest-gcats-key-0123456789abcdef-0123456789ab";
const JSON_ACCEPT = { Accept: "application/json" };

/** Spec §2.2, "She sees". Pinned here, never imported. */
const HER_FIELDS = [
  "coat",
  "colony",
  "description",
  "id",
  "lastSeen",
  "lat",
  "lifeStatus",
  "lng",
  "mainPhotoUrl",
  "markings",
  "name",
  "photoUrls",
  "sterilised",
  "syr",
];

/**
 * Top-level blocks her cat answer may carry. `healthNotes` is SYC-2's block
 * behind `view_health_notes` (Linear SYC-53, SYC-2's comment of 12 Oct): a
 * separate block that never passes through guardianCatView, allowed here so
 * SYC-2 PR 5.1 can add it without loosening the field list above.
 */
const ALLOWED_BLOCKS = ["view", "cat", "sites", "healthNotes"];

const SECRET_NOTE = `vt-gcats team note ${RUN}`;
const OWNER_NAME = `vt-gcats owner ${RUN}`;
const HOME_NOTE = `vt-gcats home ${RUN}`;
const SIGHTING_LAT = 37.43117;
const SIGHTING_LNG = 24.91833;

let colonyA: number;
let colonyB: number;
let eleni: Signed; // guardian of A
let maria: Signed; // guardian of B
let team: Signed;
let mine: SeededCat; // in A, with a public and a hidden sighting photo, an owner and a team note
let theirs: SeededCat; // in B
let loose: SeededCat; // in no colony
let movedAway: SeededCat; // was in A, now in B
let hiddenSightingPublicId: string;
let hiddenMain: SeededCat; // in A, main photo hidden, one public sighting photo
let hiddenMainStandIn: string;
let owned: SeededCat; // in B, with an owner, a home note and pin, and a hidden main photo
let marked: SeededCat; // in A, with markup in its name and description
const OWNER_DEVICE = `vt-gcats-owner-${RUN}`;
const OWNER_NAME_2 = `vt-gcats owner two ${RUN}`;
const HOME_NOTE_2 = `vt-gcats home two ${RUN}`;
const MARKUP = `<img src=x onerror="alert(1)">`;
const SITE_A = `vt-gcats site A ${RUN}`;
const SITE_A_WAY = `vt-gcats behind the bakery ${RUN}`;
const SITE_B = `vt-gcats site B ${RUN}`;
const SITE_C = `vt-gcats site C ${RUN}`;
const SITE_MARKUP_NAME = `vt-gcats ${RUN} <b onmouseover="x()">bowl</b>`;
const SITE_MARKUP_WAY = `<script>alert(3)</script> "left"`;
let colonyC: number;
let dimitra: Signed; // guardian of A and C
let publicSightingPublicId: string;

async function sightingWithPhoto(catId: number, at: Date): Promise<{ id: number; publicId: string }> {
  const [p] = await db
    .insert(photosTable)
    .values({ data: Buffer.from("fake-jpeg").toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id, publicId: photosTable.publicId });
  await db.insert(sightingsTable).values({
    catId,
    deviceId: `vt-gcats-spotter-${RUN}`,
    photoId: p!.id,
    lat: SIGHTING_LAT,
    lng: SIGHTING_LNG,
    status: "resolved",
    createdAt: at,
  });
  return p!;
}

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  colonyA = await newColony("gcats-A");
  colonyB = await newColony("gcats-B");
  eleni = await guardianOn("gcats-eleni", [colonyA]);
  maria = await guardianOn("gcats-maria", [colonyB]);
  team = await signedPerson("gcats-team", ["staff"]);

  mine = await seedCat(colonyA);
  theirs = await seedCat(colonyB);
  loose = await seedCat(null);
  movedAway = await seedCat(colonyA);
  await putInColony(movedAway.id, colonyB);

  // Everything she must never see, on her own cat.
  await db
    .update(catsTable)
    .set({ ownerName: OWNER_NAME, homeDescription: HOME_NOTE, homeLat: 37.4, homeLng: 24.9 })
    .where(eq(catsTable.id, mine.id));
  await db.insert(observationsTable).values({
    catId: mine.id,
    kind: "note",
    value: { text: SECRET_NOTE },
    accountId: team.id,
    roleAtTime: "staff",
    observedAt: new Date("2026-09-20T10:00:00Z"),
  });
  const pub = await sightingWithPhoto(mine.id, new Date("2026-10-01T09:00:00Z"));
  const hid = await sightingWithPhoto(mine.id, new Date("2026-10-02T09:00:00Z"));
  await hidePhoto(hid.id);
  publicSightingPublicId = pub.publicId;
  hiddenSightingPublicId = hid.publicId;

  // Review probe A: her own cat whose main photo the team hid.
  hiddenMain = await seedCat(colonyA);
  hiddenMainStandIn = (await sightingWithPhoto(hiddenMain.id, new Date("2026-10-03T09:00:00Z"))).publicId;
  await hidePhoto(hiddenMain.photoId);

  // Review probe B: an owned cat outside her colonies, main photo hidden.
  owned = await seedCat(colonyB);
  await db
    .update(catsTable)
    .set({ ownerDeviceId: OWNER_DEVICE, ownerName: OWNER_NAME_2, homeDescription: HOME_NOTE_2, homeLat: 37.41, homeLng: 24.91 })
    .where(eq(catsTable.id, owned.id));
  await hidePhoto(owned.photoId);

  // Review probe C: markup in a cat's name and description, and in her colony's name.
  marked = await seedCat(colonyA);
  await db
    .update(catsTable)
    .set({ name: `vt-gcats ${RUN} ${MARKUP}`, description: `<script>alert(2)</script> "quoted"` })
    .where(eq(catsTable.id, marked.id));
  await db.execute(sql`update colonies set name = name || ${" <i>\"x\"</i>"} where id = ${colonyA}`);

  // SYC-416: one feeding site in her colony, one in Maria's.
  await db.insert(feedingSitesTable).values([
    { name: SITE_A, lat: 37.44611, lng: 24.94377, colonyId: colonyA, directions: SITE_A_WAY },
    { name: SITE_B, lat: 37.44922, lng: 24.93844, colonyId: colonyB },
    { name: SITE_MARKUP_NAME, lat: 37.44633, lng: 24.94355, colonyId: colonyA, directions: SITE_MARKUP_WAY },
  ]);
  // SYC-416 review, minor 1: a guardian of two colonies, each with its own site.
  colonyC = await newColony("gcats-C");
  dimitra = await guardianOn("gcats-dimitra", [colonyA, colonyC]);
  await db.insert(feedingSitesTable).values({ name: SITE_C, lat: 37.4401, lng: 24.9501, colonyId: colonyC });
});

beforeEach(() => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
});

afterAll(async () => {
  for (const p of [eleni, maria, dimitra]) await removeTestPerson(p.email);
  // The team member wrote a statement, so has history: marked as left, as in production.
  await markLeft(team.email, "cli:vitest");
  delete process.env["TEAM_SESSION_KEYS"];
});

const asEleni = (path: string) =>
  request(app).get(path).set("Cookie", eleni.cookie).set(JSON_ACCEPT);

async function publicCat(id: number): Promise<unknown> {
  const res = await request(app).get(`/api/cats/${id}`);
  expect(res.status).toBe(200);
  return res.body.cat;
}

describe("T4: outside her colonies she gets exactly the public view", () => {
  it.each([
    ["a cat in another guardian's colony", () => theirs],
    ["a cat in no colony", () => loose],
    ["a cat moved out of her colony (T5: the newest statement counts)", () => movedAway],
  ])("%s: field by field the public cat", async (_label, cat) => {
    const res = await asEleni(`/api/team/my/cats/${cat().id}`);
    expect(res.status).toBe(200);
    expect(res.body.view).toBe("public");
    expect(res.body.cat).toEqual(await publicCat(cat().id));
    expect(res.body.cat.locationPrecision).toBe("approximate");
    for (const key of Object.keys(res.body)) expect(ALLOWED_BLOCKS).toContain(key);
  });

  it("the page for an outside cat prints no position at all", async () => {
    const res = await request(app)
      .get(`/api/team/my/cats/${theirs.id}`)
      .set("Cookie", eleni.cookie)
      .set("Sec-Fetch-Mode", "navigate");
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("37.445");
    expect(res.text).not.toContain("24.942");
    expect(res.text).toContain("isn’t in one of your colonies");
    // No photo either: the public address is behind the pre-launch pass.
    expect(res.text).not.toContain("/api/photos/");
    expect(res.text).not.toContain("/api/team/photos/");
  });

  it("her colony page never lists another colony's cat, and another colony is not found", async () => {
    const own = await asEleni(`/api/team/my/colonies/${colonyA}`);
    expect(own.status).toBe(200);
    const ids = (own.body.cats as { id: number }[]).map((c) => c.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    expect(ids).not.toContain(movedAway.id);
    for (const path of [`/api/team/my/colonies/${colonyB}`, "/api/team/my/colonies/999999999", "/api/team/my/colonies/abc"]) {
      const res = await asEleni(path);
      expect(res.status).toBe(404);
    }
    // Byte for byte the same: nothing says whether the other colony exists.
    const other = await asEleni(`/api/team/my/colonies/${colonyB}`);
    const none = await asEleni("/api/team/my/colonies/999999999");
    expect(other.text).toBe(none.text);
  });
});

describe("T4: inside her colonies, exactly spec §2.2's fields", () => {
  it("her cat carries exactly the allowed fields, at its exact position", async () => {
    const res = await asEleni(`/api/team/my/cats/${mine.id}`);
    expect(res.status).toBe(200);
    expect(res.body.view).toBe("guardian");
    for (const key of Object.keys(res.body)) expect(ALLOWED_BLOCKS).toContain(key);
    const cat = res.body.cat;
    expect(Object.keys(cat).sort()).toEqual(HER_FIELDS);
    expect([...GUARDIAN_CAT_FIELDS].sort()).toEqual(HER_FIELDS);
    expect(Object.keys(cat.sterilised).sort()).toEqual(["confidence", "value"]);
    expect(Object.keys(cat.colony).sort()).toEqual(["id", "name"]);
    expect(cat.colony.id).toBe(colonyA);
    expect(cat.lat).toBe(37.445);
    expect(cat.lng).toBe(24.942);
    expect(cat.lastSeen).toBe("2026-10-02");
  });

  it("the same fields on her colony page, for every cat", async () => {
    const res = await asEleni(`/api/team/my/colonies/${colonyA}`);
    expect(Object.keys(res.body).sort()).toEqual(["cats", "colony", "sites"]);
    expect(Object.keys(res.body.colony).sort()).toEqual(["id", "name"]);
    for (const c of res.body.cats) expect(Object.keys(c).sort()).toEqual(HER_FIELDS);
  });

  it("nothing excluded rides along: owner, team notes and names, spotters, sighting positions, hidden photos", async () => {
    for (const path of [`/api/team/my/cats/${mine.id}`, `/api/team/my/colonies/${colonyA}`]) {
      const res = await asEleni(path);
      const text = JSON.stringify(res.body);
      for (const never of [
        OWNER_NAME,
        HOME_NOTE,
        SECRET_NOTE,
        "Vt gcats-team", // the team member's name
        `vt-gcats-spotter-${RUN}`,
        `vt-roles-device-${RUN}`,
        String(SIGHTING_LAT),
        String(SIGHTING_LNG),
        hiddenSightingPublicId,
        "/api/photos/", // never the public photo address on her page
      ]) {
        expect(text, `${path} leaked ${never}`).not.toContain(never);
      }
      for (const key of ["history", "owner", "records", "sightings", "photos", "homePin", "supportingStatementIds", "conflictingStatementIds"]) {
        expect(text).not.toContain(`"${key}"`);
      }
    }
  });

  it("only public photos, through the team photo route, which serves them to her", async () => {
    const res = await asEleni(`/api/team/my/cats/${mine.id}`);
    expect(res.body.cat.mainPhotoUrl).toBe(`/api/team/photos/${mine.photoPublicId}`);
    expect(res.body.cat.photoUrls).toEqual([
      `/api/team/photos/${mine.photoPublicId}`,
      `/api/team/photos/${publicSightingPublicId}`,
    ]);
    const photo = await request(app).get(res.body.cat.photoUrls[1]).set("Cookie", eleni.cookie);
    expect(photo.status).toBe(200);
  });

  it("her cat page prints the exact position, and no map link", async () => {
    const res = await request(app)
      .get(`/api/team/my/cats/${mine.id}`)
      .set("Cookie", eleni.cookie)
      .set("Sec-Fetch-Mode", "navigate");
    expect(res.status).toBe(200);
    expect(res.text).toContain("37.44500, 24.94200");
    expect(res.text).not.toMatch(/google\.com\/maps|maps\.apple|openstreetmap/);
    expect(res.text).not.toContain(SECRET_NOTE);
    expect(res.text).not.toContain(OWNER_NAME);
  });

  it("another guardian sees her cat only as the public does", async () => {
    const res = await request(app)
      .get(`/api/team/my/cats/${mine.id}`)
      .set("Cookie", maria.cookie)
      .set(JSON_ACCEPT);
    expect(res.body.view).toBe("public");
    expect(res.body.cat).toEqual(await publicCat(mine.id));
  });
});

describe("T5: the target comes from the record, never the request", () => {
  it("naming her colony in the request about another colony's cat gets the public view", async () => {
    for (const path of [
      `/api/team/my/cats/${theirs.id}?colony=${colonyA}`,
      `/api/team/my/cats/${theirs.id}?colonyId=${colonyA}`,
    ]) {
      const res = await asEleni(path);
      expect(res.body.view).toBe("public");
      expect(res.body.cat).toEqual(await publicCat(theirs.id));
    }
  });

  it("a cat put into her colony shows in full at once; moved out, public at once", async () => {
    const roaming = await seedCat(colonyB);
    expect((await asEleni(`/api/team/my/cats/${roaming.id}`)).body.view).toBe("public");
    await putInColony(roaming.id, colonyA);
    expect((await asEleni(`/api/team/my/cats/${roaming.id}`)).body.view).toBe("guardian");
    await putInColony(roaming.id, null);
    expect((await asEleni(`/api/team/my/cats/${roaming.id}`)).body.view).toBe("public");
  });

  it("no such cat is not found", async () => {
    expect((await asEleni("/api/team/my/cats/999999999")).status).toBe(404);
    expect((await asEleni("/api/team/my/cats/abc")).status).toBe(404);
  });
});

describe("SYC-333: a merged cat is judged as the cat it was merged into", () => {
  it("a cat merged into her cat is hers (her view of the cat it became); merged out of her colony, public", async () => {
    // `into` lives in B, but was merged into her cat in A.
    const into = await seedCat(colonyB);
    await db.insert(catIdentityTable).values({ catId: into.id, canonicalCatId: mine.id, reason: "vt-gcats" });
    expect(await catTarget(into.id)).toEqual({ colonyId: colonyA });
    const res = await asEleni(`/api/team/my/cats/${into.id}`);
    expect(res.body.view).toBe("guardian");
    expect(res.body.cat.id).toBe(mine.id);

    // `away` lives in A, but was merged into Maria's cat in B.
    const away = await seedCat(colonyA);
    await db.insert(catIdentityTable).values({ catId: away.id, canonicalCatId: theirs.id, reason: "vt-gcats" });
    expect(await catTarget(away.id)).toEqual({ colonyId: colonyB });
    expect((await asEleni(`/api/team/my/cats/${away.id}`)).body.view).toBe("public");
    // And it is not listed on her colony page as a cat of its own.
    const page = await asEleni(`/api/team/my/colonies/${colonyA}`);
    expect((page.body.cats as { id: number }[]).map((c) => c.id)).not.toContain(away.id);
  });

  it("an undone merge counts for nothing", async () => {
    const back = await seedCat(colonyB);
    const [merge] = await db
      .insert(catIdentityTable)
      .values({ catId: back.id, canonicalCatId: mine.id, reason: "vt-gcats" })
      .returning({ id: catIdentityTable.id });
    await db.insert(catIdentityTable).values({ catId: back.id, canonicalCatId: back.id, supersedesId: merge!.id, reason: "vt-gcats undo" });
    expect(await catTarget(back.id)).toEqual({ colonyId: colonyB });
  });

  it("two standing merges for one cat (bad data): the newer row counts", async () => {
    const twice = await seedCat(colonyB);
    await db.insert(catIdentityTable).values({ catId: twice.id, canonicalCatId: theirs.id, reason: "vt-gcats old" });
    await db.insert(catIdentityTable).values({ catId: twice.id, canonicalCatId: mine.id, reason: "vt-gcats new" });
    expect(await catTarget(twice.id)).toEqual({ colonyId: colonyA });
  });

  it("a chain of 8 merges resolves; 9 is deeper than any real one, so no colony", async () => {
    const chain: SeededCat[] = [];
    for (let i = 0; i < 10; i++) chain.push(await seedCat(i === 8 ? colonyA : colonyB));
    for (let i = 0; i < 9; i++) {
      await db.insert(catIdentityTable).values({ catId: chain[i]!.id, canonicalCatId: chain[i + 1]!.id, reason: "vt-gcats chain" });
    }
    // chain[1] -> ... -> chain[9]: 8 hops, ends in B.
    expect(await catTarget(chain[1]!.id)).toEqual({ colonyId: colonyB });
    // chain[0] -> ... -> chain[9]: 9 hops: too deep.
    expect(await catTarget(chain[0]!.id)).toEqual({ colonyId: null });
  });

  it("a merge loop resolves to no colony, so only the team passes", async () => {
    const x = await seedCat(colonyA);
    const y = await seedCat(colonyA);
    await db.insert(catIdentityTable).values([
      { catId: x.id, canonicalCatId: y.id, reason: "vt-gcats loop" },
      { catId: y.id, canonicalCatId: x.id, reason: "vt-gcats loop" },
    ]);
    expect(await catTarget(x.id)).toEqual({ colonyId: null });
  });
});

describe("PR 2.1 review: hidden photos, owners and markup", () => {
  it("A: a hidden main photo is never on her page; the newest public photo stands in", async () => {
    const res = await asEleni(`/api/team/my/cats/${hiddenMain.id}`);
    expect(res.body.view).toBe("guardian");
    expect(JSON.stringify(res.body)).not.toContain(hiddenMain.photoPublicId);
    expect(res.body.cat.mainPhotoUrl).toBe(`/api/team/photos/${hiddenMainStandIn}`);
    expect(res.body.cat.photoUrls).toEqual([`/api/team/photos/${hiddenMainStandIn}`]);
    const page = await asEleni(`/api/team/my/colonies/${colonyA}`);
    expect(JSON.stringify(page.body)).not.toContain(hiddenMain.photoPublicId);
  });

  it("B: an owned cat outside her colonies is the public view, never the owner's, whatever headers she sends", async () => {
    const res = await request(app)
      .get(`/api/team/my/cats/${owned.id}`)
      .set("Cookie", eleni.cookie)
      .set(JSON_ACCEPT)
      .set("X-Device-Id", OWNER_DEVICE)
      .set("X-Device-Secret", "anything");
    expect(res.body.view).toBe("public");
    expect(res.body.cat).toEqual(await publicCat(owned.id));
    expect(res.body.cat.locationPrecision).toBe("approximate");
    expect(res.body.cat.ownerName).toBeNull();
    expect(res.body.cat.homeDescription).toBeNull();
    expect(res.body.cat.homePin).toBeNull();
    const text = JSON.stringify(res.body);
    for (const never of [OWNER_NAME_2, HOME_NOTE_2, OWNER_DEVICE, owned.photoPublicId]) expect(text).not.toContain(never);
  });

  it("C: names and descriptions are escaped on both pages", async () => {
    for (const path of [`/api/team/my/cats/${marked.id}`, `/api/team/my/colonies/${colonyA}`]) {
      const res = await request(app).get(path).set("Cookie", eleni.cookie).set("Sec-Fetch-Mode", "navigate");
      expect(res.status).toBe(200);
      expect(res.text).not.toContain(MARKUP);
      expect(res.text).not.toContain("<script>alert(2)");
      expect(res.text).not.toContain('<i>"x"</i>');
      expect(res.text).toContain("&lt;img src=x onerror=");
    }
    const cat = await request(app).get(`/api/team/my/cats/${marked.id}`).set("Cookie", eleni.cookie).set("Sec-Fetch-Mode", "navigate");
    expect(cat.text).toContain("&lt;script&gt;alert(2)");
    expect(cat.text).toContain("&lt;i&gt;");
  });
});

describe("her pages' words follow the house rules (SYC-283 drafts)", () => {
  // Her pages' own keys. The colour and mark words (coat.*, mark.*) are
  // SYC-2's shared vocabulary (PR 3.1), checked there.
  const mine = (key: string) => /^(gcat\.|gcol\.|mycol\.seeCats$)/.test(key);
  it("Greek: no accented capital letters", () => {
    const bad = Object.entries(CATALOGUE.el).filter(([k, v]) => mine(k) && /[ΆΈΉΊΌΎΏ]/.test(v)).map(([k]) => k);
    expect(bad).toEqual([]);
  });
  it("French: a non-breaking space before a colon, never a plain one", () => {
    const bad = Object.entries(CATALOGUE.fr).filter(([k, v]) => mine(k) && /( :|[^\u00a0]:)/.test(v)).map(([k]) => k);
    expect(bad).toEqual([]);
  });
  it("every new key exists in all three languages", () => {
    const keys = Object.keys(CATALOGUE.en).filter(mine);
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) {
      expect(CATALOGUE.el[k as keyof typeof CATALOGUE.el], k).toBeTruthy();
      expect(CATALOGUE.fr[k as keyof typeof CATALOGUE.fr], k).toBeTruthy();
    }
  });
});

describe("SYC-416: her colony's feeding sites, and the colony page's cat links", () => {
  it("her cat page and colony page list her colony's sites, never another colony's", async () => {
    for (const path of [`/api/team/my/cats/${mine.id}`, `/api/team/my/colonies/${colonyA}`]) {
      const json = await asEleni(path);
      const names = (json.body.sites as { name: string }[]).map((x) => x.name);
      expect(names, path).toContain(SITE_A);
      expect(names, path).not.toContain(SITE_B);
      const html = await request(app).get(path).set("Cookie", eleni.cookie).set("Sec-Fetch-Mode", "navigate");
      expect(html.text).toContain(SITE_A);
      expect(html.text).toContain(SITE_A_WAY);
      expect(html.text).toContain("37.44611, 24.94377");
      expect(html.text).not.toContain(SITE_B);
    }
  });

  it("a guardian of two colonies: each page shows its own colony's sites only", async () => {
    for (const path of [`/api/team/my/cats/${mine.id}`, `/api/team/my/colonies/${colonyA}`]) {
      const res = await request(app).get(path).set("Cookie", dimitra.cookie).set(JSON_ACCEPT);
      const names = (res.body.sites as { name: string }[]).map((x) => x.name);
      expect(names, path).toContain(SITE_A);
      expect(names, path).not.toContain(SITE_C);
    }
    const c = await request(app).get(`/api/team/my/colonies/${colonyC}`).set("Cookie", dimitra.cookie).set(JSON_ACCEPT);
    expect((c.body.sites as { name: string }[]).map((x) => x.name)).toEqual([SITE_C]);
  });

  it("site names and directions are escaped on both pages", async () => {
    for (const path of [`/api/team/my/cats/${mine.id}`, `/api/team/my/colonies/${colonyA}`]) {
      const html = await request(app).get(path).set("Cookie", eleni.cookie).set("Sec-Fetch-Mode", "navigate");
      expect(html.text).not.toContain('<b onmouseover="x()">');
      expect(html.text).not.toContain("<script>alert(3)");
      expect(html.text).toContain("&lt;b onmouseover=");
      expect(html.text).toContain("&lt;script&gt;alert(3)");
    }
  });

  it("an outside cat's public view carries no sites at all", async () => {
    const res = await asEleni(`/api/team/my/cats/${theirs.id}`);
    expect(res.body.view).toBe("public");
    expect(res.body.sites).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(SITE_B);
  });

  it("SYC-209's colony page links a guardian's cats to HER cat page, and the team's to the team's", async () => {
    const hers = await request(app).get(`/api/team/colonies/${colonyA}`).set("Cookie", eleni.cookie).set("Sec-Fetch-Mode", "navigate");
    expect(hers.status).toBe(200);
    expect(hers.text).toContain(`href="/api/team/my/cats/${mine.id}"`);
    expect(hers.text).not.toContain("/api/team/cats/");
    const teams = await request(app).get(`/api/team/colonies/${colonyA}`).set("Cookie", team.cookie).set("Sec-Fetch-Mode", "navigate");
    expect(teams.status).toBe(200);
    expect(teams.text).toContain(`href="/api/team/cats/${mine.id}"`);
    expect(teams.text).not.toContain("/api/team/my/cats/");
  });
});

describe("My colonies links to each of her colony pages", () => {
  it("one link per colony she holds", async () => {
    const res = await request(app)
      .get("/api/team/my/colonies")
      .set("Cookie", eleni.cookie)
      .set("Sec-Fetch-Mode", "navigate");
    expect(res.text).toContain(`href="/api/team/my/colonies/${colonyA}"`);
    expect(res.text).not.toContain(`href="/api/team/my/colonies/${colonyB}"`);
  });
});

describe("the guardian's pages never reach the team's cat view (source)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  it("her routes read feeding sites only through sitesForPerson (SYC-209's one filter)", () => {
    const src = readFileSync(join(here, "teamMy.ts"), "utf8");
    expect(src).not.toMatch(/feedingSitesTable|feeding_sites/);
    expect(src).toMatch(/sitesForPerson\(/);
  });

  it.each([
    join(here, "teamMy.ts"),
    join(here, "../lib/guardianCatView.ts"),
    join(here, "../lib/teamPages/guardianPages.ts"),
  ])("%s calls no teamCatView, searchTeamCats or renderCatPage", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/\bteamCatView\s*\(|\bsearchTeamCats\s*\(|\brenderCatPage\s*\(/);
  });
});
