import { deleteTestSightings } from "../test/sightings";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { inArray, like, or } from "drizzle-orm";
import {
  addPerson,
  catsTable,
  db,
  markLeft,
  observationsTable,
  photosTable,
  pool,
  sightingsTable,
} from "@workspace/db";
import app from "../app";
import { makeKey } from "../lib/teamAuth/__fixtures__/mint";
import { signInThroughHandoff } from "../lib/teamAuth/__fixtures__/queueKit";
import type { TeamCatSearchResult, TeamCatView } from "../lib/teamCatView";

// SYC-43 part 2 plan, PR 3: finding a cat, and the team's page for a cat.
// P3-1 (search), P3-2 team half (exact positions; the public half is
// cats.publicDetail.test.ts), P3-3 (a replaced statement), P3-4 (who said it).

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-p3-${RUN}-`;
const SUSAN = `vitest-p3-susan-${RUN}@example.com`;
const MARIA = `vitest-p3-maria-${RUN}@example.com`;
const KEY = "vitest-p3-key-0123456789abcdef-0123456789abcd";
const handoffKey = makeKey();
// A spotter's device id. It must never reach a team page or payload.
const DEVICE = `${PREFIX}device-SECRET-7f3a`;
const SPOTTER_NOTE = 'Fed by the <img src=x onerror="alert(1)"> café';
const at = (iso: string) => new Date(iso);

let cookie: string;
let susanId: string;
let mariaId: string;
let mimi: number; // Μιμή
let latinMimi: number; // Mimi, a different cat: no Greek/Latin folding
const photoIds: number[] = [];
const ids: Record<string, number> = {};

const SIGHTINGS = [
  { lat: 37.4447123, lng: 24.9418765, at: "2026-09-12T07:15:00Z" },
  { lat: 37.4461987, lng: 24.9433456, at: "2026-09-28T16:40:00Z" },
];

async function cleanup() {
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  await db
    .delete(catsTable)
    .where(
      or(
        like(catsTable.name, `${PREFIX}%`),
        inArray(catsTable.name, ["Μιμή", "Mimi", "Μιμήτρα"]),
      ),
    );
  await db.delete(photosTable).where(like(photosTable.publicId, `${PREFIX}%`));
}

async function photo(name: string): Promise<number> {
  const [p] = await db
    .insert(photosTable)
    .values({
      publicId: `${PREFIX}${name}`,
      data: Buffer.from(`fake ${name}`).toString("base64"),
      mime: "image/jpeg",
    })
    .returning({ id: photosTable.id });
  photoIds.push(p!.id);
  return p!.id;
}

async function cat(name: string, photoId: number, extra: Partial<typeof catsTable.$inferInsert> = {}) {
  const [c] = await db
    .insert(catsTable)
    .values({
      name,
      description: "",
      primaryPhotoId: photoId,
      lat: 37.445,
      lng: 24.942,
      discovererDeviceId: DEVICE,
      ...extra,
    })
    .returning({ id: catsTable.id });
  return c!.id;
}

async function statement(
  key: string,
  o: Omit<typeof observationsTable.$inferInsert, "catId" | "observedAt"> & {
    observedAt?: Date;
  },
) {
  const [row] = await db
    .insert(observationsTable)
    .values({ catId: mimi, observedAt: o.createdAt ?? new Date(), ...o })
    .returning({ id: observationsTable.id });
  ids[key] = row!.id;
}

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await cleanup();
  susanId = (await addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:vitest" })).id;
  mariaId = (await addPerson({ email: MARIA, name: "Maria", addedBy: "cli:vitest" })).id;
  cookie = await signInThroughHandoff(app, handoffKey, susanId);

  const main = await photo("main");
  mimi = await cat("Μιμή", main, {
    description: "Sleeps on the <b>church</b> steps",
    lat: 37.4451234,
    lng: 24.9423456,
  });
  latinMimi = await cat("Mimi", await photo("latin"));
  await cat("Μιμήτρα", await photo("longer"));

  for (const [i, s] of SIGHTINGS.entries()) {
    const [row] = await db
      .insert(sightingsTable)
      .values({
        catId: mimi,
        deviceId: DEVICE,
        photoId: await photo(`s${i}`),
        lat: s.lat,
        lng: s.lng,
        status: "resolved",
        createdAt: at(s.at),
      })
      .returning({ id: sightingsTable.id });
    ids[`sighting${i}`] = row!.id;
  }
  const earPhoto = await photo("ear");

  // Imported name, by the backfill.
  await statement("imported", {
    kind: "name",
    value: { name: "Μιμή", normalised: "μιμη" },
    accountId: "system:legacy-backfill",
    roleAtTime: "system",
    provenance: "legacy",
    createdAt: at("2026-09-01T09:00:00Z"),
  });
  // Coat colour, read by the model.
  await statement("vision", {
    kind: "coat",
    value: { colours: ["black_and_white"], modelVersion: "v1" },
    accountId: "system:vision",
    roleAtTime: "system",
    provenance: "machine",
    createdAt: at("2026-09-02T09:00:00Z"),
  });
  // A spotter's clipped ear, with its photo, and a spotter's note.
  await statement("spotterEar", {
    kind: "ear_tip",
    value: { clipped: true, side: "left" },
    deviceId: DEVICE,
    photoId: earPhoto,
    sightingId: ids["sighting0"],
    createdAt: at("2026-09-12T07:16:00Z"),
    observedAt: at("2026-09-12T07:15:00Z"),
  });
  await statement("spotterNote", {
    kind: "note",
    value: { text: SPOTTER_NOTE },
    deviceId: DEVICE,
    createdAt: at("2026-09-12T07:17:00Z"),
  });
  // Maria (who later leaves) says it lives on the street.
  await statement("maria", {
    kind: "life_status",
    value: { status: "street", reason: "Seen at the harbour every morning" },
    accountId: mariaId,
    roleAtTime: "staff",
    createdAt: at("2026-09-20T10:00:00Z"),
  });
  // Susan says sterilised, then corrects herself.
  await statement("wrong", {
    kind: "sterilised",
    value: { sterilised: true, reason: "Vet said so" },
    accountId: susanId,
    roleAtTime: "staff",
    createdAt: at("2026-09-25T10:00:00Z"),
  });
  await statement("fix", {
    kind: "sterilised",
    value: { sterilised: false },
    accountId: susanId,
    roleAtTime: "staff",
    supersedesId: ids["wrong"],
    supersedeReason: "That was a different cat at the clinic",
    createdAt: at("2026-09-26T10:00:00Z"),
  });
  // An account id that is on no list.
  await statement("stranger", {
    kind: "note",
    value: { text: "From an old account" },
    accountId: "old-admin-account-42",
    roleAtTime: "staff",
    createdAt: at("2026-09-27T10:00:00Z"),
  });

  await markLeft(MARIA, "cli:vitest");
});

beforeEach(() => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
});

afterAll(async () => {
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  // Observations are append-only and stay; both people have history, so
  // they leave rather than being deleted (Decision 7).
  await cleanup();
  await markLeft(SUSAN, "cli:vitest");
  await pool.end();
});

const searchJson = async (q: string) => {
  const res = await request(app)
    .get("/api/team/cats")
    .query({ q })
    .set("Accept", "application/json")
    .set("Cookie", cookie);
  expect(res.status).toBe(200);
  return (res.body as { results: TeamCatSearchResult[] }).results.map((r) => r.id);
};

const catJson = async (id = mimi) => {
  const res = await request(app)
    .get(`/api/team/cats/${id}`)
    .set("Accept", "application/json")
    .set("Cookie", cookie);
  expect(res.status).toBe(200);
  return { view: res.body as TeamCatView, text: res.text };
};

const catHtml = async (id = mimi) => {
  const res = await request(app).get(`/api/team/cats/${id}`).set("Cookie", cookie);
  expect(res.status).toBe(200);
  expect(res.type).toBe("text/html");
  return res.text;
};

describe("P3-1: finding a cat", () => {
  it("finds Μιμή by μιμη, ΜΙΜΗ, Μιμή and spaced or invisible-character spellings", async () => {
    for (const q of ["μιμη", "ΜΙΜΗ", "Μιμή", "  μιμή ", "μι​μη"]) {
      const found = await searchJson(q);
      expect(found[0], q).toBe(mimi);
      expect(found, q).not.toContain(latinMimi);
    }
  });

  it("does not fold Latin into Greek: mimi finds Mimi, never Μιμή (DECISIONS Part 2j)", async () => {
    const found = await searchJson("mimi");
    expect(found).toContain(latinMimi);
    expect(found).not.toContain(mimi);
  });

  it("finds a cat by its SYR number, written several ways", async () => {
    const syr = `SYR-${String(mimi).padStart(4, "0")}`;
    for (const q of [syr, syr.toLowerCase(), `SYR ${mimi}`, String(mimi)]) {
      expect((await searchJson(q))[0], q).toBe(mimi);
    }
  });

  it("puts the whole name above longer names that contain it", async () => {
    const found = await searchJson("μιμη");
    const longer = found.findIndex((id) => id !== mimi);
    expect(found.indexOf(mimi)).toBe(0);
    expect(longer).toBeGreaterThan(0);
  });

  it("returns at most 30, each with a team thumbnail, name, SYR number and the public status", async () => {
    const thumb = await photo("many");
    for (let i = 0; i < 32; i++) await cat(`${PREFIX}many-${String(i).padStart(2, "0")}`, thumb);
    const res = await request(app)
      .get("/api/team/cats")
      .query({ q: `${PREFIX}many` })
      .set("Accept", "application/json")
      .set("Cookie", cookie);
    const results = (res.body as { results: TeamCatSearchResult[] }).results;
    expect(results).toHaveLength(30);
    expect(results[0]).toMatchObject({
      name: `${PREFIX}many-00`,
      thumbnailUrl: `/api/team/photos/${PREFIX}many`,
      status: { lifeStatus: "street" },
    });
    expect(results[0]!.syr).toMatch(/^SYR-\d{4,}$/);
  });

  it("draws the search page with links to each cat, and nothing for an empty search", async () => {
    const res = await request(app).get("/api/team/cats").query({ q: "ΜΙΜΗ" }).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.type).toBe("text/html");
    expect(res.text).toContain(`href="/api/team/cats/${mimi}"`);
    expect(res.text).toContain('value="ΜΙΜΗ"');
    const empty = await request(app).get("/api/team/cats").set("Cookie", cookie);
    expect(empty.text).toContain("Type a name");
    expect(empty.text).not.toContain('class="catrow"');
  });

  it("treats a repeated or bracketed q as no query, and cuts a long one at 100 characters", async () => {
    for (const path of ["/api/team/cats?q=μιμη&q=μιμη", "/api/team/cats?q[x]=μιμη"]) {
      const res = await request(app)
        .get(encodeURI(path))
        .set("Accept", "application/json")
        .set("Cookie", cookie);
      expect(res.status, path).toBe(200);
      expect(res.body, path).toEqual({ query: "", results: [] });
    }
    // The first 100 characters are "μιμη" and spaces, so it still finds her;
    // anything past them is ignored.
    const long = `μιμη${" ".repeat(96)}zzzz`;
    expect((await searchJson(long))[0]).toBe(mimi);
  });

  it("escapes the query it shows back", async () => {
    const res = await request(app)
      .get("/api/team/cats")
      .query({ q: '"><script>x</script>' })
      .set("Cookie", cookie);
    expect(res.text).not.toContain("<script>x");
    expect(res.text).toContain("&lt;script&gt;x");
  });
});

describe("P3-2 (team half): the team's cat page shows exact positions", () => {
  it("sends every sighting at its exact position and time, newest first", async () => {
    const { view } = await catJson();
    expect(view.sightings.map((s) => [s.lat, s.lng, s.at])).toEqual([
      [SIGHTINGS[1]!.lat, SIGHTINGS[1]!.lng, new Date(SIGHTINGS[1]!.at).toISOString()],
      [SIGHTINGS[0]!.lat, SIGHTINGS[0]!.lng, new Date(SIGHTINGS[0]!.at).toISOString()],
    ]);
    expect([view.cat.lat, view.cat.lng]).toEqual([37.4451234, 24.9423456]);
    const html = await catHtml();
    expect(html).toContain("37.4461987, 24.9433456");
    expect(html).toContain("37.4447123, 24.9418765");
  });

  it("SYC-245: the positions are plain text, with no link to any map company", async () => {
    const html = await catHtml();
    expect(html).toContain("37.4461987, 24.9433456");
    expect(html).not.toContain("Open map");
    // Any link at all that points off the dashboard is a failure here.
    const external = [...html.matchAll(/<a\b[^>]*\shref="(https?:[^"]*)"/gi)].map((m) => m[1]);
    expect(external).toEqual([]);
    expect(html).not.toMatch(/google\.com\/maps|maps\.apple\.com|maps\.google\.|goo\.gl\/maps|waze\.com|openstreetmap\.org/i);
  });

  it("shows the status exactly as the public cat page does, plus the resolver's own answer", async () => {
    const pub = await request(app).get(`/api/cats/${mimi}`);
    const { cat: publicCat } = pub.body as { cat: Record<string, unknown> };
    const { view } = await catJson();
    expect(view.publicStatus).toEqual({
      hasHome: publicCat["hasHome"],
      lifeStatus: publicCat["lifeStatus"],
      notSeenSince: publicCat["notSeenSince"],
      sterilised: publicCat["sterilised"],
      coat: publicCat["coat"],
      markings: publicCat["markings"],
    });
    expect(view.records.sterilised).toMatchObject({
      value: false,
      confidence: "confirmed",
      supportingStatementIds: [ids["fix"]],
    });
    expect(view.records.lifeStatus.supportingStatementIds).toEqual([ids["maria"]]);
    // The page says it in the app's own words (cat-spotter/lib/i18n.ts).
    expect(await catHtml()).toContain(
      '<p class="public">Lives on the street · Not sterilised — Syros Cats&#39; records</p>',
    );
  });

  it("shows every photo through the team photo route, never a public address", async () => {
    const { view, text } = await catJson();
    expect(view.photos.map((p) => p.url)).toEqual(
      ["main", "s1", "s0", "ear"].map((n) => `/api/team/photos/${PREFIX}${n}`),
    );
    expect(text).not.toContain("/api/photos/");
    expect(await catHtml()).not.toContain("/api/photos/");
  });

  it("answers 404 for a cat that doesn't exist, or an id that isn't a number", async () => {
    for (const id of ["999999999", "abc", "1e3", "-1"]) {
      const res = await request(app).get(`/api/team/cats/${id}`).set("Cookie", cookie);
      expect(res.status, id).toBe(404);
    }
  });
});

describe("P3-3: a replaced statement stays, with what replaced it and why", () => {
  it("keeps the replaced statement in the history, pointing at its replacement", async () => {
    const { view } = await catJson();
    const wrong = view.history.find((s) => s.id === ids["wrong"])!;
    const fix = view.history.find((s) => s.id === ids["fix"])!;
    expect(wrong).toMatchObject({ said: "Sterilised", replacedBy: [ids["fix"]], reason: "Vet said so" });
    expect(fix).toMatchObject({
      said: "Not sterilised",
      replaces: ids["wrong"],
      reason: "That was a different cat at the clinic",
    });
    // Newest first.
    expect(view.history.map((s) => s.id)).toEqual(
      ["stranger", "fix", "wrong", "maria", "spotterNote", "spotterEar", "vision", "imported"].map(
        (k) => ids[k],
      ),
    );
  });

  it("draws it struck through, with the replacement and its reason underneath", async () => {
    const html = await catHtml();
    const item = html.slice(html.indexOf(`id="s-${ids["wrong"]}"`));
    const end = item.indexOf("</li>");
    const wrongItem = item.slice(0, end);
    expect(wrongItem).toContain("<del>Sterilised</del>");
    expect(wrongItem).toContain(
      `Replaced by <a href="#s-${ids["fix"]}">#${ids["fix"]}</a>: Not sterilised. Why: That was a different cat at the clinic`,
    );
    expect(wrongItem).toContain("Susan");
  });
});

