import type pg from "pg";

// SYC-462 spec §5.1: every photo of one cat, for finding the one a request is
// about. Prints nothing a public log mustn't hold: no location, device, name,
// note, report reason or hide reason; only ids, uses, dates and yes/no.

export interface ListedPhoto {
  publicId: string;
  /** "main photo", and "sighting <id> (<role>)" for each spot it belongs to. */
  uses: string[];
  takenAt: Date;
  hidden: boolean;
  hiddenForPrivacy: boolean;
  removedAt: Date | null;
}

export async function listCatPhotos(q: pg.ClientBase, catId: number): Promise<ListedPhoto[]> {
  const r = await q.query<{
    id: number;
    public_id: string;
    created_at: Date;
    removed_at: Date | null;
    is_main: boolean;
    hidden: boolean;
    hidden_for_privacy: boolean;
  }>(
    `with ids as (
       select primary_photo_id as id from cats where id = $1 and primary_photo_id > 0
       union select s.photo_id from sightings s where s.cat_id = $1
       union select sp.photo_id from sighting_photos sp join sightings s on s.id = sp.sighting_id where s.cat_id = $1
     )
     select p.id, p.public_id, p.created_at, p.removed_at,
            exists (select 1 from cats c where c.id = $1 and c.primary_photo_id = p.id) as is_main,
            p.removed_at is not null
              or coalesce((select e.action from photo_visibility_events e
                            where e.photo_id = p.id order by e.id desc limit 1), 'restore') = 'hide' as hidden,
            (exists (select 1 from photo_visibility_events h
                      where h.photo_id = p.id and h.action = 'hide' and h.reason = 'privacy'
                        and h.id > coalesce((select max(r.id) from photo_visibility_events r
                                              where r.photo_id = p.id and r.action = 'restore'), 0))
             or exists (select 1 from welfare_reports w where w.photo_id = p.id and w.kind = 'content' and w.reason = 'photo_private'))
              as hidden_for_privacy
       from photos p join ids on ids.id = p.id
      order by p.created_at desc, p.id desc`,
    [catId],
  );
  const spots = await q.query<{ photo_id: number; sighting_id: number; role: string }>(
    `select sp.photo_id, sp.sighting_id, sp.role from sighting_photos sp join sightings s on s.id = sp.sighting_id where s.cat_id = $1
     union
     select s.photo_id, s.id, 'cover' from sightings s
      where s.cat_id = $1 and not exists (select 1 from sighting_photos sp where sp.sighting_id = s.id)
     order by 2, 3`,
    [catId],
  );
  return r.rows.map((p) => ({
    publicId: p.public_id,
    uses: [
      ...(p.is_main ? ["main photo"] : []),
      ...spots.rows.filter((s) => s.photo_id === p.id).map((s) => `sighting ${s.sighting_id} (${s.role})`),
    ],
    takenAt: p.created_at,
    hidden: p.hidden,
    hiddenForPrivacy: p.hidden_for_privacy,
    removedAt: p.removed_at,
  }));
}
