/**
 * Rows and the "where am I" summary for the Spotters tab (SYC-628,
 * docs/specs/profile-tab-redesign.md §3.4). Server order and server ranks are
 * kept; nothing is renumbered.
 */
export interface LeaderEntry {
  spotterCode: string;
  username?: string | null;
  points: number;
  rank: number;
}

export interface LeaderRow extends LeaderEntry {
  isMe: boolean;
  name: string;
}

export type RankSummary =
  | { kind: 'top'; points: number }
  | { kind: 'behind'; rank: number; points: number; gap: number; name: string }
  | { kind: 'level'; rank: number; points: number; name: string }
  | { kind: 'outside'; points: number }
  | { kind: 'zero' };

export function leaderboardView(
  entries: LeaderEntry[] | undefined,
  me: { spotterCode?: string; points?: number } | undefined,
  fallbackName: (spotterCode: string) => string,
): { rows: LeaderRow[]; myRank: number | null; summary: RankSummary | null } {
  const myCode = me?.spotterCode;
  const rows: LeaderRow[] = (entries ?? [])
    .filter((e) => e.points > 0)
    .map((e) => ({
      ...e,
      isMe: myCode !== undefined && e.spotterCode === myCode,
      name: e.username ? e.username : fallbackName(e.spotterCode),
    }));

  const myIndex = rows.findIndex((r) => r.isMe);
  const myRow = myIndex >= 0 ? rows[myIndex] : undefined;
  const myRank = myRow ? myRow.rank : null;

  if (!me || !myCode || typeof me.points !== 'number') {
    return { rows, myRank, summary: null };
  }
  if (me.points === 0) return { rows, myRank, summary: { kind: 'zero' } };

  if (!myRow) {
    return { rows, myRank, summary: { kind: 'outside', points: me.points } };
  }
  if (myRow.rank === 1) {
    return { rows, myRank, summary: { kind: 'top', points: myRow.points } };
  }
  const above = myIndex > 0 ? rows[myIndex - 1] : undefined;
  if (!above) {
    return { rows, myRank, summary: { kind: 'top', points: myRow.points } };
  }
  const summary: RankSummary =
    above.points === myRow.points
      ? { kind: 'level', rank: myRow.rank, points: myRow.points, name: above.name }
      : {
          kind: 'behind',
          rank: myRow.rank,
          points: myRow.points,
          gap: above.points - myRow.points,
          name: above.name,
        };
  return { rows, myRank, summary };
}