describe("P3-4: who said it", () => {
  it("labels each author: a spotter, a team member (left), imported, the model, an unknown account", async () => {
    const { view } = await catJson();
    const label = (k: string) => view.history.find((s) => s.id === ids[k])!.author.label;
    expect(label("spotterEar")).toBe("a spotter");
    expect(label("spotterNote")).toBe("a spotter");
    expect(label("maria")).toBe("Maria (left)");
    expect(label("wrong")).toBe("Susan");
    expect(label("imported")).toBe("imported");
    expect(label("vision")).toBe("read automatically from the photo");
    expect(label("stranger")).toBe("someone no longer on the team list");
  });

  it("never sends a device id or a raw account id, in the page or the JSON", async () => {
    const { text } = await catJson();
    const html = await catHtml();
    for (const secret of [DEVICE, "SECRET-7f3a", mariaId, susanId, "system:", "old-admin-account-42"]) {
      expect(text, secret).not.toContain(secret);
      expect(html, secret).not.toContain(secret);
    }
    const search = await request(app)
      .get("/api/team/cats")
      .query({ q: "μιμη" })
      .set("Accept", "application/json")
      .set("Cookie", cookie);
    expect(search.text).not.toContain("SECRET-7f3a");
  });

  it("escapes what spotters and the team wrote", async () => {
    const html = await catHtml();
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("Sleeps on the &lt;b&gt;church&lt;/b&gt; steps");
  });
});

