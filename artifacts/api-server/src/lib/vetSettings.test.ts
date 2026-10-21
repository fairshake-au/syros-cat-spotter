import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import { clearAppSettingsCache, getAppSettings } from "./appSettings";
import { PriceRefused, priceChanges, setStandardPrice } from "./vetSettings";
import { signedPerson, type Signed } from "../test/roleKit";

// SYC-396 PR 3.1b (plan Task 3.1.2; dashboard §8.4, §10.3): changing the
// standard sterilisation price writes the setting and its history row
// together, and this server uses the new price at once. The test database is
// shared, so each test works from the price as it finds it, and the stored
// row is put back as it was at the end.

const KEY = "standard_sterilisation_price_eur";
let team: Signed;
let original: { value: unknown } | undefined;

/** A price other than `eur`, inside 1 to 500. */
const other = (eur: number, by = 5) => (eur + by > 500 ? eur - by : eur + by);

const stored = async () =>
  (await pool.query<{ value: unknown }>(`select value from app_settings where key = $1`, [KEY])).rows[0]?.value;
const historyCount = async () =>
  (await pool.query<{ n: number }>(`select count(*)::int as n from mapping_events where subject_kind = 'vet_settings'`))
    .rows[0]!.n;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = "vitest-vet-settings-lib-0123456789abcdef-0123456789";
  team = await signedPerson("vet-settings-lib", ["staff"]);
  original = (await pool.query<{ value: unknown }>(`select value from app_settings where key = $1`, [KEY])).rows[0];
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

describe("setStandardPrice", () => {
  it("stores the price and one price_changed row with before and after, signed by the person", async () => {
    clearAppSettingsCache();
    const was = (await getAppSettings()).sterilisationPriceEur;
    const next = other(was);
    const before = await historyCount();

    expect(await setStandardPrice(team, next)).toEqual({ before: was, after: next });

    expect(await stored()).toBe(next);
    expect(await historyCount()).toBe(before + 1);
    const { rows } = await pool.query(
      `select subject_id, kind, person_id, before, after from mapping_events
        where subject_kind = 'vet_settings' order by id desc limit 1`,
    );
    expect(rows[0]).toEqual({ subject_id: 1, kind: "price_changed", person_id: team.id, before: { eur: was }, after: { eur: next } });
  });

  it("this server uses the new price at once, without waiting for the cache", async () => {
    clearAppSettingsCache();
    const was = (await getAppSettings()).sterilisationPriceEur; // now cached
    const next = other(was, 7);
    await setStandardPrice(team, next);
    expect((await getAppSettings()).sterilisationPriceEur).toBe(next);
  });

  it("setting €65 makes getAppSettings give 65 at once", async () => {
    clearAppSettingsCache();
    if ((await getAppSettings()).sterilisationPriceEur === 65) await setStandardPrice(team, 64);
    await getAppSettings(); // cached at the old price
    await setStandardPrice(team, 65);
    expect((await getAppSettings()).sterilisationPriceEur).toBe(65);
  });

  it.each([[0], [501], [-5], [12.5], [Number.NaN]])("refuses €%s with words, and writes nothing", async (eur) => {
    const before = await historyCount();
    const value = await stored();
    await expect(setStandardPrice(team, eur)).rejects.toThrow(PriceRefused);
    await expect(setStandardPrice(team, eur)).rejects.toThrow("Type a whole number of euros from 1 to 500.");
    expect(await historyCount()).toBe(before);
    expect(await stored()).toEqual(value);
  });

  it("refuses the price it already is, and writes nothing", async () => {
    clearAppSettingsCache();
    const was = (await getAppSettings()).sterilisationPriceEur;
    const before = await historyCount();
    await expect(setStandardPrice(team, was)).rejects.toThrow(`The standard price is already €${was}.`);
    expect(await historyCount()).toBe(before);
  });

  it("two changes at once both land, each with the right before", async () => {
    clearAppSettingsCache();
    const was = (await getAppSettings()).sterilisationPriceEur;
    const a = other(was, 11);
    const b = other(was, 13);
    const results = await Promise.all([setStandardPrice(team, a), setStandardPrice(team, b)]);
    // One went first from `was`; the other went from the first one's price.
    const first = results.find((r) => r.before === was)!;
    const second = results.find((r) => r !== first)!;
    expect(first).toBeDefined();
    expect(second.before).toBe(first.after);
    expect(await stored()).toBe(second.after);
  });
});

describe("priceChanges", () => {
  it("lists the changes newest first, with who made them", async () => {
    clearAppSettingsCache();
    const was = (await getAppSettings()).sterilisationPriceEur;
    const next = other(was, 3);
    await setStandardPrice(team, next);
    const [latest] = await priceChanges();
    expect(latest).toMatchObject({ who: "Vt vet-settings-lib", before: was, after: next });
    expect(latest!.at).toBeInstanceOf(Date);
  });
});
