import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import {
  _resetBatchFindLimitsForTests,
  _resetFindLimitsForTests,
  BATCH_FIND_PERSON_LIMIT,
  batchFindLimitReached,
  checkBatchFindLimits,
  checkFindLimits,
  findLimitReached,
  findPersonHits,
  findTeamHits,
} from "./rateLimit";

// SYC-677 Task 5: the batch photo-search limits. Counts are filled straight
// through the limiter (60 quick calls), never over the network.

const NOW = Date.parse("2026-10-24T10:00:00Z");

beforeEach(async () => {
  await _resetBatchFindLimitsForTests();
  await _resetFindLimitsForTests();
});
afterAll(async () => {
  await _resetBatchFindLimitsForTests();
  await _resetFindLimitsForTests();
  await pool.end();
});

describe("batch photo-search limits", () => {
  it("60 searches by one person pass and the 61st is refused as the person's", async () => {
    for (let i = 0; i < BATCH_FIND_PERSON_LIMIT; i++) expect(await checkBatchFindLimits("p-one", NOW)).toBe("ok");
    expect(await batchFindLimitReached("p-one", NOW)).toBe("person");
    expect(await checkBatchFindLimits("p-one", NOW)).toBe("person");
    expect(await checkBatchFindLimits("p-two", NOW)).toBe("ok");
  });

  it("is counted apart from the single-photo page's 20 and 100", async () => {
    for (let i = 0; i < 5; i++) await checkBatchFindLimits("p-sep", NOW);
    expect(await findPersonHits("p-sep", NOW)).toBe(0);
    expect(await findTeamHits(NOW)).toBe(0);
    expect(await findLimitReached("p-sep", NOW)).toBe("ok");

    await _resetBatchFindLimitsForTests();
    for (let i = 0; i < 3; i++) await checkFindLimits("p-sep", NOW);
    expect(await findPersonHits("p-sep", NOW)).toBe(3);
    for (let i = 0; i < 59; i++) expect(await checkBatchFindLimits("p-sep", NOW)).toBe("ok");
    expect(await findPersonHits("p-sep", NOW)).toBe(3);
  });
});
