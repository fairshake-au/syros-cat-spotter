import { db, photosTable, pointsLedgerTable, sightingsTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { placeLabel } from "./areas/placeLabel";
import { canonicalCatOf, liveCats } from "./catIdentity";
import { haversineKm } from "./catHelpers";
import type { CapabilityHolder } from "./capabilities";
import { MOVE_WORDS, photosOfSightings } from "./moveSightings";
import { hiddenDetails } from "./photoVisibility";
import {
  EAR_TIP_NOT_CLIPPED,
  searchTeamCats,
  syrNumber,
  teamCatView,
  teamPhotoUrl,
  type TeamCatView,
} from "./teamCatView";

// What the move screen shows (which-cat-is-which.md §5.2; SYC-150 PR 3.3):
// the photos being moved and the cat they are under now, the cats to choose
// from, "What moves", the main-photo picker and the warnings that are true.
// Read-only. The screen sends what it expects to find (§6); the move itself,
// and every refusal, is lib/moveSightings.ts.

export interface MoveScreenAsk {
  /** The cat the sightings are filed under now. */
  cat: number;
  sightingIds: number[];
  /** A cat chosen already (Move back, or a result chosen from the list). */
  toCatId?: number;
  /** "It's a new cat". */
  fresh: boolean;
  /** The search box's words. */
  q: string;
}

export interface MoveScreenCat {
  id: number;
  name: string;
  syr: string;
  thumbnailUrl: string | null;
}

export interface MoveScreen {
  from: MoveScreenCat & { mainPhotoUrl: string | null; recentPhotoUrls: string[]; keeps: number };
  moving: { id: number; at: string; place: string; photoUrls: string[] }[];
  /** The cat chosen, or null while the team member is still choosing (or has chosen "It's a new cat"). */
  chosen: (MoveScreenCat & { namePending: boolean }) | null;
  /** Why a `to` in the address was not taken, in words; "" for none. */
  chooseNote: string;
  /** The cats to choose from, while none is chosen. */
  results: { heading: string; cats: (MoveScreenCat & { away: string | null })[] } | null;
  /** "What moves": the items, what the old cat keeps, the points. */
  whatMoves: { items: string[]; keeps: string; points: string | null };
  /** The old cat's main photo is moving: choose its next one (or none). */
  mainPhoto: { choices: { id: number; url: string }[] } | null;
  warnings: string[];
}

export type MoveScreenLoad =
  | { kind: "ok"; screen: MoveScreen }
  /** Nothing can be moved from this address: the words, and where each sighting is now if it moved. */
  | { kind: "stop"; status: number; message: string; now: { catId: number; name: string }[] };

const NEARBY_SHOWN = 8;

const dayWords = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Europe/Athens" });

const km = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

const syrNameFor = (v: TeamCatView) => (v.cat.namePending ? v.cat.syr : v.cat.name);

/**
 * Loads the screen. A sighting that isn't matched, isn't under `ask.cat`
 * (someone moved it first) or doesn't exist stops here with the words the
 * route would have refused with, so the page and the route say the same.
 */
export async function loadMoveScreen(person: CapabilityHolder, ask: MoveScreenAsk, now = new Date()): Promise<MoveScreenLoad> {
  const ids = [...new Set(ask.sightingIds)].sort((a, b) => a - b);
  if (ids.length === 0) {
    return { kind: "stop", status: 400, message: "Tick at least one sighting to move.", now: [] };
  }
  const rows = await db
    .select({ id: sightingsTable.id, catId: sightingsTable.catId, status: sightingsTable.status })
    .from(sightingsTable)
    .where(inArray(sightingsTable.id, ids));
  if (rows.length !== ids.length) return { kind: "stop", status: 404, message: MOVE_WORDS.notFound, now: [] };
  if (rows.some((r) => r.status !== "resolved" || r.catId === null)) {
    return { kind: "stop", status: 409, message: MOVE_WORDS.notResolved, now: [] };
  }
  if (rows.some((r) => r.catId !== ask.cat)) {
    // Someone moved it first: say where each is now (§6).
    const where = [...new Set(rows.map((r) => r.catId!))];
    const names = await Promise.all(where.map(async (id) => ({ catId: id, name: (await teamCatView(id))?.cat.name ?? "another cat" })));
    return { kind: "stop", status: 409, message: MOVE_WORDS.changed, now: names };
  }
  const from = await teamCatView(ask.cat, now, person);
  if (!from) return { kind: "stop", status: 404, message: MOVE_WORDS.notFound, now: [] };

  const movingSet = new Set(ids);
  const moving = from.sightings
    .filter((s) => movingSet.has(s.id))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id - b.id);
  const movingUrls = new Set(moving.flatMap((s) => [s.photoUrl, ...s.extraPhotos.map((e) => e.photoUrl)]).filter((u): u is string => u !== null));

  // The cat chosen: canonical (Mimi, once part of Agatha, means Agatha, §6), never the cat it is under.
  let to: TeamCatView | null = null;
  let chooseNote = "";
  if (ask.toCatId !== undefined && !ask.fresh) {
    const canonical = (await canonicalCatOf([ask.toCatId])).get(ask.toCatId) ?? null;
    if (canonical === null) chooseNote = MOVE_WORDS.notFound;
    else if (canonical === from.cat.id) chooseNote = MOVE_WORDS.sameCat;
    else to = await teamCatView(canonical, now, person);
    if (to === null && chooseNote === "") chooseNote = MOVE_WORDS.notFound;
  }

  const first = moving[0];
  // Is the old cat's main photo moving? Then the team member chooses its next one (§5.2).
  const mainMoves = from.cat.mainPhotoUrl !== null && movingUrls.has(from.cat.mainPhotoUrl);
  const [results, mainPhoto, points] = await Promise.all([
    to !== null || ask.fresh ? Promise.resolve(null) : resultsFor(ask.q, from, first),
    mainMoves ? mainPhotoChoices(from, ids) : Promise.resolve(null),
    pointsOf(ids),
  ]);

  // The spotter's standing answers, in the order the app asks them: ear tip, food and water, note.
  const ASKED = ["ear_tip", "food_and_water", "note"];
  const answers = from.history
    .filter((h) => h.sightingId !== null && movingSet.has(h.sightingId) && h.author.kind === "spotter" && h.replacedBy.length === 0)
    .sort((a, b) => ASKED.indexOf(a.kind) - ASKED.indexOf(b.kind) || a.id - b.id);
  const photoCount = moving.reduce((n, s) => n + 1 + s.extraPhotos.length, 0);
  const items = [
    moving.length === 1 && photoCount === 1
      ? "this photo"
      : moving.length === 1
        ? `this spot's ${photoCount} photos`
        : `the ${photoCount} photos of these ${moving.length} sightings`,
    ...answers.map((a) => (a.kind === "note" ? "the spotter's note" : `"${answerWords(a)}"`)),
  ];
  const keeps = from.sightings.length - moving.length;

  const screen: MoveScreen = {
    from: {
      id: from.cat.id,
      name: syrNameFor(from),
      syr: from.cat.syr,
      thumbnailUrl: from.cat.mainPhotoUrl,
      mainPhotoUrl: from.cat.mainPhotoUrl,
      recentPhotoUrls: from.photos.filter((p) => p.source === "sighting" && !movingUrls.has(p.url)).slice(0, 2).map((p) => p.url),
      keeps,
    },
    moving: moving.map((s) => ({
      id: s.id,
      at: s.at,
      place: placeLabel(s),
      photoUrls: [s.photoUrl, ...s.extraPhotos.map((e) => e.photoUrl)].filter((u): u is string => u !== null),
    })),
    chosen: to
      ? { id: to.cat.id, name: syrNameFor(to), syr: to.cat.syr, thumbnailUrl: to.cat.mainPhotoUrl, namePending: to.cat.namePending }
      : null,
    chooseNote,
    results,
    whatMoves: {
      items,
      keeps: `${syrNameFor(from)} keeps ${keeps === 0 ? "no sightings" : keeps === 1 ? "1 sighting" : `${keeps} sightings`}.`,
      points: points.total > 0 ? `The ${points.spotters > 1 ? "spotters keep" : "spotter keeps"} their ${points.total} points.` : null,
    },
    mainPhoto,
    warnings: to ? warningsFor({ from, to, moving, answers, hidden: from.photos.some((p) => p.hidden !== null && movingUrls.has(p.url)) }) : [],
  };
  return { kind: "ok", screen };
}

