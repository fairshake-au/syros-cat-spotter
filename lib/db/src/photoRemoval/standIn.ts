import type pg from "pg";

/**
 * SYC-462 spec §4.2: the photo the public already sees in place of a hidden
 * main photo, for the repoint. The newest cover photo of the cat's resolved
 * sightings that is neither hidden nor removed (newest by created_at, then
 * id), or 0, "no photo". Mirrors displayPhotoRows in the api-server
 * (lib/photoVisibility.ts); the parity test there (T14) keeps the two the same.
 */
export async function standInFor(q: pg.ClientBase, catId: number, excludePhotoId: number): Promise<number> {
  const r = await q.query<{ id: number }>(
    `select p.id
       from sightings s
       join photos p on p.id = s.photo_id
      where s.cat_id = $1 and s.status = 'resolved' and p.id <> $2 and p.removed_at is null
        and coalesce((select e.action from photo_visibility_events e
                       where e.photo_id = p.id order by e.id desc limit 1), 'restore') <> 'hide'
      order by s.created_at desc, s.id desc
      limit 1`,
    [catId, excludePhotoId],
  );
  return r.rows[0]?.id ?? 0;
}
