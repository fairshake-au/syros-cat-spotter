import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, inArray, like, sql } from "drizzle-orm";
import {
  addPerson,
  catsTable,
  db,
  markLeft,
  observationsTable,
  photosTable,
  pool,
  sightingsTable,
  type Observation,
} from "@workspace/db";
import app from "../app";
import { makeKey } from "../lib/teamAuth/__fixtures__/mint";
import {
  sessionCookieFor,
  signInThroughHandoff,
  TEAM_ORIGIN,
} from "../lib/teamAuth/__fixtures__/queueKit";
import { loadCatRecords } from "../lib/observations";
import { resolveCat } from "../lib/resolve";
import type { LikelyCat } from "../lib/likelyReview";

// SYC-43 part 2 plan, PR 4: the corrections. Tests P4-1 to P4-6.
//
// P4-4 needs a staff member who lacks exactly one capability. Today staff
// hold all twelve (capabilities.ts), so `can` is wrapped: `denied.cap`, when
// set, is refused to everyone, and everything else goes to the real `can`.
const denied = vi.hoisted(() => ({ cap: null as string | null }));
vi.mock("../lib/capabilities", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/capabilities")>();
  return {
    ...real,
    can: (...args: Parameters<typeof real.can>) =>
      args[1] === denied.cap ? false : real.can(...args),
  };
});

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-p4-${RUN}-`;
const SUSAN = `vitest-p4-susan-${RUN}@example.com`;
const VERA = `vitest-p4-vera-${RUN}@example.com`;
const KEY = "vitest-p4-key-0123456789abcdef-0123456789abcd";
const SPOTTER = `${PREFIX}spotter-device`;
const handoffKey = makeKey();

let cookie: string;
let volunteerCookie: string;
let susanId: string;
let n = 0;

async function cleanup() {
  await db.delete(sightingsTable).where(like(sightingsTable.deviceId, `${PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  await db.delete(photosTable).where(like(photosTable.publicId, `${PREFIX}%`));
}

async function photo(): Promise<{ id: number; publicId: string }> {
  n += 1;
  const publicId = `${PREFIX}photo-${n}`;
  const [p] = await db
    .insert(photosTable)
    .values({ publicId, data: Buffer.from(`fake ${n}`).toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  return { id: p!.id, publicId };
}

async function newCat(name?: string): Promise<number> {
  n += 1;
  const main = await photo();
  const [c] = await db
    .insert(catsTable)
    .values({
      name: name ?? `${PREFIX}cat-${n}`,
      description: "",
      primaryPhotoId: main.id,
      lat: 37.445,
      lng: 24.942,
      discovererDeviceId: SPOTTER,
    })
    .returning({ id: catsTable.id });
  return c!.id;
}

/** A spotter's clipped-ear answer on a resolved sighting, with its photo. */
async function spotterClip(catId: number, minutesAgo = 60) {
  const p = await photo();
  const when = new Date(Date.now() - minutesAgo * 60_000);
  const [s] = await db
    .insert(sightingsTable)
    .values({
      catId,
      deviceId: SPOTTER,
      photoId: p.id,
      lat: 37.4451,
      lng: 24.9421,
      status: "resolved",
      createdAt: when,
    })
    .returning({ id: sightingsTable.id });
  const [o] = await db
    .insert(observationsTable)
    .values({
      catId,
      kind: "ear_tip",
      value: { clipped: true, side: "left" },
      deviceId: SPOTTER,
      roleAtTime: "public",
      observedAt: when,
      photoId: p.id,
      sightingId: s!.id,
    })
    .returning();
  return { observation: o!, photo: p };
}

const rowsFor = (catId: number) =>
  db
    .select()
    .from(observationsTable)
    .where(eq(observationsTable.catId, catId))
    .orderBy(observationsTable.id);

/** The resolver's whole answer for one cat, as every reader sees it. */
async function snapshot(catId: number) {
  const r = (await loadCatRecords([catId])).get(catId)!;
  return resolveCat(r.observations, r.evidenceOfLife, new Date("2026-10-06T12:00:00Z"));
}

const form = (path: string, c = cookie) =>
  request(app).post(path).set("Origin", TEAM_ORIGIN).set("Cookie", c).type("form");

const likelyIds = async () => {
  const res = await request(app).get("/api/team/likely").set("Cookie", cookie).set("Accept", "application/json");
  expect(res.status).toBe(200);
  return (res.body.cats as LikelyCat[]).map((c) => c.catId);
};

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await cleanup();
  susanId = (await addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:vitest", roles: ["staff"] })).id;
  cookie = await signInThroughHandoff(app, handoffKey, susanId);
  const vera = await addPerson({ email: VERA, name: "Vera", addedBy: "cli:vitest", roles: ["volunteer"] });
  // A session held anyway: the hand-off gives a volunteer none (SYC-188).
  volunteerCookie = sessionCookieFor(vera.id);
});

beforeEach(() => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  denied.cap = null;
});

