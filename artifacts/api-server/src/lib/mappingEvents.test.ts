import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  feedingSitesTable,
  mappingEventsTable,
  peopleTable,
} from "@workspace/db";
import { MappingEventRefused, recordMappingEvent, type MappingEventInput } from "./mappingEvents";
import { SYSTEM_AUTHORS } from "./observations";

// SYC-209 PR 1.1: the one writer of the feeding-site and colony history. The
// database half (the add-only trigger, the checks) is proved in
// lib/db/src/migrate/feedingSitesHistory.test.ts. mapping_events rows can't
// be deleted, so nothing here cleans them up; the whole database is thrown
// away at the end of the run (src/test/globalSetup.ts).

let personId: string;
let siteId: number;

beforeAll(async () => {
  const [p] = await db
    .insert(peopleTable)
    .values({
      email: `mapping-${crypto.randomBytes(4).toString("hex")}@example.com`,
      name: "Maria",
      addedBy: "cli:test",
    })
    .returning({ id: peopleTable.id });
  personId = p!.id;
  const [s] = await db
    .insert(feedingSitesTable)
    .values({ name: "VitestMapping — Eleni's", lat: 37.4452, lng: 24.9423 })
    .returning({ id: feedingSitesTable.id });
  siteId = s!.id;
});

afterAll(async () => {
  await pool.end();
});

const renamed = (over: Partial<MappingEventInput> = {}): MappingEventInput =>
  ({
    subjectKind: "site",
    subjectId: siteId,
    kind: "renamed",
    personId,
    before: { name: "VitestMapping — Eleni's" },
    after: { name: "VitestMapping — Maria's" },
    ...over,
  }) as MappingEventInput;

const eventsFor = (id: number) =>
  db.select().from(mappingEventsTable).where(eq(mappingEventsTable.subjectId, id));

describe("recordMappingEvent", () => {
  it("writes one row inside the caller's transaction, signed by a person", async () => {
    const id = await db.transaction((tx) => recordMappingEvent(tx, renamed()));
    const [row] = await db.select().from(mappingEventsTable).where(eq(mappingEventsTable.id, id));
    expect(row).toMatchObject({
      subjectKind: "site",
      subjectId: siteId,
      kind: "renamed",
      personId,
      actorSystem: null,
      before: { name: "VitestMapping — Eleni's" },
      after: { name: "VitestMapping — Maria's" },
      note: null,
      redactedAt: null,
    });
  });

  it("writes a row signed by the app's own actor", async () => {
    const id = await db.transaction((tx) =>
      recordMappingEvent(tx, {
        subjectKind: "site",
        subjectId: siteId,
        kind: "seeded",
        actorSystem: "system:seed",
        after: { name: "x" },
      }),
    );
    const [row] = await db.select().from(mappingEventsTable).where(eq(mappingEventsTable.id, id));
    expect(row).toMatchObject({ personId: null, actorSystem: "system:seed" });
  });

  it("refuses the pool: it needs a transaction", async () => {
    await expect(
      // Cast past the type, which already refuses `db`.
      recordMappingEvent(db as never, renamed()),
    ).rejects.toThrow(MappingEventRefused);
    await expect(recordMappingEvent(db as never, renamed())).rejects.toThrow(/transaction/);
  });

  it("refuses both a person and a system actor, or neither", async () => {
    await expect(
      db.transaction((tx) =>
        recordMappingEvent(tx, renamed({ actorSystem: "system:seed" } as never)),
      ),
    ).rejects.toThrow(/exactly one of a person and a system actor/);
    await expect(
      db.transaction((tx) =>
        recordMappingEvent(tx, renamed({ personId: undefined } as never)),
      ),
    ).rejects.toThrow(/exactly one of a person and a system actor/);
  });

  it("refuses an unknown system actor, kind or subject, and a person id that isn't one", async () => {
    const bad: Partial<MappingEventInput>[] = [
      { personId: undefined, actorSystem: "system:vision" } as never,
      { kind: "deleted" } as never,
      { subjectKind: "cat" } as never,
      { subjectId: 0 },
      { personId: "someone" },
    ];
    for (const over of bad) {
      await expect(
        db.transaction((tx) => recordMappingEvent(tx, renamed(over))),
      ).rejects.toThrow(MappingEventRefused);
    }
  });

  it("a failed history write leaves the change undone (one transaction)", async () => {
    const [s] = await db
      .insert(feedingSitesTable)
      .values({ name: "VitestMapping — before", lat: 37.44, lng: 24.94 })
      .returning({ id: feedingSitesTable.id });
    await expect(
      db.transaction(async (tx) => {
        await tx
          .update(feedingSitesTable)
          .set({ name: "VitestMapping — after" })
          .where(eq(feedingSitesTable.id, s!.id));
        // A well-formed id that isn't a person: the database's strict link
        // refuses it, so the history write fails.
        await recordMappingEvent(
          tx,
          renamed({ subjectId: s!.id, personId: "00000000-0000-4000-8000-000000000000" }),
        );
      }),
    ).rejects.toThrow();
    const [after] = await db
      .select({ name: feedingSitesTable.name })
      .from(feedingSitesTable)
      .where(eq(feedingSitesTable.id, s!.id));
    expect(after!.name).toBe("VitestMapping — before");
    expect(await eventsFor(s!.id)).toHaveLength(0);
  });
});

describe("app-written authors", () => {
  it("reserves system:seed and system:migration", () => {
    expect(SYSTEM_AUTHORS).toContain("system:seed");
    expect(SYSTEM_AUTHORS).toContain("system:migration");
  });
});
