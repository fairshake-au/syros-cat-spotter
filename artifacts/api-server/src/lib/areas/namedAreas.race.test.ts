import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { db, peopleTable, pool } from "@workspace/db";

// SYC-396 PR 2.4, review of #245 (F2): a slow background reload that began
// before a change must not put the old list back on the server that made the
// change. The first version count is held until the change has been made.
// Its own point: the sea off Syros's north-west corner, about 2.9 km from
// Grammata.

let release: (() => void) | null = null;
let first = true;
vi.mock("./areaHistory", async (orig) => {
  const real = await orig<typeof import("./areaHistory")>();
  return {
    ...real,
    areaEventCount: async (...args: Parameters<typeof real.areaEventCount>) => {
      if (first) {
        first = false;
        const n = await real.areaEventCount(...args);
        await new Promise<void>((r) => (release = r));
        return n;
      }
      return real.areaEventCount(...args);
    },
  };
});

const { loadAreas, areaByKey } = await import("./namedAreas");
const { changeArea } = await import("./areaWrites");

afterAll(async () => {
  await pool.end();
});

describe("a slow reload against a change on the same server", () => {
  it("doesn't undo the change", async () => {
    const RUN = crypto.randomBytes(3).toString("hex");
    const [p] = await db
      .insert(peopleTable)
      .values({ email: `areas-race-${RUN}@example.com`, name: "Jacky", addedBy: "cli:test" })
      .returning({ id: peopleTable.id });
    const slow = loadAreas(); // reads the old list, then waits
    await vi.waitFor(() => expect(release).not.toBeNull());
    const K = `vt-${RUN}-race`;
    await changeArea({ id: p!.id }, { kind: "add", key: K, name: `VT ${RUN} Race`, lat: 37.515, lng: 24.862 });
    expect(areaByKey(K)).toBeDefined();
    release!();
    await slow;
    const kept = areaByKey(K) !== undefined;
    await changeArea({ id: p!.id }, { kind: "retire", key: K });
    expect(kept, "the area is still in this server's list after the slow reload").toBe(true);
  });
});
