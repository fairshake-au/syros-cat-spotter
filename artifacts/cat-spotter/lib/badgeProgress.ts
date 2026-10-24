/**
 * Badge progress for the Profile Badges tab (SYC-628, docs/specs/profile-tab-redesign.md
 * §3.3). The goals mirror artifacts/api-server/src/lib/badges.ts; a test pins them
 * together. Whether a badge is earned always comes from the server's list.
 */
import { BADGE_IDS } from './i18n';

export type BadgeStat = 'points' | 'totalSightings' | 'uniqueCatsDiscovered' | 'catsSpotted';

export const BADGE_GOALS: Record<(typeof BADGE_IDS)[number], { stat: BadgeStat; goal: number }> = {
  first_sighting: { stat: 'totalSightings', goal: 1 },
  first_discovery: { stat: 'uniqueCatsDiscovered', goal: 1 },
  five_cats: { stat: 'catsSpotted', goal: 5 },
  ten_cats: { stat: 'catsSpotted', goal: 10 },
  ten_discoveries: { stat: 'uniqueCatsDiscovered', goal: 10 },
  explorer: { stat: 'totalSightings', goal: 25 },
  island_legend: { stat: 'points', goal: 500 },
};

export interface BadgeView {
  id: string;
  earned: boolean;
  stat: BadgeStat;
  goal: number;
  value: number | null;
}

// Null when there is no profile or the server sent no badge list: "unknown",
// never "none earned". Unknown badge ids from the server are ignored.
export function badgeViews(
  profile: (Partial<Record<BadgeStat, number>> & { badges?: unknown }) | undefined,
): BadgeView[] | null {
  if (!profile || !Array.isArray(profile.badges)) return null;
  const earnedIds = profile.badges;
  return BADGE_IDS.map((id) => {
    const { stat, goal } = BADGE_GOALS[id];
    const raw = profile[stat];
    return {
      id,
      earned: earnedIds.includes(id),
      stat,
      goal,
      value: typeof raw === 'number' ? Math.min(raw, goal) : null,
    };
  });
}

// First unearned badge, in BADGE_IDS order; null when all are earned.
export function nextBadge(views: BadgeView[]): BadgeView | null {
  return views.find((v) => !v.earned) ?? null;
}

export function earnedCount(views: BadgeView[]): number {
  return views.filter((v) => v.earned).length;
}
