import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BADGE_GOALS, badgeViews, earnedCount, nextBadge } from '../badgeProgress';
import { BADGE_IDS } from '../i18n';

describe('BADGE_GOALS', () => {
  it('matches the server thresholds in badges.ts', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../api-server/src/lib/badges.ts'),
      'utf8',
    );
    for (const id of BADGE_IDS) {
      const { stat, goal } = BADGE_GOALS[id];
      expect(src).toContain(`id: "${id}", earned: (s) => s.${stat} >= ${goal}`);
    }
  });
});

describe('badgeViews', () => {
  it('is null without a profile or a badge list', () => {
    expect(badgeViews(undefined)).toBeNull();
    expect(badgeViews({ points: 3 })).toBeNull();
    expect(badgeViews({ badges: 'first_sighting' })).toBeNull();
  });

  it('takes earned from the server list only', () => {
    const views = badgeViews({ badges: ['first_sighting'], totalSightings: 0 })!;
    expect(views).toHaveLength(BADGE_IDS.length);
    expect(views.map((v) => v.id)).toEqual([...BADGE_IDS]);
    expect(views[0].earned).toBe(true);
    expect(views[1].earned).toBe(false);
  });

  it('caps value at the goal and is null when the stat is missing', () => {
    const views = badgeViews({ badges: [], catsSpotted: 7, points: 900 })!;
    const byId = Object.fromEntries(views.map((v) => [v.id, v]));
    expect(byId.five_cats.value).toBe(5);
    expect(byId.ten_cats.value).toBe(7);
    expect(byId.island_legend.value).toBe(500);
    expect(byId.explorer.value).toBeNull();
  });

  it('ignores unknown badge ids', () => {
    const views = badgeViews({ badges: ['mystery'] })!;
    expect(views).toHaveLength(BADGE_IDS.length);
    expect(earnedCount(views)).toBe(0);
  });
});

describe('nextBadge and earnedCount', () => {
  it('picks the first unearned badge in order', () => {
    const views = badgeViews({ badges: ['first_sighting', 'five_cats'] })!;
    expect(nextBadge(views)?.id).toBe('first_discovery');
    expect(earnedCount(views)).toBe(2);
  });

  it('is null when every badge is earned', () => {
    const views = badgeViews({ badges: [...BADGE_IDS] })!;
    expect(nextBadge(views)).toBeNull();
    expect(earnedCount(views)).toBe(BADGE_IDS.length);
  });
});
