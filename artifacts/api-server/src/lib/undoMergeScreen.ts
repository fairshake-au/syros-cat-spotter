import { catsTable, db } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";
import { placeLabel } from "./areas/placeLabel";
import { canonicalCatOf, catsFeeding, mergeRecord } from "./catIdentity";
import type { CapabilityHolder } from "./capabilities";
import { filedUnderSurvivorSinceMerge, MERGE_WORDS, movedByThisMerge, ownMoves } from "./mergeCats";
import { syrNumber, teamPhotoUrl } from "./teamCatView";

// What the undo screen shows (which-cat-is-which.md §4.4; SYC-59 PR 4.2):
// what undoing a merge will do, and the sightings the team may tick as
// Mimi's: those filed under Agatha since the merge, and Mimi's own that the
// team moved again after it. "Filed under Agatha since the merge" is decided
// by `filedUnderSurvivorSinceMerge` (lib/mergeCats.ts), the same helper the
// undo route checks the ticks with, so the screen and the route agree.
// Read-only.

export interface UndoSighting {
  id: number;
  at: string;
  place: string;
  photoUrls: string[];
  /** The cat it is filed under now (ticked ones only). */
  now: { id: number; name: string } | null;
  /** Why it is offered, in words (ticked ones only). */
  why: string;
}

export interface UndoScreen {
  mergeId: number;
  /** The cat that was merged away: where the undo puts sightings back. */
  mimi: { id: number; name: string; syr: string };
  /** The cat it was merged into. */
  agatha: { id: number; name: string; syr: string };
  /** The merge's own reason and when: "Merged on 26 Oct 2026: 'Same face markings'". */
  merged: { at: string; reasonText: string | null };
  /** Mimi's sightings still where the merge put them: these go back. */
  goesBack: UndoSighting[];
  /** The sightings the team may tick as Mimi's. */
  tickable: UndoSighting[];
  /** What undoing does, in plain words. */
  willDo: string[];
}

export type UndoLoad =
  | { kind: "ok"; screen: UndoScreen }
  | { kind: "stop"; status: number; message: string; link?: { href: string; label: string } };

/** The tick list is capped: a very long one is a sign the merge was long ago; the route takes any number. */
const TICKABLE_SHOWN = 200;

const nameOf = (c: { name: string; namePending: boolean; id: number }) => (c.namePending ? syrNumber(c.id) : c.name);

/** Photos of these sightings (the cover, then the others in the order taken), as team photo addresses. */
async function photosOf(sightingIds: readonly number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (sightingIds.length === 0) return out;
  const list = sql.join(sightingIds.map((i) => sql`${i}`), sql`, `);
  const r = await db.execute<{ sighting_id: number; public_id: string }>(sql`
    select s.id as sighting_id, p.public_id
      from sightings s
      join photos p on p.removed_at is null
       and (p.id = s.photo_id or p.id in (select sp.photo_id from sighting_photos sp where sp.sighting_id = s.id))
     where s.id in (${list})
     order by s.id, (p.id = s.photo_id) desc, p.id`);
  for (const row of r.rows) {
    const id = Number(row.sighting_id);
    out.set(id, [...(out.get(id) ?? []), `${teamPhotoUrl(row.public_id)}/small`]);
  }
  return out;
}

