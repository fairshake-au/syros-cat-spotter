import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { badgeViews, earnedCount, nextBadge, nextInGroup } from '../badgeProgress';
import { BADGE_EMOJI, BADGE_GROUPS, BADGE_IDS } from '../i18n';

type Row = { id: string; group: string; earned: boolean; value: number | null; goal: number | null };
const row = (id: string, group: string, earned = false, value: number | null = 0, goal: number | null = 1): Row => ({
  id,
  group,
  earned,
  value,
  goal,
});

describe('BADGE_IDS', () => {
  it('is pinned to the ids and order in the server catalogue', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../api-server/src/lib/badges/catalogue.ts'),
      'utf8',
    );
    const serverIds = [...src.matchAll(/id: "([a-z_0-9]+)"/g)].map((m) => m[1]);
    expect(serverIds).toHaveLength(22);
    expect([...BADGE_IDS].sort()).toEqual([...serverIds].sort());
    // Same display order within each group as the server.
    const serverGroups = [...src.matchAll(/id: "([a-z_0-9]+)", group: "([a-z_]+)"/g)];
    for (const group of new Set(serverGroups.map((m) => m[2]))) {
      const serverOrder = serverGroups.filter((m) => m[2] === group).map((m) => m[1]);
      expect(BADGE_GROUPS[group as keyof typeof BADGE_GROUPS]).toEqual(serverOrder);
    }
  });

  it('has an emoji for every badge', () => {
    for (const id of BADGE_IDS) expect(BADGE_EMOJI[id], id).toBeTruthy();
  });
});

describe('badgeViews', () => {
  it('is null without a profile or server badge progress (old server)', () => {
    expect(badgeViews(undefined)).toBeNull();
    expect(badgeViews({})).toBeNull();
    expect(badgeViews({ badgeProgress: 'x' })).toBeNull();
  });

  it('uses server progress and never shows 9 of 10 on an earned badge', () => {
    const views = badgeViews({
      badgeProgress: [
        row('ten_discoveries', 'finding', true, 10, 10),
        row('discover_25', 'finding', false, 9, 25),
        row('pathfinder', 'covering', false, null, null),
      ],
      newBadgeIds: ['ten_discoveries'],
    })!;
    expect(views.map((v) => v.id)).toEqual(['ten_discoveries', 'discover_25', 'pathfinder']);
    expect(views[0]).toMatchObject({ earned: true, isNew: true, value: 10, goal: 10 });
    expect(views[1]).toMatchObject({ earned: false, isNew: false, value: 9, goal: 25 });
    expect(views[2]).toMatchObject({ value: null, goal: null });
  });

  it('forces value to the goal when earned, even if the server sent less', () => {
    const [v] = badgeViews({ badgeProgress: [row('ten_discoveries', 'finding', true, 9, 10)] })!;
    expect(v.value).toBe(10);
  });

  it('ignores unknown badge ids from a newer server', () => {
    const views = badgeViews({ badgeProgress: [row('mystery', 'finding'), row('areas_3', 'covering')] })!;
    expect(views.map((v) => v.id)).toEqual(['areas_3']);
  });
});

describe('nextInGroup', () => {
  const views = badgeViews({
    badgeProgress: [
      row('areas_3', 'covering', true, 3, 3),
      row('areas_8', 'covering', false, 3, 8),
      row('areas_all', 'covering', false, 3, 20),
      row('weeks_2', 'coming_back', false, 0, 2),
    ],
  })!;
  it('after areas_3 is areas_8; after areas_all it is null', () => {
    expect(nextInGroup(views, 'areas_3')?.id).toBe('areas_8');
    expect(nextInGroup(views, 'areas_all')).toBeNull();
  });
  it('stays inside the group', () => {
    expect(nextInGroup(views, 'weeks_2')).toBeNull();
    expect(nextInGroup(views, 'nope')).toBeNull();
  });
});

describe('nextBadge and earnedCount', () => {
  it('picks the first unearned badge in order', () => {
    const views = badgeViews({
      badgeProgress: [row('first_discovery', 'first_steps'), row('five_cats', 'first_steps')],
    })!;
    expect(nextBadge(views)?.id).toBe('first_discovery');
    expect(earnedCount(views)).toBe(0);
  });

  it('is null when every badge is earned', () => {
    const views = badgeViews({
      badgeProgress: [row('first_sighting', 'first_steps', true, 1, 1)],
    })!;
    expect(nextBadge(views)).toBeNull();
    expect(earnedCount(views)).toBe(1);
  });
});