afterAll(async () => {
  await db.execute(sql`drop trigger if exists vt_p4_fail_name on observations`);
  await db.execute(sql`drop function if exists vt_p4_fail_name()`);
  await cleanup();
  await markLeft(SUSAN, "cli:vitest");
  await markLeft(VERA, "cli:vitest");
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

// ── P4-1 ───────────────────────────────────────────────────────────────────

describe("P4-1: each form appends exactly one signed observation, and changes nothing else", () => {
  it("life status, sterilisation, rename, mark wrong and Looks right", async () => {
    const catId = await newCat();
    const clip = await spotterClip(catId);
    const before = await rowsFor(catId);

    const steps: { post: () => request.Test; reason: string; kind: string }[] = [
      {
        post: () => form(`/api/team/cats/${catId}/life-status`).send({ status: "in_care", reason: "Taken in by Maria", date: "" }),
        reason: "Taken in by Maria",
        kind: "life_status",
      },
      {
        post: () => form(`/api/team/likely/${clip.observation.id}/looks-right`).send({}),
        reason: "Checked the photo on the Probably sterilised list",
        kind: "ear_tip",
      },
      {
        post: () =>
          form(`/api/team/cats/${catId}/sterilisation`).send({ sterilised: "yes", reason: "Vet's record", date: "2026-09-14", clinic: "Ermoupoli vet" }),
        reason: "Vet's record",
        kind: "sterilised",
      },
      {
        post: () => form(`/api/team/cats/${catId}/name`).send({ name: `${PREFIX}renamed`, reason: "What Syros Cats call her" }),
        reason: "What Syros Cats call her",
        kind: "name",
      },
    ];

    let seen = before;
    for (const step of steps) {
      const res = await step.post();
      expect(res.status, step.kind).toBe(303);
      const after = await rowsFor(catId);
      // Every earlier row is exactly as it was: nothing updated, nothing deleted.
      expect(after.slice(0, seen.length)).toEqual(seen);
      const added = after.slice(seen.length);
      expect(added, step.kind).toHaveLength(1);
      const row = added[0]!;
      expect(row).toMatchObject({
        kind: step.kind,
        roleAtTime: "staff",
        accountId: susanId,
        deviceId: null,
        supersedesId: null,
      });
      expect((row.value as { reason?: string }).reason).toBe(step.reason);
      seen = after;
    }

    // Mark wrong: the one correction that carries its reason in supersedeReason.
    const lifeRow = seen.find((r) => r.kind === "life_status")!;
    const res = await form(`/api/team/statements/${lifeRow.id}/wrong`).send({ choice: "street", reason: "Back on the street", date: "" });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toMatch(new RegExp(`^/api/team/cats/${catId}\\?done=wrong&s=\\d+#s-\\d+$`));
    const after = await rowsFor(catId);
    expect(after.slice(0, seen.length)).toEqual(seen);
    expect(after.slice(seen.length)).toHaveLength(1);
    expect(after.at(-1)).toMatchObject({
      kind: "life_status",
      value: { status: "street" },
      roleAtTime: "staff",
      accountId: susanId,
      supersedesId: lifeRow.id,
      supersedeReason: "Back on the street",
    });

    // The cat page shows the new statements, signed, with their reasons.
    const page = await request(app).get(`/api/team/cats/${catId}?done=wrong`).set("Cookie", cookie);
    expect(page.text).toContain("Saved. The correction is in the history below");
    expect(page.text).toContain("Why: Taken in by Maria");
    expect(page.text).toContain("Susan");
  });

  it("the database refuses an update to an observation (the append-only trigger stays the backstop)", async () => {
    const catId = await newCat();
    const { observation } = await spotterClip(catId);
    await expect(
      db.update(observationsTable).set({ value: { clipped: false } }).where(eq(observationsTable.id, observation.id)),
    ).rejects.toThrow();
  });

  it("a reason is required, and a form that fails writes nothing and never echoes what was typed", async () => {
    const catId = await newCat();
    const res = await form(`/api/team/cats/${catId}/life-status`).send({ status: "homed", reason: "  " });
    expect(res.status).toBe(400);
    expect(res.text).toContain("Say why");
    const bad = await form(`/api/team/cats/${catId}/life-status`).send({ status: "<b>nope</b>", reason: "x" });
    expect(bad.status).toBe(400);
    expect(bad.text).not.toContain("<b>nope</b>");
    expect(bad.text).not.toContain("&lt;b&gt;nope");
    expect(await rowsFor(catId)).toHaveLength(0);
  });

  it("deceased needs the date the team knows of, and a date in the future is refused", async () => {
    const catId = await newCat();
    const noDate = await form(`/api/team/cats/${catId}/life-status`).send({ status: "deceased", reason: "Found by the road", date: "" });
    expect(noDate.status).toBe(400);
    expect(noDate.text).toContain("give the date");
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const future = await form(`/api/team/cats/${catId}/life-status`).send({ status: "deceased", reason: "Found by the road", date: tomorrow });
    expect(future.status).toBe(400);
    expect(future.text).toContain("can&#39;t be in the future");
    expect(await rowsFor(catId)).toHaveLength(0);

    const ok = await form(`/api/team/cats/${catId}/life-status`).send({ status: "deceased", reason: "Found by the road", date: "2026-09-30" });
    expect(ok.status).toBe(303);
    const [row] = await rowsFor(catId);
    expect(row!.observedAt.toISOString()).toBe("2026-09-30T12:00:00.000Z");
    expect((await snapshot(catId)).lifeStatus).toBe("deceased");
  });

  it("a reason with markup is shown as text on the cat page", async () => {
    const catId = await newCat();
    await form(`/api/team/cats/${catId}/life-status`).send({ status: "homed", reason: '<script>alert(1)</script> "x"' });
    const page = await request(app).get(`/api/team/cats/${catId}`).set("Cookie", cookie);
    expect(page.text).not.toContain("<script>alert(1)</script>");
    expect(page.text).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &quot;x&quot;");
  });
});

// ── P4-2 ───────────────────────────────────────────────────────────────────

describe("P4-2: the Probably sterilised list", () => {
  it("Looks right keeps the cat Likely, unchanged, and off the list; a newer spotter clip puts it back; That's not a clip makes it Not known yet", async () => {
    const catId = await newCat();
    const first = await spotterClip(catId, 120);
    expect(await likelyIds()).toContain(catId);

    const beforeSnapshot = await snapshot(catId);
    const beforePublic = (await request(app).get(`/api/cats/${catId}`)).body;
    expect(beforeSnapshot.sterilised.confidence).toBe("likely");

    const agreed = await form(`/api/team/likely/${first.observation.id}/looks-right`).send({});
    expect(agreed.status).toBe(303);
    expect(agreed.headers["location"]).toBe("/api/team/likely?done=looks_right");

    // The resolved answer is identical, the public payload byte for byte.
    expect(await snapshot(catId)).toEqual(beforeSnapshot);
    expect((await request(app).get(`/api/cats/${catId}`)).body).toEqual(beforePublic);
    expect(await likelyIds()).not.toContain(catId);

    // The agreement links to the spotter's statement, with no photo of its own.
    const agreement = (await rowsFor(catId)).at(-1)!;
    expect(agreement).toMatchObject({
      kind: "ear_tip",
      roleAtTime: "staff",
      photoId: null,
      sightingId: first.observation.sightingId,
      observedAt: first.observation.observedAt,
      value: { clipped: true, side: "left", agreesWith: first.observation.id },
    });

    // Tapping it again (a stale page): nothing more is written.
    const again = await form(`/api/team/likely/${first.observation.id}/looks-right`).send({});
    expect(again.headers["location"]).toBe("/api/team/likely?done=already");
    expect((await rowsFor(catId)).filter((r) => r.roleAtTime === "staff")).toHaveLength(1);

    // A newer spotter answer puts it back on the list.
    const second = await spotterClip(catId, 10);
    const listed = await likelyIds();
    expect(listed).toContain(catId);

    // That's not a clip, from the list.
    const notClip = await form(`/api/team/statements/${second.observation.id}/wrong`).send({
      choice: "not_clipped",
      back: "likely",
      reason: "Torn ear, not a clip",
    });
    expect(notClip.status).toBe(303);
    expect(notClip.headers["location"]).toBe("/api/team/likely?done=not_clipped");
    const after = await snapshot(catId);
    expect(after.sterilised.confidence).toBe("unknown");
    expect(after.sterilised.value).toBeNull();
    expect(await likelyIds()).not.toContain(catId);
    const page = await request(app).get(`/api/team/cats/${catId}`).set("Cookie", cookie);
    expect(page.text).toContain("Not known yet");
  });

  it("an agreement with an answer that has since been replaced no longer keeps the cat off the list (Opus review, S1)", async () => {
    const catId = await newCat();
    await spotterClip(catId, 120);
    const newer = await spotterClip(catId, 60);
    await form(`/api/team/likely/${newer.observation.id}/looks-right`).send({});
    expect(await likelyIds()).not.toContain(catId);
    // The spotter changes their own answer to "looks whole".
    await db.insert(observationsTable).values({
      catId,
      kind: "ear_tip",
      value: { clipped: false },
      deviceId: SPOTTER,
      roleAtTime: "public",
      observedAt: new Date(),
      supersedesId: newer.observation.id,
      supersedeReason: "changed my answer",
    });
    // The older spotter photo still makes it Likely, and nobody has agreed with that one.
    expect((await snapshot(catId)).sterilised.confidence).toBe("likely");
    expect(await likelyIds()).toContain(catId);
  });

  it("the page shows the two buttons and the notice after an action", async () => {
    const catId = await newCat();
    const { observation } = await spotterClip(catId);
    const res = await request(app).get("/api/team/likely?done=looks_right").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`action="/api/team/likely/${observation.id}/looks-right"`);
    expect(res.text).toContain(`action="/api/team/statements/${observation.id}/wrong"`);
    expect(res.text).toContain("That's not a clip</button>");
    expect(res.text).toContain('name="choice" value="not_clipped"');
    expect(res.text).toContain("Saved. The cat stays Probably sterilised");
    // The nav link is on.
    expect(res.text).toContain('<a class="here" href="/api/team/likely" aria-current="page">Probably sterilised</a>');
  });

  it("an unknown done= is never shown", async () => {
    const res = await request(app).get("/api/team/likely?done=%3Cscript%3E").set("Cookie", cookie);
    expect(res.text).not.toContain("<script>");
    expect(res.text).not.toContain('class="notice"');
  });
});

// ── P4-3 ───────────────────────────────────────────────────────────────────

describe("P4-3: renaming a cat", () => {
  it("writes the column and the name observation together, or neither", async () => {
    const catId = await newCat();
    const oldName = `${PREFIX}old-${RUN}`;
    await db.update(catsTable).set({ name: oldName }).where(eq(catsTable.id, catId));

    // A failure in the second write (the name observation).
    await db.execute(sql`
      create or replace function vt_p4_fail_name() returns trigger language plpgsql as $$
      begin
        if new.kind = 'name' and new.value->>'reason' = 'FORCE-FAIL' then
          raise exception 'vt-p4 forced failure';
        end if;
        return new;
      end $$`);
    await db.execute(sql`
      create trigger vt_p4_fail_name before insert on observations
      for each row execute function vt_p4_fail_name()`);
    try {
      const failed = await form(`/api/team/cats/${catId}/name`).send({ name: `${PREFIX}new-${RUN}`, reason: "FORCE-FAIL" });
      expect(failed.status).toBe(500);
    } finally {
      await db.execute(sql`drop trigger if exists vt_p4_fail_name on observations`);
      await db.execute(sql`drop function if exists vt_p4_fail_name()`);
    }
    const [still] = await db.select({ name: catsTable.name }).from(catsTable).where(eq(catsTable.id, catId));
    expect(still!.name).toBe(oldName);
    expect(await rowsFor(catId)).toHaveLength(0);

    // Without the failure, both are written.
    const ok = await form(`/api/team/cats/${catId}/name`).send({ name: `  ${PREFIX}new-${RUN} `, reason: "The name Syros Cats use" });
    expect(ok.status).toBe(303);
    expect(ok.headers["location"]).toBe(`/api/team/cats/${catId}?done=renamed#corrections`);
    const [renamed] = await db
      .select({ name: catsTable.name, normalisedName: catsTable.normalisedName })
      .from(catsTable)
      .where(eq(catsTable.id, catId));
    expect(renamed!.name).toBe(`${PREFIX}new-${RUN}`);
    const rows = await rowsFor(catId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "name",
      roleAtTime: "staff",
      accountId: susanId,
      value: { name: renamed!.name, normalised: renamed!.normalisedName, reason: "The name Syros Cats use" },
    });
  });

  it("refuses a name another cat has, once folded, and names that cat", async () => {
    const holder = await newCat(`Μιμή-${RUN}`);
    const catId = await newCat();
    const res = await form(`/api/team/cats/${catId}/name`).send({ name: `ΜΙΜΗ-${RUN}`, reason: "Respell" });
    expect(res.status).toBe(409);
    expect(res.text).toContain(`Μιμή-${RUN}`);
    expect(res.text).toContain(`href="/api/team/cats/${holder}"`);
    expect(res.text).toContain(`SYR-${String(holder).padStart(4, "0")}`);
    const json = await request(app)
      .post(`/api/team/cats/${catId}/name`)
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", cookie)
      .send({ name: `μιμη-${RUN}`, reason: "Respell" });
    expect(json.status).toBe(409);
    expect(json.body).toEqual({ error: "Cat name already taken", code: "NAME_TAKEN", cat: { id: holder, name: `Μιμή-${RUN}` } });
    expect(await rowsFor(catId)).toHaveLength(0);
    await db.delete(catsTable).where(inArray(catsTable.id, [holder]));
  });

  it("lets a cat's own name be respelt, and refuses names the word filter refuses", async () => {
    const catId = await newCat(`Λουλού-${RUN}`);
    const respelt = await form(`/api/team/cats/${catId}/name`).send({ name: `ΛΟΥΛΟΥ-${RUN}`, reason: "Capitals" });
    expect(respelt.status).toBe(303);
    const rude = await form(`/api/team/cats/${catId}/name`).send({ name: "malakas", reason: "x" });
    expect(rude.status).toBe(400);
    expect(rude.text).toContain("word filter");
    const [c] = await db.select({ name: catsTable.name }).from(catsTable).where(eq(catsTable.id, catId));
    expect(c!.name).toBe(`ΛΟΥΛΟΥ-${RUN}`);
    await db.delete(catsTable).where(eq(catsTable.id, catId));
  });
});

