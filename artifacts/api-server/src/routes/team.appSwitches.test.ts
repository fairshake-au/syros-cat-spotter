import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../app";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { clearAppSettingsCache, getAppSettings } from "../lib/appSettings";
import { guardianOn, newColony, signedPerson, type Signed } from "../test/roleKit";

// SYC-383: the App switches page. Team-only (edit_app_switches). The test
// database is shared, so both stored rows are put back as they were at the end.

const SESSION_KEY = "vitest-app-switches-key-0123456789abcdef-0123456789";
const URL_KEY = "feed_nudge_donate_url";
const FACTS_KEY = "starter_facts_hidden";
const PATH = "/api/team/app-switches";

let team: Signed;
let guardian: Signed;
const original = new Map<string, unknown>();

const stored = async (key: string) =>
  (await pool.query<{ value: unknown }>(`select value from app_settings where key = $1`, [key])).rows[0]?.value;
const settings = async () => {
  clearAppSettingsCache();
  return getAppSettings();
};
const put = async (key: string, value: unknown) => {
  await pool.query(
    `insert into app_settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`,
    [key, JSON.stringify(value)],
  );
  clearAppSettingsCache();
};

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = SESSION_KEY;
  team = await signedPerson("app-switches-team", ["staff"]);
  guardian = await guardianOn("app-switches-guardian", [await newColony("app-switches")]);
  for (const k of [URL_KEY, FACTS_KEY]) original.set(k, await stored(k));
});

beforeEach(async () => {
  process.env["TEAM_SESSION_KEYS"] = SESSION_KEY;
  await put(URL_KEY, "https://syroscats.com/donations");
  await put(FACTS_KEY, ["fact.earTip", "fact.cost"]);
});

afterAll(async () => {
  for (const [k, v] of original) {
    if (v === undefined) await pool.query(`delete from app_settings where key = $1`, [k]);
    else await put(k, v);
  }
  clearAppSettingsCache();
  await pool.end();
});

const page = (cookie: string, q = "") => request(app).get(PATH + q).set("Cookie", cookie).set("Accept", "text/html");
const send = (cookie: string, sub: string, body: Record<string, string>) =>
  request(app).post(`${PATH}/${sub}`).set("Origin", TEAM_ORIGIN).set("Cookie", cookie).set("Accept", "text/html").type("form").send(body);

