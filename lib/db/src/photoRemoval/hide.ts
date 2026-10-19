import type pg from "pg";
import { isTeamMemberNow, photoState, type PhotoState } from "./eligibility";

// SYC-462 spec §5.2–§5.3: hiding a photo for privacy, and the undo. The same
// photo-row lock as the app's setPhotoVisibility, and the same add-only log.
// A dashboard hide records no reason, so hiding an already-hidden photo adds
// a second hide with reason 'privacy' (never a restore in between).

export type HideResult =
  | { kind: "hidden" | "privacy_added" | "already"; state: PhotoState }
  | { kind: "plan"; would: "hide" | "add_privacy" | "nothing"; state: PhotoState }
  | { kind: "refused"; why: "not_found" | "not_team" | "removed" };

export type RestoreResult =
  | { kind: "restored" | "already_public"; state: PhotoState }
  | { kind: "plan"; would: "restore" | "nothing"; state: PhotoState }
  | { kind: "refused"; why: "not_found" | "not_team" | "removed" };

interface Input {
  publicId: string;
  /** The approving team member's people id. */
  by: string;
  /** False: a dry run. */
  apply: boolean;
}

async function addEvent(q: pg.ClientBase, photoId: number, action: "hide" | "restore", by: string, reason: string | null) {
  await q.query(
    `insert into photo_visibility_events (photo_id, action, author, person_id, reason, at)
     values ($1, $2, $3::text, $3::uuid, $4, clock_timestamp())`,
    [photoId, action, by, reason],
  );
}

async function inTransaction<T>(q: pg.ClientBase, apply: boolean, fn: () => Promise<T>): Promise<T> {
  await q.query(apply ? "begin" : "begin isolation level repeatable read read only");
  try {
    const out = await fn();
    await q.query(apply ? "commit" : "rollback");
    return out;
  } catch (err) {
    await q.query("rollback").catch(() => {});
    throw err;
  }
}

export async function hidePhotoForPrivacy(q: pg.ClientBase, input: Input): Promise<HideResult> {
  return inTransaction(q, input.apply, async () => {
    const st = await photoState(q, input.publicId, input.apply);
    if (!st) return { kind: "refused", why: "not_found" } as const;
    if (st.removedAt) return { kind: "refused", why: "removed" } as const;
    if (!(await isTeamMemberNow(q, input.by))) return { kind: "refused", why: "not_team" } as const;
    const would = !st.hiddenNow ? "hide" : st.hiddenForPrivacy ? "nothing" : "add_privacy";
    if (!input.apply) return { kind: "plan", would, state: st } as const;
    if (would === "nothing") return { kind: "already", state: st } as const;
    await addEvent(q, st.id, "hide", input.by, "privacy");
    const after = (await photoState(q, input.publicId))!;
    return { kind: would === "hide" ? "hidden" : "privacy_added", state: after } as const;
  });
}

export async function restorePhoto(q: pg.ClientBase, input: Input): Promise<RestoreResult> {
  return inTransaction(q, input.apply, async () => {
    const st = await photoState(q, input.publicId, input.apply);
    if (!st) return { kind: "refused", why: "not_found" } as const;
    if (st.removedAt) return { kind: "refused", why: "removed" } as const;
    if (!(await isTeamMemberNow(q, input.by))) return { kind: "refused", why: "not_team" } as const;
    const would = st.hiddenNow ? "restore" : "nothing";
    if (!input.apply) return { kind: "plan", would, state: st } as const;
    if (would === "nothing") return { kind: "already_public", state: st } as const;
    await addEvent(q, st.id, "restore", input.by, null);
    return { kind: "restored", state: (await photoState(q, input.publicId))! } as const;
  });
}