export async function loadUndoScreen(_person: CapabilityHolder, mergeId: number): Promise<UndoLoad> {
  const merge = await mergeRecord(mergeId);
  if (!merge) return { kind: "stop", status: 404, message: MERGE_WORDS.notFound };
  const cats = await db
    .select({ id: catsTable.id, name: catsTable.name, namePending: catsTable.namePending })
    .from(catsTable)
    .where(inArray(catsTable.id, [merge.catId, merge.canonicalCatId]));
  const mimiRow = cats.find((c) => c.id === merge.catId);
  const agathaRow = cats.find((c) => c.id === merge.canonicalCatId);
  if (!mimiRow || !agathaRow) return { kind: "stop", status: 404, message: MERGE_WORDS.notFound };
  const mimi = { id: mimiRow.id, name: nameOf(mimiRow), syr: syrNumber(mimiRow.id) };
  const agatha = { id: agathaRow.id, name: nameOf(agathaRow), syr: syrNumber(agathaRow.id) };

  if (merge.undoneBy !== null) {
    return { kind: "stop", status: 409, message: MERGE_WORDS.alreadyUndone, link: { href: `/api/team/cats/${mimi.id}`, label: `Open ${mimi.name}` } };
  }
  // Merges are undone newest first (§4.5): while Agatha is part of Dora, Mimi's merge waits.
  const agathaNow = (await canonicalCatOf([agatha.id])).get(agatha.id);
  if (agathaNow !== agatha.id) {
    const dora = agathaNow == null ? null : (await db.select({ id: catsTable.id, name: catsTable.name, namePending: catsTable.namePending }).from(catsTable).where(inArray(catsTable.id, [agathaNow])))[0];
    return {
      kind: "stop",
      status: 409,
      message: MERGE_WORDS.undoLaterFirst(agatha.name, dora ? nameOf(dora) : "this cat"),
      link: agathaNow == null ? undefined : { href: `/api/team/cats/${agathaNow}`, label: `Open ${dora ? nameOf(dora) : "that cat"}` },
    };
  }

  const detail = await db.execute<{ created_at: Date | string; reason_text: string | null }>(sql`
    select created_at, reason_text from cat_identity where id = ${mergeId}`);

  // Mimi's sightings still where the merge put them: they go back.
  const own = await ownMoves(db, merge);

  // The sightings the team may tick: filed under Agatha's side since the merge (the helper), and Mimi's own that were moved again.
  const feeding = await catsFeeding([merge.canonicalCatId, merge.catId]);
  const mimiSide = new Set(feeding.get(merge.catId)?.ids ?? [merge.catId]);
  const agathaSide = (feeding.get(merge.canonicalCatId)?.ids ?? [merge.canonicalCatId]).filter((id) => !mimiSide.has(id));
  const onAgatha = await db.execute<{ id: number }>(sql`
    select id from sightings
     where status = 'resolved' and cat_id in (${sql.join(agathaSide.map((i) => sql`${i}`), sql`, `)})
     order by created_at desc, id desc
     limit 2000`);
  const candidates = onAgatha.rows.map((r) => Number(r.id)).filter((id) => !own.includes(id));
  const since = await filedUnderSurvivorSinceMerge(db, merge, candidates);

  const movedAgainRows = await db.execute<{ sighting_id: number }>(sql`
    select distinct m.sighting_id from sighting_moves m
     where m.merge_id = ${mergeId} and m.reason = 'merged'`);
  const movedAll = movedAgainRows.rows.map((r) => Number(r.sighting_id)).filter((id) => !own.includes(id));
  const movedByMerge = new Set(await movedByThisMerge(db, mergeId, movedAll));

  const wanted = [...new Set([...own, ...since, ...movedByMerge])];
  const rows =
    wanted.length === 0
      ? []
      : (
          await db.execute<{ id: number; lat: number; lng: number; created_at: Date | string; cat_id: number | null; status: string }>(sql`
            select id, lat, lng, created_at, cat_id, status from sightings
             where id in (${sql.join(wanted.map((i) => sql`${i}`), sql`, `)})`)
        ).rows;
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  const canonical = await canonicalCatOf(rows.map((r) => r.cat_id).filter((c): c is number => c !== null));
  const names = new Map(
    (rows.length === 0 ? [] : await db.select({ id: catsTable.id, name: catsTable.name, namePending: catsTable.namePending }).from(catsTable).where(inArray(catsTable.id, [...new Set(rows.map((r) => r.cat_id).filter((c): c is number => c !== null))]))).map((c) => [c.id, nameOf(c)]),
  );
  const photos = await photosOf(wanted);
  const draw = (id: number, why: string, withNow: boolean): UndoSighting | null => {
    const r = byId.get(id);
    if (!r) return null;
    const cat = r.cat_id === null ? null : { id: r.cat_id, name: names.get(r.cat_id) ?? syrNumber(r.cat_id) };
    return { id, at: new Date(r.created_at).toISOString(), place: placeLabel(r), photoUrls: photos.get(id) ?? [], now: withNow ? cat : null, why };
  };

  const goesBack = own.map((id) => draw(id, "", false)).filter((s): s is UndoSighting => s !== null).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id - b.id);

  const tickable: UndoSighting[] = [];
  for (const id of wanted) {
    if (own.includes(id)) continue;
    const r = byId.get(id);
    if (!r || r.status !== "resolved" || r.cat_id === null) continue;
    const where = canonical.get(r.cat_id);
    if (where == null || where === merge.catId) continue;
    // The route's own rule: filed under Agatha's side since the merge, or moved by the merge and moved again since.
    const sinceMerge = since.has(id) && where === merge.canonicalCatId;
    if (!(sinceMerge || movedByMerge.has(id))) continue;
    const why = movedByMerge.has(id)
      ? `Moved again after the merge; filed under ${names.get(r.cat_id) ?? "another cat"} now.`
      : `Filed under ${agatha.name} since the merge.`;
    const s = draw(id, why, true);
    if (s) tickable.push(s);
  }
  tickable.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id - a.id);

  const followsAdded = await db.execute<{ n: number }>(sql`
    select count(*)::int as n
      from merge_follow_changes c
      join cat_subscriptions s on s.device_id = c.device_id and s.cat_id = ${merge.canonicalCatId} and s.created_at = c.row_created_at
     where c.merge_id = ${mergeId} and c.kind = 'follow'`);
  const followers = Number(followsAdded.rows[0]?.n ?? 0);

  const willDo = [
    goesBack.length === 0
      ? `None of ${mimi.name}'s sightings are still where the merge put them. Tick any below that are ${mimi.name}'s.`
      : `${goesBack.length === 1 ? "1 sighting goes" : `${goesBack.length} sightings go`} back to ${mimi.name}.`,
    `${mimi.name}'s own statements stop counting for ${agatha.name}.`,
    followers > 0
      ? `${followers === 1 ? "1 follower" : `${followers} followers`} the merge added to ${agatha.name} ${followers === 1 ? "is" : "are"} taken off again, unless they had followed ${agatha.name} before or changed it since.`
      : `Followers the merge added to ${agatha.name} are taken off again, unless they had followed ${agatha.name} before.`,
    `Answers a spotter added after the merge to one of ${mimi.name}'s sightings go back to ${mimi.name} with the sighting.`,
    `Sightings filed under ${agatha.name} since the merge, and ${mimi.name}'s sightings the team moved again after it, stay where they are, unless you tick them below.`,
    `The 10 points for finding this duplicate are kept. The pair goes back on Possible duplicates marked “merge undone”, so it isn't asked about blindly again.`,
  ];

  return {
    kind: "ok",
    screen: {
      mergeId,
      mimi,
      agatha,
      merged: { at: new Date(detail.rows[0]?.created_at ?? merge.createdAt).toISOString(), reasonText: detail.rows[0]?.reason_text ?? null },
      goesBack,
      tickable: tickable.slice(0, TICKABLE_SHOWN),
      willDo,
    },
  };
}