// ── P4-4 ───────────────────────────────────────────────────────────────────

describe("P4-4: each form is refused without its capability", () => {
  async function routes() {
    const catId = await newCat();
    const life = await db
      .insert(observationsTable)
      .values({ catId, kind: "life_status", value: { status: "street" }, deviceId: SPOTTER, roleAtTime: "public", observedAt: new Date() })
      .returning();
    const { observation: clip } = await spotterClip(catId);
    return {
      catId,
      forms: [
        { cap: "set_life_status", path: `/api/team/cats/${catId}/life-status`, body: { status: "homed", reason: "r" } },
        { cap: "set_sterilisation", path: `/api/team/cats/${catId}/sterilisation`, body: { sterilised: "yes", reason: "r" } },
        { cap: "rename_cat", path: `/api/team/cats/${catId}/name`, body: { name: `${PREFIX}cap-${n}`, reason: "r" } },
        { cap: "set_life_status", path: `/api/team/statements/${life[0]!.id}/wrong`, body: { choice: "homed", reason: "r" } },
        { cap: "set_sterilisation", path: `/api/team/statements/${clip.id}/wrong`, body: { choice: "not_clipped", reason: "r" } },
        { cap: "set_sterilisation", path: `/api/team/likely/${clip.id}/looks-right`, body: {} },
      ],
    };
  }

  it("a person whose scopes grant nothing gets the identical 401, and nothing is written", async () => {
    const { catId, forms } = await routes();
    const before = await rowsFor(catId);
    for (const f of forms) {
      const res = await form(f.path, volunteerCookie).send(f.body);
      expect([res.status, res.text], f.path).toEqual([401, '{"error":"not_signed_in"}']);
    }
    expect(await rowsFor(catId)).toEqual(before);
  });

  it("staff lacking exactly that form's capability get the identical 401, and nothing is written", async () => {
    const { catId, forms } = await routes();
    const before = await rowsFor(catId);
    for (const f of forms) {
      denied.cap = f.cap;
      const res = await form(f.path).send(f.body);
      expect([res.status, res.text], `${f.path} without ${f.cap}`).toEqual([401, '{"error":"not_signed_in"}']);
    }
    denied.cap = null;
    expect(await rowsFor(catId)).toEqual(before);
    const [c] = await db.select({ name: catsTable.name }).from(catsTable).where(eq(catsTable.id, catId));
    expect(c!.name).not.toContain("cap-");
  });

  it("the cat page hides a form from someone without its capability", async () => {
    const catId = await newCat();
    await spotterClip(catId);
    denied.cap = "rename_cat";
    const page = await request(app).get(`/api/team/cats/${catId}`).set("Cookie", cookie);
    expect(page.text).not.toContain(`/api/team/cats/${catId}/name"`);
    expect(page.text).toContain(`/api/team/cats/${catId}/life-status"`);
    expect(page.text).toContain("not_clipped");
    denied.cap = "set_sterilisation";
    const page2 = await request(app).get(`/api/team/cats/${catId}`).set("Cookie", cookie);
    expect(page2.text).not.toContain("/sterilisation");
    expect(page2.text).not.toContain("not_clipped");
  });

  it("every POST is refused from another Origin, before anything is read", async () => {
    const { forms } = await routes();
    for (const f of forms) {
      const res = await request(app).post(f.path).set("Origin", "https://evil.catspotters.com").set("Cookie", cookie).type("form").send(f.body);
      expect([res.status, res.text], f.path).toEqual([401, '{"error":"not_signed_in"}']);
      const none = await request(app).post(f.path).set("Cookie", cookie).type("form").send(f.body);
      expect(none.status, `${f.path} with no Origin`).toBe(401);
    }
  });
});

