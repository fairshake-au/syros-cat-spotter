import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool, sightingsTable } from "@workspace/db";
import { daysAgo, moveKit } from "../test/moveKit";
import { countingPhones, isCountingPhone } from "./countingPhone";
import { TEAM_DESK_DEVICE } from "./teamDesk";

// which-cat-is-which.md §3.2, §9.6: a phone counts as a person once it has
// three resolved spots on three different Syros days. Used for duplicate
// points (PR 4.1) and the Possible duplicates ladder (PR 5.1).

const kit = moveKit("VitestCounting");
let cat: number;

beforeAll(async () => {
  await kit.cleanup();
  cat = await kit.cat();
});
afterAll(async () => {
  await kit.cleanup();
  await pool.end();
});

/** Midday in Athens, `n` days ago (well clear of midnight either side). */
const athensNoon = (n: number) => {
  const d = daysAgo(n);
  d.setUTCHours(10, 0, 0, 0);
  return d;
};

describe("countingPhones", () => {
  it("three resolved spots on three Syros days count; two days don't, however many spots", async () => {
    const three = kit.device();
    const twoDays = kit.device();
    for (const n of [9, 5, 2]) await kit.sighting(cat, three, athensNoon(n));
    for (const n of [9, 9, 9, 2, 2]) await kit.sighting(cat, twoDays, athensNoon(n));
    expect(await countingPhones([three, twoDays, null])).toEqual(new Set([three]));
    expect(await isCountingPhone(three)).toBe(true);
    expect(await isCountingPhone(twoDays)).toBe(false);
    expect(await isCountingPhone(null)).toBe(false);
  });

  it("days are Syros days: two spots late one Athens evening are one day", async () => {
    const phone = kit.device();
    // 21:30 and 21:54 UTC are 00:30 and 00:54 (summer) or 23:30 and 23:54
    // (winter) in Athens: one Athens day either way.
    const base = athensNoon(6);
    const sameNight = [new Date(base.getTime() + 11.5 * 3_600_000), new Date(base.getTime() + 11.9 * 3_600_000)];
    await kit.sighting(cat, phone, athensNoon(8));
    for (const at of sameNight) await kit.sighting(cat, phone, at);
    expect(await isCountingPhone(phone)).toBe(false);
    await kit.sighting(cat, phone, athensNoon(1));
    expect(await isCountingPhone(phone)).toBe(true);
  });

  it("a spot still waiting to be matched proves nothing", async () => {
    const phone = kit.device();
    await kit.sighting(cat, phone, athensNoon(7));
    await kit.sighting(cat, phone, athensNoon(5));
    await db.insert(sightingsTable).values({ deviceId: phone, photoId: await kit.photo(), lat: 37.44, lng: 24.94, status: "pending", createdAt: athensNoon(3) });
    expect(await isCountingPhone(phone)).toBe(false);
  });

  it("asOf counts only the spots sent by then", async () => {
    const phone = kit.device();
    for (const n of [12, 8, 2]) await kit.sighting(cat, phone, athensNoon(n));
    expect(await isCountingPhone(phone, { asOf: athensNoon(5) })).toBe(false);
    expect(await isCountingPhone(phone, { asOf: athensNoon(1) })).toBe(true);
  });

  it("the team desk is never a person", async () => {
    expect(await countingPhones([TEAM_DESK_DEVICE])).toEqual(new Set());
  });
});