/** The spec's words for an answer: "ear tip clipped (left)", "food and water were out" (§5.2). */
function answerWords(a: { kind: string; said: string }): string {
  const clip = /^Ear tip clipped(?:, (left|right) ear)?$/.exec(a.said);
  if (a.kind === "ear_tip" && clip) return clip[1] ? `ear tip clipped (${clip[1]})` : "ear tip clipped";
  return lowerFirst(a.said);
}

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** The photos that stay with the old cat and could be its main photo: newest first, not hidden, not deleted for good. */
async function mainPhotoChoices(
  from: TeamCatView,
  sightingIds: readonly number[],
): Promise<{ choices: { id: number; url: string }[] }> {
  const moved = [...(await photosOfSightings(db, sightingIds))];
  const r = await db.execute<{ id: number; public_id: string }>(sql`
    select distinct p.id, p.public_id, p.created_at
      from sightings s
      join photos p
        on p.removed_at is null
       and (p.id = s.photo_id or p.id in (select sp.photo_id from sighting_photos sp where sp.sighting_id = s.id))
     where s.cat_id = ${from.cat.id}
       and s.status = 'resolved'
       and s.id <> all(${idArray(sightingIds)})
       and p.id <> all(${idArray(moved)})
     order by p.created_at desc, p.id desc
     limit 24`);
  const hidden = await hiddenDetails(r.rows.map((p) => p.id));
  return {
    choices: r.rows
      .filter((p) => !hidden.has(p.id))
      .slice(0, 12)
      .map((p) => ({ id: p.id, url: `${teamPhotoUrl(p.public_id)}/small` })),
  };
}

