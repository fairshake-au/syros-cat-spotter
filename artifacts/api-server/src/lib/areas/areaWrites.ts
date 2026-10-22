import { db, namedAreasTable } from "@workspace/db";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { recordMappingEvent } from "../mappingEvents";
import { loadAreas } from "./namedAreas";

// Changing the named areas (SYC-396 PR 2.4; dashboard §3.3). The team adds an
// area, renames one, moves its centre, or retires it. **This is the only
// writer of named_areas.** Each change runs in one transaction: lock the row,
// check the change, update the row, then write its history row through
// recordMappingEvent, holding the whole row before and after, so
// `namedAreasAt` (areaHistory.ts) can replay the list from `after` alone.
// Then this server's cache reloads at once; every other server's within
// AREAS_TTL_MS.
//
// The route calls this only behind `edit_named_areas` (island-only), which
// guardianView.source.test.ts holds it to.

export type AreaChange =
  | { kind: "add"; key: string; name: string; lat: number; lng: number }
  | { kind: "rename"; key: string; name: string }
  | { kind: "move"; key: string; lat: number; lng: number }
  | { kind: "retire"; key: string };

/** Which form field a refusal is about, so the page can name it there. */
export type AreaField = "key" | "name" | "lat" | "lng" | "area";

export class AreaChangeRefused extends Error {
  constructor(
    readonly field: AreaField,
    message: string,
    /** The centre is outside Syros's box (a page may word that its own way). */
    readonly offSyros = false,
  ) {
    super(message);
    this.name = "AreaChangeRefused";
  }
}

/** The box a centre must be inside: Syros and its shore. */
export const SYROS_BOX = { latMin: 37.36, latMax: 37.52, lngMin: 24.86, lngMax: 24.99 } as const;
export const AREA_NAME_MIN = 2;
export const AREA_NAME_MAX = 40;
const KEY_RE = /^[a-z][a-z0-9-]{1,30}$/;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
interface Row {
  id: number;
  key: string;
  name: string;
  lat: number;
  lng: number;
  retiredAt: Date | null;
}

/** The whole row, as the history holds it. */
const whole = (r: Pick<Row, "key" | "name" | "lat" | "lng" | "retiredAt">) => ({
  key: r.key,
  name: r.name,
  lat: r.lat,
  lng: r.lng,
  retired: r.retiredAt !== null,
});

function checkName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < AREA_NAME_MIN || name.length > AREA_NAME_MAX) {
    throw new AreaChangeRefused("name", `Give the area a name of ${AREA_NAME_MIN} to ${AREA_NAME_MAX} letters.`);
  }
  return name;
}

function checkCentre(lat: number, lng: number): void {
  if (!Number.isFinite(lat) || lat < SYROS_BOX.latMin || lat > SYROS_BOX.latMax) {
    throw new AreaChangeRefused("lat", "That centre isn't on Syros. Check the latitude.", true);
  }
  if (!Number.isFinite(lng) || lng < SYROS_BOX.lngMin || lng > SYROS_BOX.lngMax) {
    throw new AreaChangeRefused("lng", "That centre isn't on Syros. Check the longitude.", true);
  }
}

function checkKey(key: string): void {
  if (!KEY_RE.test(key) || key === "off") {
    throw new AreaChangeRefused(
      "key",
      "A short key is 2 to 31 small letters, numbers or dashes, starting with a letter (and not \"off\").",
    );
  }
}

/** Refuses a name another area in use already has (any case). */
async function nameFree(tx: Tx, name: string, exceptId: number | null): Promise<void> {
  const [clash] = await tx
    .select({ name: namedAreasTable.name })
    .from(namedAreasTable)
    .where(
      and(
        isNull(namedAreasTable.retiredAt),
        sql`lower(${namedAreasTable.name}) = lower(${name})`,
        exceptId === null ? undefined : ne(namedAreasTable.id, exceptId),
      ),
    );
  if (clash) throw new AreaChangeRefused("name", `There is already an area called ${clash.name}.`);
}

async function lockArea(tx: Tx, key: string): Promise<Row> {
  const [row] = await tx
    .select({
      id: namedAreasTable.id,
      key: namedAreasTable.key,
      name: namedAreasTable.name,
      lat: namedAreasTable.lat,
      lng: namedAreasTable.lng,
      retiredAt: namedAreasTable.retiredAt,
    })
    .from(namedAreasTable)
    .where(eq(namedAreasTable.key, key))
    .for("update");
  if (!row) throw new AreaChangeRefused("area", "There is no such area.");
  if (row.retiredAt !== null) throw new AreaChangeRefused("area", `${row.name} has been retired.`);
  return row;
}

const isUniqueViolation = (err: unknown, constraint: string): boolean => {
  const e = (err as { cause?: unknown })?.cause ?? err;
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "23505" &&
    (e as { constraint?: string }).constraint === constraint
  );
};

/**
 * Makes one change to the list, with its history row, in one transaction.
 * Throws {@link AreaChangeRefused} naming the field at fault.
 */
export async function changeArea(person: { id: string }, change: AreaChange): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      if (change.kind === "add") {
        checkKey(change.key);
        const name = checkName(change.name);
        checkCentre(change.lat, change.lng);
        await nameFree(tx, name, null);
        const [taken] = await tx
          .select({ id: namedAreasTable.id })
          .from(namedAreasTable)
          .where(eq(namedAreasTable.key, change.key));
        if (taken) throw new AreaChangeRefused("key", "That short key is already used. Choose another.");
        const [row] = await tx
          .insert(namedAreasTable)
          .values({ key: change.key, name, lat: change.lat, lng: change.lng })
          .returning();
        await recordMappingEvent(tx, {
          personId: person.id,
          subjectKind: "named_area",
          subjectId: row!.id,
          kind: "area_added",
          before: null,
          after: whole(row!),
        });
        return;
      }

      const row = await lockArea(tx, change.key);
      let next: Row;
      let kind: "area_renamed" | "area_moved" | "area_retired";
      if (change.kind === "rename") {
        const name = checkName(change.name);
        if (name === row.name) throw new AreaChangeRefused("name", `${row.name} already has that name.`);
        await nameFree(tx, name, row.id);
        next = { ...row, name };
        kind = "area_renamed";
      } else if (change.kind === "move") {
        checkCentre(change.lat, change.lng);
        if (change.lat === row.lat && change.lng === row.lng) {
          throw new AreaChangeRefused("lat", `${row.name}'s centre is already there.`);
        }
        next = { ...row, lat: change.lat, lng: change.lng };
        kind = "area_moved";
      } else {
        next = row;
        kind = "area_retired";
      }
      const [saved] = await tx
        .update(namedAreasTable)
        .set({
          name: next.name,
          lat: next.lat,
          lng: next.lng,
          retiredAt: kind === "area_retired" ? sql`now()` : row.retiredAt,
        })
        .where(eq(namedAreasTable.id, row.id))
        .returning();
      await recordMappingEvent(tx, {
        personId: person.id,
        subjectKind: "named_area",
        subjectId: row.id,
        kind,
        before: whole(row),
        after: whole(saved!),
      });
    });
  } catch (err) {
    // Two people naming two areas the same at once: the index refuses one.
    if (isUniqueViolation(err, "named_areas_live_name_unique")) {
      throw new AreaChangeRefused("name", "Another area has just been given that name.");
    }
    if (isUniqueViolation(err, "named_areas_key_unique")) {
      throw new AreaChangeRefused("key", "That short key is already used. Choose another.");
    }
    throw err;
  }
  await loadAreas();
}