// ── P4-5 ───────────────────────────────────────────────────────────────────

describe("P4-5: the Probably sterilised list shows photos only through the team route", () => {
  it("HTML and both JSON routes", async () => {
    const catId = await newCat();
    const { photo: p } = await spotterClip(catId);
    const html = await request(app).get("/api/team/likely").set("Cookie", cookie);
    const json = await request(app).get("/api/team/likely").set("Cookie", cookie).set("Accept", "application/json");
    const pr8 = await request(app).get("/api/team/observations/review/likely").set("Cookie", cookie);
    expect(html.text).not.toContain("/api/photos/");
    expect(html.text).toContain(`src="/api/team/photos/${p.publicId}"`);
    for (const body of [json.body, pr8.body]) {
      const entry = (body.cats as LikelyCat[]).find((c) => c.catId === catId)!;
      expect(entry.evidence.length).toBeGreaterThan(0);
      for (const e of entry.evidence) expect(e.photoUrl).toBe(`/api/team/photos/${p.publicId}`);
      for (const c of body.cats as LikelyCat[])
        for (const e of c.evidence) if (e.photoUrl) expect(e.photoUrl).toMatch(/^\/api\/team\/photos\//);
    }
    // And the photo loads there for the team.
    const img = await request(app).get(`/api/team/photos/${p.publicId}`).set("Cookie", cookie);
    expect(img.status).toBe(200);
  });
});

// ── P4-6 ───────────────────────────────────────────────────────────────────

describe("P4-6: the forms and PR 8's JSON route write identical rows", () => {
  const comparable = (o: Observation) => {
    const { id: _id, catId: _cat, createdAt: _created, ...rest } = o;
    return rest;
  };

  it("life status", async () => {
    const viaForm = await newCat();
    const viaJson = await newCat();
    expect((await form(`/api/team/cats/${viaForm}/life-status`).send({ status: "homed", reason: "Adopted by the baker", date: "2026-09-20" })).status).toBe(303);
    const json = await request(app)
      .post("/api/team/observations")
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", cookie)
      .send({ catId: viaJson, kind: "life_status", value: { status: "homed" }, reason: "Adopted by the baker", observedAt: "2026-09-20T12:00:00Z" });
    expect(json.status).toBe(201);
    const [a] = await rowsFor(viaForm);
    const [b] = await rowsFor(viaJson);
    expect(comparable(a!)).toEqual(comparable(b!));
  });

  it("sterilisation", async () => {
    const viaForm = await newCat();
    const viaJson = await newCat();
    expect((await form(`/api/team/cats/${viaForm}/sterilisation`).send({ sterilised: "no", reason: "Checked at the clinic", date: "2026-09-21", clinic: "" })).status).toBe(303);
    const json = await request(app)
      .post("/api/team/observations")
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", cookie)
      .send({ catId: viaJson, kind: "sterilised", value: { sterilised: false }, reason: "Checked at the clinic", observedAt: "2026-09-21T12:00:00Z" });
    expect(json.status).toBe(201);
    const [a] = await rowsFor(viaForm);
    const [b] = await rowsFor(viaJson);
    expect(comparable(a!)).toEqual(comparable(b!));
  });

  it("a correction (mark wrong) and PR 8's supersede", async () => {
    const catId = await newCat();
    const { observation: one } = await spotterClip(catId, 30);
    const { observation: two } = await spotterClip(catId, 20);
    const t = "2026-10-01T12:00:00.000Z";
    expect((await form(`/api/team/statements/${one.id}/wrong`).send({ choice: "not_clipped", reason: "Torn ear", date: "2026-10-01" })).status).toBe(303);
    const json = await request(app)
      .post(`/api/team/observations/${two.id}/supersede`)
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", cookie)
      .send({ value: { clipped: false }, reason: "Torn ear", observedAt: t });
    expect(json.status).toBe(201);
    const rows = await rowsFor(catId);
    const a = rows.find((r) => r.supersedesId === one.id)!;
    const b = rows.find((r) => r.supersedesId === two.id)!;
    const { supersedesId: _a, ...ra } = comparable(a);
    const { supersedesId: _b, ...rb } = comparable(b);
    expect(ra).toEqual(rb);
  });
});

// ── "Someone already corrected this." ──────────────────────────────────────

describe("a statement corrected twice", () => {
  it("the second correction writes nothing and the page says someone already corrected it", async () => {
    const catId = await newCat();
    const { observation } = await spotterClip(catId);
    const first = await form(`/api/team/statements/${observation.id}/wrong`).send({ choice: "not_clipped", reason: "Torn ear" });
    expect(first.status).toBe(303);
    const second = await form(`/api/team/statements/${observation.id}/wrong`).send({ choice: "not_clipped", reason: "Also torn" });
    expect(second.status).toBe(303);
    expect(second.headers["location"]).toBe(`/api/team/cats/${catId}?done=already&s=${observation.id}#s-${observation.id}`);
    expect((await rowsFor(catId)).filter((r) => r.supersedesId === observation.id)).toHaveLength(1);
    const page = await request(app).get(second.headers["location"]!).set("Cookie", cookie);
    expect(page.text).toContain("Someone already corrected this.");
    // Beside the statement the page lands on, not at the top out of sight.
    expect(page.text).toContain(`id="s-${observation.id}"><p class="notice" role="status">Someone already corrected this.`);
    // Once only.
    expect(page.text.split("Someone already corrected this.")).toHaveLength(2);
    // The corrected statement offers no second correction.
    expect(page.text).not.toContain(`action="/api/team/statements/${observation.id}/wrong"`);

    const fromList = await form(`/api/team/statements/${observation.id}/wrong`).send({ choice: "not_clipped", back: "likely", reason: "Again" });
    expect(fromList.headers["location"]).toBe("/api/team/likely?done=already");
    const json = await request(app)
      .post(`/api/team/statements/${observation.id}/wrong`)
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", cookie)
      .send({ choice: "not_clipped", reason: "Again" });
    expect(json.status).toBe(409);
  });

  it("only one of several concurrent corrections of the same statement is written", async () => {
    const catId = await newCat();
    const { observation } = await spotterClip(catId);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        form(`/api/team/statements/${observation.id}/wrong`).send({ choice: "not_clipped", reason: `Torn ear ${i}` }),
      ),
    );
    const already = results.filter((r) => String(r.headers["location"]).includes("done=already"));
    expect(already).toHaveLength(5);
    expect((await rowsFor(catId)).filter((r) => r.supersedesId === observation.id)).toHaveLength(1);
  });

  it("a burst of Looks right taps on many cats doesn't exhaust the connection pool (pre-merge review, S1)", async () => {
    const clips = [];
    for (let i = 0; i < 14; i++) {
      const catId = await newCat();
      clips.push((await spotterClip(catId)).observation.id);
    }
    const results = await Promise.all(
      clips.flatMap((id) => [
        form(`/api/team/likely/${id}/looks-right`).send({}),
        form(`/api/team/likely/${id}/looks-right`).send({}),
      ]),
    );
    expect(results.every((r) => r.status === 303)).toBe(true);
  }, 20_000);

  it("only one of several concurrent Looks right taps is written", async () => {
    const catId = await newCat();
    const { observation } = await spotterClip(catId);
    await Promise.all(
      Array.from({ length: 6 }, () => form(`/api/team/likely/${observation.id}/looks-right`).send({})),
    );
    expect((await rowsFor(catId)).filter((r) => r.roleAtTime === "staff")).toHaveLength(1);
  });
});

