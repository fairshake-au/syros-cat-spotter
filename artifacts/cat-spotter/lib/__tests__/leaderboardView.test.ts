import { describe, expect, it } from 'vitest';
import { leaderboardView, type LeaderEntry } from '../leaderboardView';

const fb = (code: string) => `Spotter ${code}`;
const e = (spotterCode: string, points: number, rank: number, username?: string | null): LeaderEntry => ({
  spotterCode, points, rank, username,
});

describe('leaderboardView rows', () => {
  it('keeps points > 0 only, server order and server ranks', () => {
    const { rows } = leaderboardView(
      [e('A', 30, 1, 'Ann'), e('B', 0, 2), e('C', 10, 3, '')],
      { spotterCode: 'C', points: 10 },
      fb,
    );
    expect(rows.map((r) => r.spotterCode)).toEqual(['A', 'C']);
    expect(rows.map((r) => r.rank)).toEqual([1, 3]);
    expect(rows[0].name).toBe('Ann');
    expect(rows[1].name).toBe('Spotter C');
    expect(rows[1].isMe).toBe(true);
    expect(rows[0].isMe).toBe(false);
  });

  it('treats undefined entries as empty', () => {
    expect(leaderboardView(undefined, { spotterCode: 'A', points: 5 }, fb)).toEqual({
      rows: [], myRank: null, summary: { kind: 'outside', points: 5 },
    });
    expect(leaderboardView(undefined, { spotterCode: 'A', points: 0 }, fb).summary).toEqual({ kind: 'zero' });
  });

  it('marks nobody as me when spotterCode is missing', () => {
    const r = leaderboardView([e('A', 5, 1)], { points: 5 }, fb);
    expect(r.rows[0].isMe).toBe(false);
    expect(r.myRank).toBeNull();
    expect(r.summary).toBeNull();
  });
});

describe('leaderboardView summary', () => {
  it('is null when me, spotterCode or points are unknown', () => {
    expect(leaderboardView([e('A', 5, 1)], undefined, fb).summary).toBeNull();
    expect(leaderboardView([e('A', 5, 1)], { points: 5 }, fb).summary).toBeNull();
    expect(leaderboardView([e('A', 5, 1)], { spotterCode: 'A' }, fb).summary).toBeNull();
  });

  it('zero when me has no points', () => {
    expect(leaderboardView([e('A', 5, 1)], { spotterCode: 'Z', points: 0 }, fb).summary).toEqual({ kind: 'zero' });
  });

  it('top when ranked first', () => {
    const r = leaderboardView([e('A', 50, 1), e('B', 20, 2)], { spotterCode: 'A', points: 50 }, fb);
    expect(r.summary).toEqual({ kind: 'top', points: 50 });
    expect(r.myRank).toBe(1);
  });

  it('behind with the gap to the row above', () => {
    const r = leaderboardView(
      [e('A', 50, 1, 'Ann'), e('B', 20, 2, 'Bo'), e('C', 12, 3)],
      { spotterCode: 'C', points: 12 },
      fb,
    );
    expect(r.myRank).toBe(3);
    expect(r.summary).toEqual({ kind: 'behind', rank: 3, points: 12, gap: 8, name: 'Bo' });
  });

  it('level when the row above has equal points', () => {
    const r = leaderboardView(
      [e('A', 50, 1, 'Ann'), e('B', 20, 2, 'Bo'), e('C', 20, 2)],
      { spotterCode: 'C', points: 20 },
      fb,
    );
    expect(r.summary).toEqual({ kind: 'level', rank: 2, points: 20, name: 'Bo' });
  });

  it('first but level with the next spotter: level, not top', () => {
    const r = leaderboardView([e('A', 20, 1), e('B', 20, 2)], { spotterCode: 'A', points: 20 }, fb);
    expect(r.summary).toEqual({ kind: 'level', rank: 1, points: 20, name: 'Spotter B' });
  });

  it('first and clear of the next spotter: top', () => {
    const r = leaderboardView([e('A', 30, 1), e('B', 20, 2)], { spotterCode: 'A', points: 30 }, fb);
    expect(r.summary).toEqual({ kind: 'top', points: 30 });
  });

  it('outside when not in the list but has points', () => {
    const r = leaderboardView([e('A', 50, 1)], { spotterCode: 'Z', points: 4 }, fb);
    expect(r.myRank).toBeNull();
    expect(r.summary).toEqual({ kind: 'outside', points: 4 });
  });
});

describe('leaderboardView for the week (SYC-706)', () => {
  it('keeps shared competition ranks as the server sent them', () => {
    const { rows } = leaderboardView(
      [e('A', 50, 1), e('B', 50, 1), e('C', 20, 3)],
      { spotterCode: 'C', points: 20 },
      fb,
    );
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it('says outside when this week’s points are not in the list', () => {
    expect(
      leaderboardView([e('A', 50, 1)], { spotterCode: 'ME', points: 5 }, fb).summary,
    ).toEqual({ kind: 'outside', points: 5 });
  });
});
