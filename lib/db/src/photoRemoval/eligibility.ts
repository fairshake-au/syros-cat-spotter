import type pg from "pg";
import { PERSON_ID_RE } from "./rules";

// SYC-462 (spec §5.4): what state a photo is in, and whether the approver is
// on the team now. Raw SQL on a pg client, as the other db-ops CLIs are.

export interface PhotoState {
  id: number;
  publicId: string;
  /** Its newest visibility event is a hide. */
  hiddenNow: boolean;
  /**
   * Hidden for privacy (DECISIONS.md Decision 3): a hide whose reason is
   * exactly 'privacy' with no restore after it, or a photo_private report
   * naming it.
   */
  hiddenForPrivacy: boolean;
  removedAt: Date | null;
}

/** The photo's state, or null if there's no such photo. `lock` takes the hide/restore lock (for update). */
export async function photoState(q: pg.ClientBase, publicId: string, lock = false): Promise<PhotoState | null> {
  const r = await q.query<{
    id: number;
    public_id: string;
    removed_at: Date | null;
    hidden_now: boolean;
    hidden_for_privacy: boolean;
  }>(
    `select p.id, p.public_id, p.removed_at,
            coalesce((select e.action from photo_visibility_events e
                       where e.photo_id = p.id order by e.id desc limit 1), 'restore') = 'hide' as hidden_now,
            (exists (select 1 from photo_visibility_events h
                      where h.photo_id = p.id and h.action = 'hide' and h.reason = 'privacy'
                        and h.id > coalesce((select max(r.id) from photo_visibility_events r
                                              where r.photo_id = p.id and r.action = 'restore'), 0))
             or exists (select 1 from welfare_reports w
                         where w.photo_id = p.id and w.reason = 'photo_private')) as hidden_for_privacy
       from photos p
      where p.public_id = $1
      ${lock ? "for update of p" : ""}`,
    [publicId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    publicId: row.public_id,
    hiddenNow: row.hidden_now,
    hiddenForPrivacy: row.hidden_for_privacy,
    removedAt: row.removed_at,
  };
}

/**
 * On the team now: joined (accepted_at set), not left, and holding staff or
 * management in force. The same conditions as people.ts's managerRecipient
 * (isNull(leftAt), isNotNull(acceptedAt), scopeInForce()), written in SQL
 * because this CLI uses a plain pg client. Those two roles hold hide_photo,
 * restore_photo and remove_photo (api-server lib/capabilities.ts).
 */
export async function isTeamMemberNow(q: pg.ClientBase, personId: string): Promise<boolean> {
  if (!PERSON_ID_RE.test(personId)) return false;
  const r = await q.query(
    `select 1 from people p
       join person_scopes s on s.person_id = p.id
      where p.id = $1 and p.accepted_at is not null and p.left_at is null
        and s.role in ('staff', 'management')
        and (s.expires_at is null or s.expires_at > now())
      limit 1`,
    [personId],
  );
  return r.rowCount === 1;
}
