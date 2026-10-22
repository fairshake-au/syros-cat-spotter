import type pg from "pg";
import { isTeamMemberNow, photoState, type PhotoState } from "./eligibility";
import { fingerprint, isPhotoRef } from "./rules";
import { scanBytes, searchFor, type SearchResult } from "./search";
import { standInFor } from "./standIn";

// SYC-462 spec §4.4: removing a photo for good. **The one implementation**:
// today's command calls it, and SYC-246's November button will call it too.
//
// One transaction, holding the same photo-row lock that hiding takes:
// check the rules again, delete the picture and record who/when/why (one
// statement; photos_removed_ck makes the two inseparable), delete its small
// and medium versions, repoint every cat using it to what the public already
// sees, and scan every column for the picture's bytes before committing, so
// the fingerprint can't be lost. Then the read-only checks, after commit.

export type RemoveStep = "delete_and_record" | "versions" | "main_photo";
export type RemoveRefusal = "not_found" | "not_hidden" | "not_for_privacy" | "not_team" | "bad_ref" | "switched_off";

export interface RemovalPlan {
  photoId: number;
  publicId: string;
  /** Size of the picture in bytes. */
  bytes: number;
  versions: string[];
  repoints: { catId: number; to: number }[];
  spotPhotos: { sightingId: number; role: string }[];
  observations: number;
  reports: number;
}

export type RemoveResult =
  | { kind: "refused"; why: RemoveRefusal }
  | { kind: "already"; removedAt: Date; search: SearchResult }
  | { kind: "plan"; plan: RemovalPlan; search: SearchResult }
  | { kind: "removed"; plan: RemovalPlan; search: SearchResult }
  /** The in-transaction byte scan timed out: the whole removal was rolled back; nothing changed (PR review F3). */
  | { kind: "timed_out" };

export interface RemoveInput {
  publicId: string;
  /** The approving team member's people id. */
  by: string;
  /** The request reference: SYC-<n> or "hello YYYY-MM-DD #<n>". */
  ref: string;
  /** False: a dry run (nothing changes). */
  apply: boolean;
  /** True on production: refuse unless app_settings photo_removal_on is true (spec §4.6). */
  requireSwitch: boolean;
  recheckDelayMs?: number;
  timeoutMs?: number;
}

/** Tests only: skip one step (T2), or act between the commit and the checks (T2b). */
export interface RemoveTestOnly {
  skip?: RemoveStep;
  afterCommit?: () => Promise<void>;
  /** Makes the in-transaction scan take this long (T: the F3 timeout). */
  slowScanMs?: number;
}

async function planFor(q: pg.ClientBase, st: PhotoState): Promise<RemovalPlan> {
  const one = async <T>(sql: string) => (await q.query(sql, [st.id])).rows as T[];
  const [size] = await one<{ bytes: number | null }>(
    `select (length(data) * 3 / 4)::int as bytes from photos where id = $1`,
  );
  const versions = await one<{ size: string }>(`select size from photo_variants where photo_id = $1 order by size`);
  const cats = await one<{ id: number }>(`select id from cats where primary_photo_id = $1 order by id`);
  const repoints = [];
  for (const c of cats) repoints.push({ catId: c.id, to: await standInFor(q, c.id, st.id) });
  const spotPhotos = await one<{ sighting_id: number; role: string }>(
    `select sighting_id, role from sighting_photos where photo_id = $1
     union
     select s.id, 'cover' from sightings s
      where s.photo_id = $1 and not exists (select 1 from sighting_photos sp where sp.sighting_id = s.id and sp.photo_id = $1)
     order by 1, 2`,
  );
  const [obs] = await one<{ n: number }>(`select count(*)::int as n from observations where photo_id = $1`);
  const [reports] = await one<{ n: number }>(`select count(*)::int as n from welfare_reports where photo_id = $1`);
  return {
    photoId: st.id,
    publicId: st.publicId,
    bytes: size?.bytes ?? 0,
    versions: versions.map((v) => v.size),
    repoints,
    spotPhotos: spotPhotos.map((s) => ({ sightingId: s.sighting_id, role: s.role })),
    observations: obs!.n,
    reports: reports!.n,
  };
}

