import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../app";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { clearAppSettingsCache, getAppSettings } from "../lib/appSettings";
import { day } from "../lib/teamPages/vetSettingsPage";
import { guardianOn, newColony, signedPerson, type Signed } from "../test/roleKit";

// SYC-396 PR 3.1b (plan Task 3.1.2; dashboard §8.4, §10.3): the Vet settings
// page. Team-only (edit_vet_settings). The test database is shared, so each
// test works from the price as it finds it, and the stored row is put back as
// it was at the end.

const SESSION_KEY = "vitest-vet-settings-key-0123456789abcdef-0123456789";
const KEY = "standard_sterilisation_price_eur";
const PATH = "/api/team/vet-settings";

let team: Signed;
let guardian: Signed;
let original: { value: unknown } | undefined;

const other = (eur: number, by = 5) => (eur + by > 500 ? eur - by : eur + by);
const today = () => day(new Date());
const priceNow = async () => {
  clearAppSettingsCache();
  return (await getAppSettings()).sterilisationPriceEur;
};
const historyCount = async () =>
  (await pool.query<{ n: number }>(`select count(*)::int as n from mapping_events where subject_kind = 'vet_settings'`))
    .rows[0]!.n;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = SESSION_KEY;
  team = await signedPerson("vet-settings-team", ["staff"]);
  guardian = await guardianOn("vet-settings-guardian", [await newColony("vet-settings")]);
  original = (await pool.query<{ value: unknown }>(`select value from app_settings where key = $1`, [KEY])).rows[0];
});

beforeEach(() => {
  process.env["TEAM_SESSION_KEYS"] = SESSION_KEY;
});

afterAll(async () => {
  if (original) {
    await pool.query(`update app_settings set value = $2::jsonb where key = $1`, [KEY, JSON.stringify(original.value)]);
  } else {
    await pool.query(`delete from app_settings where key = $1`, [KEY]);
  }
  clearAppSettingsCache();
  await pool.end();
});

const page = (cookie: string) => request(app).get(PATH).set("Cookie", cookie).set("Accept", "text/html");
const send = (cookie: string, body: Record<string, string>) =>
  request(app).post(PATH).set("Origin", TEAM_ORIGIN).set("Cookie", cookie).set("Accept", "text/html").type("form").send(body);