describe("design review fixes (PR 3)", () => {
  it("puts the cursor in an empty search, and helps when nothing matches", async () => {
    const empty = await request(app).get("/api/team/cats").set("Cookie", cookie);
    expect(empty.text).toMatch(/<input id="q"[^>]* autofocus/);
    const none = await request(app).get("/api/team/cats").query({ q: "zzzz" }).set("Cookie", cookie);
    expect(none.text).not.toMatch(/autofocus/);
    expect(none.text).toContain("try the SYR number");
  });

  it("puts the SYR number under the name, and the way back above it", async () => {
    const html = await catHtml();
    const syr = `SYR-${String(mimi).padStart(4, "0")}`;
    expect(html.indexOf("Find another cat")).toBeLessThan(html.indexOf("<h1>"));
    expect(html).toContain(`<h1>Μιμή</h1><p class="syrline">${syr}</p>`);
  });

  it("says in words what each answer rests on", async () => {
    const html = await catHtml();
    expect(html).toContain(`<a href="#s-${ids["maria"]}">Lives on the street</a> <span class="meta">(Maria (left), `);
    expect(html).toContain(`<a href="#s-${ids["fix"]}">Not sterilised</a>`);
    expect(html).toContain("Seen in 1 sighting");
  });

  it("gives every photo link a name a screen reader can say", async () => {
    const html = await catHtml();
    expect(html).not.toMatch(/<a [^>]*><img [^>]*alt=""[^>]*><\/a>/);
    expect(html).toContain('alt="Photo 1 of 4"');
    expect(html).toMatch(/alt="Photo from the sighting on [^"]+"/);
  });

  it("escapes the statements an answer rests on, both what was said and who said it", async () => {
    const eve = await addPerson({
      email: `vitest-p3-eve-${RUN}@example.com`,
      name: "Eve <b>Bold</b>",
      addedBy: "cli:vitest",
    });
    const other = await cat(`${PREFIX}refs`, await photo("refs"));
    const [row] = await db
      .insert(observationsTable)
      .values({
        catId: other,
        kind: "sterilised",
        value: { sterilised: true, clinic: '<img src=x onerror="alert(2)">', reason: "vet" },
        accountId: eve.id,
        roleAtTime: "staff",
        observedAt: new Date(),
      })
      .returning({ id: observationsTable.id });
    const html = await catHtml(other);
    const basedOn = html.slice(html.indexOf("<dt>Why we think so</dt>", html.indexOf("<h3>Sterilised</h3>")));
    const refs = basedOn.slice(0, basedOn.indexOf("</dd>"));
    expect(refs).toContain(`href="#s-${row!.id}"`);
    expect(refs).toContain("&lt;img src=x onerror=&quot;alert(2)&quot;&gt;");
    expect(refs).toContain("Eve &lt;b&gt;Bold&lt;/b&gt;");
    expect(html).not.toContain('<img src=x onerror="alert(2)">');
    expect(html).not.toContain("<b>Bold</b>");
    await markLeft(`vitest-p3-eve-${RUN}@example.com`, "cli:vitest");
  });
});