export async function removePhoto(
  client: pg.Client,
  input: RemoveInput,
  testOnly: RemoveTestOnly = {},
): Promise<RemoveResult> {
  if (!isPhotoRef(input.ref)) return { kind: "refused", why: "bad_ref" };
  if (input.requireSwitch) {
    const s = await client.query<{ value: unknown }>(`select value from app_settings where key = 'photo_removal_on'`);
    if (s.rows[0]?.value !== true) return { kind: "refused", why: "switched_off" };
  }
  const searchOpts = { recheckDelayMs: input.recheckDelayMs, timeoutMs: input.timeoutMs };

  await client.query(input.apply ? "begin" : "begin isolation level repeatable read read only");
  let committed = false;
  try {
    // PR review F6: lock first, in its own statement, then read the state,
    // so a hide or restore that committed while this waited is seen.
    if (input.apply) {
      await client.query(`select id from photos where public_id = $1 for update`, [input.publicId]);
    }
    const st = await photoState(client, input.publicId);
    const refuse = async (why: RemoveRefusal): Promise<RemoveResult> => {
      await client.query("rollback");
      committed = true;
      return { kind: "refused", why };
    };
    if (!st) return await refuse("not_found");
    if (st.removedAt) {
      await client.query("rollback");
      committed = true;
      const search = await searchFor(client, st, { apply: false, bytes: null, ...searchOpts });
      return { kind: "already", removedAt: st.removedAt, search };
    }
    if (!st.hiddenNow) return await refuse("not_hidden");
    if (!st.hiddenForPrivacy) return await refuse("not_for_privacy");
    if (!(await isTeamMemberNow(client, input.by))) return await refuse("not_team");

    const plan = await planFor(client, st);
    const data = (await client.query<{ data: string }>(`select data from photos where id = $1`, [st.id])).rows[0]!.data;
    const fp = fingerprint(data);

    if (!input.apply) {
      const search = await searchFor(client, st, { apply: false, bytes: null, inTransaction: true, ...searchOpts });
      await client.query("rollback");
      committed = true;
      return { kind: "plan", plan, search };
    }

    if (testOnly.skip !== "delete_and_record") {
      await client.query(
        `update photos
            set data = null, removed_at = clock_timestamp(), removed_by = $2, removed_reason = $3
          where id = $1 and removed_at is null`,
        [st.id, input.by, input.ref],
      );
    }
    if (testOnly.skip !== "versions") {
      await client.query(`delete from photo_variants where photo_id = $1`, [st.id]);
    }
    if (testOnly.skip !== "main_photo") {
      for (const r of plan.repoints) {
        await client.query(`update cats set primary_photo_id = $2 where id = $1 and primary_photo_id = $3`, [
          r.catId,
          r.to,
          st.id,
        ]);
      }
    }
    // Check 5 inside the transaction (spec §4.4 step 5): it sees this
    // transaction's own writes, and the fingerprint can't be lost.
    const bytes = await scanBytes(client, st, fp, {
      inTransaction: true,
      timeoutMs: input.timeoutMs,
      slowMs: testOnly.slowScanMs,
    });
    if (bytes.line.ok === "not_verified") {
      // Never commit a removal that couldn't be checked (PR review F3).
      await client.query("rollback");
      committed = true;
      return { kind: "timed_out" };
    }
    await client.query("commit");
    committed = true;
    await testOnly.afterCommit?.();
    const search = await searchFor(client, st, { apply: true, bytes, ...searchOpts });
    return { kind: "removed", plan, search };
  } catch (err) {
    if (!committed) await client.query("rollback").catch(() => {});
    throw err;
  }
}