describe("the Vet settings page", () => {
  it("shows the standard price and the form to change it", async () => {
    const eur = await priceNow();
    const res = await page(team.cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("<title>Vet settings");
    expect(res.text).toContain(`<strong>€${eur}</strong> per cat`);
    expect(res.text).toContain(`<form method="post" action="${PATH}">`);
    expect(res.text).toContain(`id="price" name="eur" value="${eur}"`);
    expect(res.text).toContain('<h2 id="history">History</h2>');
  });

  it("says what the price does, the planner's estimate included, without promising a delay (SYC-619 §9.3; SYC-621)", async () => {
    const res = await page(team.cookie);
    expect(res.text).toContain(
      "Each colony's trapping planner uses it for its estimate, and a vet visit with Sterilised ticked starts with it as its cost. Each visit's cost can still be changed.",
    );
    expect(res.text).not.toContain("within a minute");
  });

  it("a team member changes the price; the history shows the day, who, and before → after; this server uses it at once", async () => {
    const was = await priceNow();
    const next = other(was);
    const res = await send(team.cookie, { eur: String(next) });
    expect([res.status, res.headers["location"]]).toEqual([303, `${PATH}?done=changed`]);
    // Cached before the change? It is cleared: the new price at once.
    expect((await getAppSettings()).sterilisationPriceEur).toBe(next);

    const after = await request(app).get(`${PATH}?done=changed`).set("Cookie", team.cookie).set("Accept", "text/html");
    expect(after.text).toContain("The standard price was changed.");
    expect(after.text).toContain(`<strong>€${next}</strong> per cat`);
    expect(after.text).toContain(`${today()}</time> · Vt vet-settings-team · €${was} → €${next}`);
  });

  it("takes the price typed with a € sign or spaces", async () => {
    const was = await priceNow();
    const next = other(was, 2);
    const res = await send(team.cookie, { eur: ` €${next} ` });
    expect(res.status).toBe(303);
    expect(await priceNow()).toBe(next);
  });

  it.each([["0"], ["501"], ["12.50"], ["sixty"], [""]])(
    "refuses %j with words beside the box, keeps what was typed, and writes nothing",
    async (typed) => {
      const was = await priceNow();
      const before = await historyCount();
      const res = await send(team.cookie, { eur: typed });
      expect(res.status).toBe(400);
      const errAt = res.text.indexOf("Type a whole number of euros from 1 to 500.");
      const boxAt = res.text.indexOf('id="price"');
      expect(errAt).toBeGreaterThan(-1);
      expect(boxAt - errAt).toBeGreaterThan(0);
      expect(boxAt - errAt).toBeLessThan(300);
      expect(res.text).toContain(`name="eur" value="${typed}"`);
      expect(res.text).toContain('aria-invalid="true"');
      expect(await historyCount()).toBe(before);
      expect(await priceNow()).toBe(was);
    },
  );

  it("refuses the price it already is", async () => {
    const was = await priceNow();
    const res = await send(team.cookie, { eur: String(was) });
    expect(res.status).toBe(400);
    expect(res.text).toContain(`The standard price is already €${was}.`);
  });

  it("a cat guardian gets 403 on the page and on the form", async () => {
    const was = await priceNow();
    const g = await request(app).get(PATH).set("Cookie", guardian.cookie);
    expect([g.status, g.text]).toEqual([403, '{"error":"forbidden"}']);
    const p = await request(app)
      .post(PATH)
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", guardian.cookie)
      .type("form")
      .send({ eur: String(other(was)) });
    expect([p.status, p.text]).toEqual([403, '{"error":"forbidden"}']);
    expect(await priceNow()).toBe(was);
  });

  it("a POST from another site, or with no Origin, is refused", async () => {
    const was = await priceNow();
    for (const origin of ["https://evil.example", undefined]) {
      const t = request(app).post(PATH).set("Cookie", team.cookie).type("form");
      if (origin) t.set("Origin", origin);
      const res = await t.send({ eur: String(other(was)) });
      expect([res.status, res.text]).toEqual([401, '{"error":"not_signed_in"}']);
    }
    expect(await priceNow()).toBe(was);
  });

  it("the history's day reads 18 Oct 2026, and September is Sep (review of PR 3.1b)", () => {
    expect(day(new Date("2026-10-18T09:00:00Z"))).toBe("18 Oct 2026");
    expect(day(new Date("2026-09-03T09:00:00Z"))).toBe("3 Sep 2026");
    // Athens is ahead of UTC: late on 31 Dec in London is already the new year there.
    expect(day(new Date("2026-12-31T23:30:00Z"))).toBe("1 Jan 2027");
  });

  it("a JSON client may send the price as a number", async () => {
    const was = await priceNow();
    const next = other(was, 4);
    const res = await request(app)
      .post(PATH)
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", team.cookie)
      .set("Accept", "application/json")
      .send({ eur: next });
    expect([res.status, res.body.standardPriceEur]).toEqual([200, next]);
  });

  it("answers JSON too: the price and its history", async () => {
    const res = await request(app).get(PATH).set("Cookie", team.cookie).set("Accept", "application/json");
    expect(res.status).toBe(200);
    expect(res.body.standardPriceEur).toBe(await priceNow());
    expect(Array.isArray(res.body.changes)).toBe(true);
  });

  it("is reachable: Settings links it, just under the Areas link (SYC-694)", async () => {
    const settings = await request(app).get("/api/team/settings").set("Cookie", team.cookie).set("Accept", "text/html");
    expect(settings.status).toBe(200);
    const areas = settings.text.indexOf('href="/api/team/areas"');
    const vet = settings.text.indexOf(`<a href="${PATH}"><span class="name">Vet settings</span>`);
    expect(areas).toBeGreaterThan(-1);
    expect(vet).toBeGreaterThan(areas);
  });
});