// ── Edges the adversarial review found ─────────────────────────────────────

describe("edges", () => {
  it("?done= never reaches Object.prototype (constructor, __proto__, toString)", async () => {
    const catId = await newCat();
    for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      const page = await request(app).get(`/api/team/cats/${catId}?done=${key}`).set("Cookie", cookie);
      expect(page.status, key).toBe(200);
      expect(page.text).not.toContain('class="notice"');
      const list = await request(app).get(`/api/team/likely?done=${key}`).set("Cookie", cookie);
      expect(list.status, key).toBe(200);
    }
  });

  it("refuses a date that isn't a real day, on every form that takes one", async () => {
    const catId = await newCat();
    const life = await db
      .insert(observationsTable)
      .values({ catId, kind: "life_status", value: { status: "street" }, deviceId: SPOTTER, roleAtTime: "public", observedAt: new Date() })
      .returning();
    for (const date of ["2026-02-31", "2026-04-31", "2026-13-01", "0000-01-01", "1899-12-31"]) {
      const a = await form(`/api/team/cats/${catId}/life-status`).send({ status: "deceased", reason: "r", date });
      const b = await form(`/api/team/cats/${catId}/sterilisation`).send({ sterilised: "yes", reason: "r", date });
      const c = await form(`/api/team/statements/${life[0]!.id}/wrong`).send({ choice: "deceased", reason: "r", date });
      expect([a.status, b.status, c.status], date).toEqual([400, 400, 400]);
    }
    expect(await rowsFor(catId)).toHaveLength(1);
  });

  it("refuses a future date on sterilisation and mark wrong, and deceased without a date on mark wrong", async () => {
    const catId = await newCat();
    const life = await db
      .insert(observationsTable)
      .values({ catId, kind: "life_status", value: { status: "street" }, deviceId: SPOTTER, roleAtTime: "public", observedAt: new Date() })
      .returning();
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const st = await form(`/api/team/cats/${catId}/sterilisation`).send({ sterilised: "yes", reason: "r", date: tomorrow });
    const wr = await form(`/api/team/statements/${life[0]!.id}/wrong`).send({ choice: "homed", reason: "r", date: tomorrow });
    const dead = await form(`/api/team/statements/${life[0]!.id}/wrong`).send({ choice: "deceased", reason: "r", date: "" });
    expect([st.status, wr.status, dead.status]).toEqual([400, 400, 400]);
    expect(dead.text).toContain("give the date");
    expect(await rowsFor(catId)).toHaveLength(1);
  });

  it("dates are Syros dates: just after midnight in Athens, 'today' is already the next day", async () => {
    const { athensToday, observedAtFor } = await import("./teamCorrections");
    const lateUtc = new Date("2026-10-06T22:30:00Z"); // 01:30 on 7 Oct in Athens
    expect(athensToday(lateUtc)).toBe("2026-10-07");
    // Today's midday hasn't come yet: "now", never a time in the future.
    expect(observedAtFor("2026-10-07", lateUtc)).toEqual(lateUtc);
    expect(observedAtFor("2026-10-05", lateUtc).toISOString()).toBe("2026-10-05T12:00:00.000Z");
  });

  it("stores a reason's line breaks as LF", async () => {
    const catId = await newCat();
    await form(`/api/team/cats/${catId}/life-status`).send({ status: "homed", reason: "Adopted\r\nby the baker" });
    const [row] = await rowsFor(catId);
    expect((row!.value as { reason: string }).reason).toBe("Adopted\nby the baker");
  });

  it("the list orders answers by when they were recorded, not the date they claim", async () => {
    const catId = await newCat();
    const { observation } = await spotterClip(catId, 60);
    await form(`/api/team/likely/${observation.id}/looks-right`).send({});
    expect(await likelyIds()).not.toContain(catId);
    // A late-synced spotter answer: recorded now, but dated before the first.
    await spotterClip(catId, 600);
    expect(await likelyIds()).toContain(catId);
  });

  it("Looks right on the team's own answer, or on a cat no longer Likely, writes nothing", async () => {
    const catId = await newCat();
    const { observation } = await spotterClip(catId);
    await form(`/api/team/likely/${observation.id}/looks-right`).send({});
    const agreement = (await rowsFor(catId)).at(-1)!;
    const own = await form(`/api/team/likely/${agreement.id}/looks-right`).send({});
    expect(own.headers["location"]).toBe("/api/team/likely?done=already");

    const other = await newCat();
    const { observation: clip } = await spotterClip(other);
    await form(`/api/team/cats/${other}/sterilisation`).send({ sterilised: "yes", reason: "Vet's record" });
    const stale = await form(`/api/team/likely/${clip.id}/looks-right`).send({});
    expect(stale.headers["location"]).toBe("/api/team/likely?done=already");
    expect((await rowsFor(other)).filter((r) => r.kind === "ear_tip" && r.roleAtTime === "staff")).toHaveLength(0);
    expect((await rowsFor(catId)).filter((r) => r.roleAtTime === "staff")).toHaveLength(1);
  });
});
