import { ApiError, type AppNotification } from '@workspace/api-client-react';

/**
 * SYC-59 PR 4.3 (which-cat-is-which.md §4.2, D4, D10): the app's side of two
 * records of the same cat becoming one. Pure pieces, tested on their own.
 */

/** Fills {from} and {to} in a line; split/join so a name holding "$&" stays as typed. */
function fill(line: string, from: string, to: string): string {
  return line.split('{from}').join(from).split('{to}').join(to);
}

/**
 * The cat page's note when the record asked for was merged into the cat shown
 * ("Mimi is now part of Agatha's record"); null for an ordinary page. `mergedFrom`
 * is absent from an older server, which just shows the cat.
 */
export function mergedIntoNote(
  t: (key: string) => string,
  mergedFrom: { id: number; name: string } | undefined,
  survivorName: string,
): string | null {
  if (!mergedFrom) return null;
  return fill(t('mergedIntoRecord'), mergedFrom.name, survivorName);
}

/**
 * The words for a `merged` or `duplicate_points` line in the spotter's
 * language, or null when it isn't one the app can word (cat news, a weekly
 * result, a kind a newer server adds, or a line written before the names were
 * stored): the caller falls back to the server's message.
 */
export function mergeLineText(n: AppNotification, t: (key: string) => string): string | null {
  if (n.kind !== 'merged' && n.kind !== 'duplicate_points') return null;
  if (!n.mergedCatName || !n.survivorCatName) return null;
  const key = n.kind === 'merged' ? 'mergedLine' : 'duplicatePointsLine';
  return fill(t(key), n.mergedCatName, n.survivorCatName);
}

export type BellTap =
  | { to: 'cat'; catId: number; updateId: number | null }
  | { to: 'survivor'; catId: number }
  | { to: 'weekly' };

/**
 * Where a tap on a bell line goes. News about a cat opens that cat. A merge
 * line opens the cat that stays (not the Spotters board, which is where a
 * line with no cat otherwise goes). Everything else with no cat is a weekly result.
 */
export function bellTap(n: AppNotification): BellTap {
  if (n.catId != null) return { to: 'cat', catId: n.catId, updateId: n.catUpdateId ?? null };
  if ((n.kind === 'merged' || n.kind === 'duplicate_points') && n.survivorCatId != null && n.survivorCatName) {
    return { to: 'survivor', catId: n.survivorCatId };
  }
  return { to: 'weekly' };
}

/**
 * 409 MERGED: the cat asked about was merged into another while the page was
 * open. Returns the cat it is part of now, or null for any other failure.
 */
export function mergedSurvivorId(err: unknown): number | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const data = err.data as { code?: unknown; catId?: unknown } | null;
  return data?.code === 'MERGED' && typeof data.catId === 'number' ? data.catId : null;
}
