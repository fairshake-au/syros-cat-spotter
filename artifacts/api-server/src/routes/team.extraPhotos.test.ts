import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";
import { catsTable, db, photosTable, pool, sightingsTable } from "@workspace/db";
import { teamCatView, type TeamCatView } from "../lib/teamCatView";
import { renderCatPage } from "../lib/teamPages/catPages";
import { deleteTestSightings } from "../test/sightings";
import { seedMatchRecord, seedSpot, type SeededSpot } from "../test/extraPhotoKit";
import { RUN, hidePhoto, seedCat, type SeededCat } from "../test/roleKit";

// SYC-415 PR 3, Task 3.3 (spec §5.5, §6.3): the team's cat page lists every
// photo of a spot, once each, marked face or body, and says when the matcher
// thought a spot's photos may show more than one cat.

const DEVICE = `vt-team-extra-${RUN}`;

let cat: SeededCat;
let spot: SeededSpot; // face cover, first and body extras, a "mixed cats" match record
let plain: SeededSpot; // one photo, no flag
let view: TeamCatView;
let html: string;

const withoutStyle = (h: string) => h.replace(/<style[\s\S]*?<\/style>/g, "");

beforeAll(async () => {
  cat = await seedCat(null);
  spot = await seedSpot({
    deviceId: DEVICE,
    catId: cat.id,
    createdAt: new Date(Date.now() - 86_400_000),
  });
  await seedMatchRecord(spot.sightingId, { mixedCats: true });
  plain = await seedSpot({
    deviceId: DEVICE,
    catId: cat.id,
    roles: ["first"],
    createdAt: new Date(Date.now() - 3 * 86_400_000),
  });
  await seedMatchRecord(plain.sightingId, { mixedCats: false });
  view = (await teamCatView(cat.id))!;
  html = withoutStyle(renderCatPage(view, "Sam", { may: () => true }));
});

afterAll(async () => {
  await deleteTestSightings(like(sightingsTable.deviceId, `${DEVICE}%`));
  await db.delete(catsTable).where(like(catsTable.name, `vt-roles cat ${RUN}%`));
  await pool.end();
});

const teamUrl = (s: SeededSpot, role: string) => `/api/team/photos/${s.photos[role]!.publicId}`;

describe("teamCatView", () => {
  it("lists all of a spot's photos once each, as sighting photos (not statement photos), cover first then the extras in order", () => {
    const urls = view.photos.map((p) => p.url);
    expect(urls).toEqual([
      `/api/team/photos/${cat.photoPublicId}`,
      teamUrl(spot, "face"),
      teamUrl(spot, "first"),
      teamUrl(spot, "body"),
      teamUrl(plain, "first"),
    ]);
    const sources = Object.fromEntries(view.photos.map((p) => [p.url, p.source]));
    expect(sources[teamUrl(spot, "first")]).toBe("sighting");
    expect(sources[teamUrl(spot, "body")]).toBe("sighting");
    expect(sources[teamUrl(spot, "face")]).toBe("sighting");
  });

  it("gives each extra photo its role, and the main photo none", () => {
    const roles = Object.fromEntries(view.photos.map((p) => [p.url, p.role ?? null]));
    expect(roles[teamUrl(spot, "face")]).toBe("face");
    expect(roles[teamUrl(spot, "first")]).toBe("first");
    expect(roles[teamUrl(spot, "body")]).toBe("body");
    expect(roles[`/api/team/photos/${cat.photoPublicId}`]).toBeNull();
  });

  it("each sighting lists its extras (the cover is not repeated) and its mixed-cats flag", () => {
    const withExtras = view.sightings.find((s) => s.photoUrl === teamUrl(spot, "face"))!;
    expect(withExtras.extraPhotos).toEqual([
      { role: "first", photoUrl: teamUrl(spot, "first") },
      { role: "body", photoUrl: teamUrl(spot, "body") },
    ]);
    expect(withExtras.mixedCats).toBe(true);
    const single = view.sightings.find((s) => s.photoUrl === teamUrl(plain, "first"))!;
    expect(single.extraPhotos).toEqual([]);
    expect(single.mixedCats).toBe(false);
  });

  it("a sighting with no sighting_photos rows (an older one) still shows its cover, once, with no extras", async () => {
    const other = await seedCat(null);
    const [p] = await db
      .insert(photosTable)
      .values({ data: Buffer.from("fake-old").toString("base64"), mime: "image/jpeg" })
      .returning({ id: photosTable.id, publicId: photosTable.publicId });
    await db.insert(sightingsTable).values({
      catId: other.id,
      deviceId: DEVICE,
      photoId: p!.id,
      lat: 37.445,
      lng: 24.942,
      status: "resolved",
    });
    const v = (await teamCatView(other.id))!;
    expect(v.photos.map((x) => [x.url, x.source, x.role ?? null])).toEqual([
      [`/api/team/photos/${other.photoPublicId}`, "main", null],
      [`/api/team/photos/${p!.publicId}`, "sighting", null],
    ]);
    expect(v.sightings[0]).toMatchObject({ photoUrl: `/api/team/photos/${p!.publicId}`, extraPhotos: [], mixedCats: false });
  });

  it("a hidden extra stays in the team's list, labelled as hidden", async () => {
    await hidePhoto(spot.photos["body"]!.id);
    const v = (await teamCatView(cat.id))!;
    const body = v.photos.find((p) => p.url === teamUrl(spot, "body"))!;
    expect(body.hidden).not.toBeNull();
    expect(body.role).toBe("body");
  });
});

describe("the team's cat page", () => {
  it("captions a body photo and a face photo, and says so for a screen reader", () => {
    // Photo numbers: main 1, face 2, first 3, body 4, plain 5.
    expect(html).toContain("Whole body photo");
    expect(html).toContain("(whole body photo, photo 4 of 5)");
    expect(html).toContain("Face photo");
    expect(html).toContain("(face photo, photo 2 of 5)");
  });

  it("does not caption a first photo or the main photo as face or body", () => {
    const count = (s: string) => html.split(s).length - 1;
    expect(count("Whole body photo")).toBe(1);
    expect(count(">Face photo<")).toBe(1);
  });

  it("marks the spot the matcher flagged, and only that one", () => {
    expect(html.split("May show more than one cat").length - 1).toBe(1);
    const chip = html.indexOf("May show more than one cat");
    const faceThumb = html.indexOf(teamUrl(spot, "face"), html.indexOf('<h2 id="history">'));
    const plainThumb = html.indexOf(teamUrl(plain, "first"), html.indexOf('<h2 id="history">'));
    // The chip sits in the flagged sighting's History row (beside its words, its
    // thumbnail below them, SYC-602 PR 2), before the next one's thumbnail.
    const row = html.indexOf(`id="sg-${spot.sightingId}"`);
    expect(chip).toBeGreaterThan(row);
    expect(chip).toBeLessThan(html.indexOf("</li>", row));
    expect(faceThumb).toBeGreaterThan(chip);
    expect(faceThumb).toBeLessThan(html.indexOf("</li>", row));
    expect(chip).toBeLessThan(plainThumb);
  });
});