describe("the App switches page", () => {
  it("shows the button's state, what visitors see under it, and every fact with Hide / Show", async () => {
    const res = await page(team.cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("<title>App switches");
    expect(res.text).toContain("<strong>On</strong>");
    expect(res.text).toContain("Opens syroscats.com in your browser");
    expect(res.text).toContain('name="address" value="https://syroscats.com/donations"');
    expect(res.text).toContain("18 of 20 shown");
    expect((res.text.match(/>Hide it</g) ?? []).length).toBe(18);
    expect((res.text.match(/>Show it</g) ?? []).length).toBe(2);
  });

  it("warns, without refusing, when the page is not syroscats.com", async () => {
    await put(URL_KEY, "https://example.org/give");
    const res = await page(team.cookie);
    expect(res.text).toContain("Opens example.org in your browser");
    expect(res.text).toContain("This isn't syroscats.com");
  });

  it("changes the address; the app reads it at once", async () => {
    const res = await send(team.cookie, "donation", { do: "on", address: " https://syroscats.com/donate-now " });
    expect([res.status, res.headers["location"]]).toEqual([303, `${PATH}?done=on`]);
    expect((await settings()).donateUrl).toBe("https://syroscats.com/donate-now");
    expect((await page(team.cookie, "?done=on")).text).toContain("The button is on, at the address below.");
  });

  it.each([
    ["http://syroscats.com/donations"],
    ["javascript:alert(1)"],
    ["https://user:pw@syroscats.com/x"],
    ["syroscats.com"],
    [""],
  ])("refuses %j with words beside the box, keeps what was typed, and writes nothing", async (typed) => {
    const before = await stored(URL_KEY);
    const res = await send(team.cookie, "donation", { do: "on", address: typed });
    expect(res.status).toBe(400);
    expect(res.text).toContain('role="alert"');
    expect(res.text).toContain('aria-invalid="true"');
    expect(await stored(URL_KEY)).toEqual(before);
  });

  it("asks before turning the button off, and changes nothing until Yes (SYC-738)", async () => {
    const ask = await send(team.cookie, "donation", { do: "off" });
    expect(ask.status).toBe(200);
    expect(ask.text).toContain("Turn the Help feed a cat button off?");
    expect(ask.text).toContain("within about a minute");
    expect(ask.text).toContain("You can turn it back on here.");
    expect(ask.text).toContain('name="confirm" value="1"');
    expect(ask.text).toContain(`href="${PATH}"`);
    expect(await stored(URL_KEY)).toBe("https://syroscats.com/donations");
  });

  it("turns the button off once confirmed (the app reads no link) and offers the standard address to turn it back on", async () => {
    const res = await send(team.cookie, "donation", { do: "off", confirm: "1" });
    expect([res.status, res.headers["location"]]).toEqual([303, `${PATH}?done=off`]);
    expect(await stored(URL_KEY)).toBe("");
    expect((await settings()).donateUrl).toBeNull();
    const after = await page(team.cookie);
    expect(after.text).toContain("<strong>Off</strong>");
    expect(after.text).toContain('value="https://syroscats.com/donations"');
    expect(after.text).toContain("Turn the button on");
  });

  it("turning the button on stays one tap, and the JSON route still acts in one step", async () => {
    await put(URL_KEY, "");
    const on = await send(team.cookie, "donation", { do: "on", address: "https://syroscats.com/donations" });
    expect(on.status).toBe(303);
    expect((await settings()).donateUrl).toBe("https://syroscats.com/donations");
    const json = await request(app).post(`${PATH}/donation`).set("Origin", TEAM_ORIGIN).set("Cookie", team.cookie).set("Accept", "application/json").type("form").send({ do: "off" });
    expect(json.status).toBe(200);
    expect((await settings()).donateUrl).toBeNull();
  });

  it("explains the page in plain words", async () => {
    const res = await page(team.cookie);
    expect(res.text).toContain("These switches change the public app for everyone, within about a minute.");
    expect(res.text).toContain("How this page works");
    expect(res.text).toContain("€1 feeds a cat for a day");
  });

  it("shows and hides one fact without touching the others", async () => {
    const show = await send(team.cookie, "fact", { id: "fact.earTip", shown: "1" });
    expect([show.status, show.headers["location"]]).toEqual([303, `${PATH}?done=shown#fact.earTip`]);
    expect((await settings()).hiddenFacts).toEqual(["fact.cost"]);
    const hide = await send(team.cookie, "fact", { id: "fact.milk", shown: "0" });
    expect(hide.headers["location"]).toBe(`${PATH}?done=hidden#fact.milk`);
    expect((await settings()).hiddenFacts).toEqual(["fact.cost", "fact.milk"]);
  });

  it("starts from the nine awaiting Syros Cats' yes when no row is stored", async () => {
    await pool.query(`delete from app_settings where key = $1`, [FACTS_KEY]);
    clearAppSettingsCache();
    const res = await send(team.cookie, "fact", { id: "fact.milk", shown: "0" });
    expect(res.status).toBe(303);
    expect((await settings()).hiddenFacts).toHaveLength(10);
  });

  it("refuses a fact that does not exist, and a missing state, and writes nothing", async () => {
    const before = await stored(FACTS_KEY);
    expect((await send(team.cookie, "fact", { id: "fact.nope", shown: "1" })).status).toBe(400);
    expect((await send(team.cookie, "fact", { id: "fact.milk" })).status).toBe(400);
    expect(await stored(FACTS_KEY)).toEqual(before);
  });

  it("a cat guardian gets 403 on the page and on both forms", async () => {
    const before = [await stored(URL_KEY), await stored(FACTS_KEY)];
    const g = await request(app).get(PATH).set("Cookie", guardian.cookie);
    expect([g.status, g.text]).toEqual([403, '{"error":"forbidden"}']);
    for (const [sub, body] of [
      ["donation", { do: "off" }],
      ["fact", { id: "fact.milk", shown: "0" }],
    ] as const) {
      const p = await request(app).post(`${PATH}/${sub}`).set("Origin", TEAM_ORIGIN).set("Cookie", guardian.cookie).type("form").send(body);
      expect([p.status, p.text]).toEqual([403, '{"error":"forbidden"}']);
    }
    expect([await stored(URL_KEY), await stored(FACTS_KEY)]).toEqual(before);
  });

  it("a POST from another site, or with no Origin, is refused", async () => {
    const before = await stored(URL_KEY);
    for (const origin of ["https://evil.example", undefined]) {
      const t = request(app).post(`${PATH}/donation`).set("Cookie", team.cookie).type("form");
      if (origin) t.set("Origin", origin);
      const res = await t.send({ do: "off" });
      expect([res.status, res.text]).toEqual([401, '{"error":"not_signed_in"}']);
    }
    expect(await stored(URL_KEY)).toEqual(before);
  });

  it("answers JSON too", async () => {
    const res = await request(app).get(PATH).set("Cookie", team.cookie).set("Accept", "application/json");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ donateUrl: "https://syroscats.com/donations", hiddenFacts: ["fact.earTip", "fact.cost"] });
  });

  it("is reachable: Settings links it", async () => {
    const settings = await request(app).get("/api/team/settings").set("Cookie", team.cookie).set("Accept", "text/html");
    expect(settings.status).toBe(200);
    expect(settings.text).toContain(`<a href="${PATH}"><span class="name">App switches</span>`);
  });
});