const idArray = (ids: readonly number[]) => sql`array[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::int[]`;

async function pointsOf(sightingIds: readonly number[]): Promise<{ total: number; spotters: number }> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${pointsLedgerTable.points}), 0)::int`,
      spotters: sql<number>`count(distinct ${pointsLedgerTable.deviceId})::int`,
    })
    .from(pointsLedgerTable)
    .where(inArray(pointsLedgerTable.sightingId, [...sightingIds]));
  return { total: Number(row?.total ?? 0), spotters: Number(row?.spotters ?? 0) };
}

/** The cats to choose from: the cats that match the words, or the ones nearest the photo (§5.2). */
async function resultsFor(
  q: string,
  from: TeamCatView,
  first: TeamCatView["sightings"][number] | undefined,
): Promise<NonNullable<MoveScreen["results"]>> {
  const words = q.trim();
  if (words !== "") {
    const found = (await searchTeamCats(words)).filter((c) => c.id !== from.cat.id);
    return {
      heading: found.length === 0 ? `No cat found for “${words}”` : `Cats matching “${words}”`,
      // Found by a merged-in cat's name: "Mimi (now part of Agatha)" (§4.3).
      cats: found.map((c) => ({
        id: c.id,
        name: c.alsoKnownAs ? `${c.alsoKnownAs} (now part of ${c.name})` : c.name,
        syr: c.syr,
        thumbnailUrl: c.thumbnailUrl,
        away: null,
      })),
    };
  }
  if (!first) return { heading: "Cats near this photo", cats: [] };
  const all = await liveCats({
    id: sql<number>`cats.id`,
    name: sql<string>`cats.name`,
    namePending: sql<boolean>`cats.name_pending`,
    lat: sql<number>`cats.lat`,
    lng: sql<number>`cats.lng`,
    photoPublicId: photosTable.publicId,
  }).leftJoin(photosTable, eq(photosTable.id, sql`cats.primary_photo_id`));
  const near = all
    .filter((c) => c.id !== from.cat.id)
    .map((c) => ({ c, d: haversineKm(first.lat, first.lng, c.lat, c.lng) }))
    .sort((a, b) => a.d - b.d || a.c.id - b.c.id)
    .slice(0, NEARBY_SHOWN);
  return {
    heading: "Cats near this photo",
    cats: near.map(({ c, d }) => ({
      id: c.id,
      name: c.name,
      syr: syrNumber(c.id),
      thumbnailUrl: c.photoPublicId ? `${teamPhotoUrl(c.photoPublicId)}/small` : null,
      away: d < 1 ? `${Math.max(10, Math.round((d * 1000) / 10) * 10)} m away` : `${km(d)} km away`,
    })),
  };
}

/** The warnings, only the ones that are true (§5.2's table). */
function warningsFor(o: {
  from: TeamCatView;
  to: TeamCatView;
  moving: TeamCatView["sightings"];
  answers: TeamCatView["history"];
  hidden: boolean;
}): string[] {
  const out: string[] = [];
  const name = syrNameFor(o.to);

  // Recorded as having died, and a moved photo is newer than that record.
  const life = o.to.records.lifeStatus;
  if (life.value === "deceased" && life.confidence !== "unknown") {
    const newest = [...o.moving].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    if (newest && Date.parse(newest.at) > Date.parse(life.asOf)) {
      out.push(
        `${name} is recorded as having died. Moving this photo says she was seen alive on ${dayWords(newest.at)}, which will change her record back to alive.`,
      );
    }
  }

  // A clipped ear that will make the chosen cat Likely sterilised, unless the team said it isn't clipped.
  // Keyed on what the standing answer says (its value), not on how it is worded.
  const clipped = o.answers.some((a) => a.correction?.kind === "ear_tip_clipped");
  const s = o.to.records.sterilised;
  const teamSaidNot = o.to.history.some(
    (h) => h.kind === "ear_tip" && h.author.kind === "team" && h.said === EAR_TIP_NOT_CLIPPED && h.replacedBy.length === 0,
  );
  if (clipped && s.value !== true && s.confidence !== "likely" && !teamSaidNot) {
    out.push(`${name} will go on the Likely list for a check.`);
  }

  // Far from where the chosen cat is usually seen.
  const spots: { lat: number; lng: number }[] =
    o.to.sightings.length > 0 ? o.to.sightings : [{ lat: o.to.cat.lat, lng: o.to.cat.lng }];
  const centre = {
    lat: spots.reduce((n, p) => n + p.lat, 0) / spots.length,
    lng: spots.reduce((n, p) => n + p.lng, 0) / spots.length,
  };
  const far = Math.max(...o.moving.map((m) => haversineKm(m.lat, m.lng, centre.lat, centre.lng)));
  if (far > 1) {
    out.push(`${o.moving.length === 1 ? "This photo was" : "One of these photos was"} taken ${km(far)} km from where ${name} is usually seen.`);
  }

  if (o.hidden) {
    out.push("This photo is hidden and stays hidden after the move. If the only reason was the wrong cat, show it again from the photo's own menu.");
  }
  return out;
}
