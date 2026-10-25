/**
 * Badge progress for the Profile Badges tab and the badge celebration. Progress
 * comes from the server (profile.badgeProgress, built from the catalogue in
 * artifacts/api-server/src/lib/badges/catalogue.ts); a test pins BADGE_IDS to
 * that catalogue. The client only adds names, copy and emoji.
 */
import { BADGE_IDS } from './i18n';

export interface BadgeView {
  id: string;
  group: string;
  earned: boolean;
  /** Earned since the spotter last looked at the Badges tab. */
  isNew: boolean;
  /** Null for badges earned at a moment (Pathfinder, Trailblazer). */
  value: number | null;
  goal: number | null;
}

interface ProfileBadgeRow {
  id: string;
  group: string;
  earned: boolean;
  value: number | null;
  goal: number | null;
}

const KNOWN: ReadonlySet<string> = new Set(BADGE_IDS);

// Null when there is no profile or the server sent no badgeProgress (an old
// server): "unknown", never "none earned". Unknown ids from a newer server are
// ignored. The server's order (the catalogue's) is kept.
export function badgeViews(
  profile: { badgeProgress?: unknown; newBadgeIds?: unknown } | undefined,
): BadgeView[] | null {
  if (!profile || !Array.isArray(profile.badgeProgress)) return null;
  const fresh = new Set<string>(Array.isArray(profile.newBadgeIds) ? (profile.newBadgeIds as string[]) : []);
  return (profile.badgeProgress as ProfileBadgeRow[])
    .filter((row) => KNOWN.has(row.id))
    .map((row) => ({
      id: row.id,
      group: row.group,
      earned: row.earned,
      isNew: row.earned && fresh.has(row.id),
      // An earned badge is complete, never "9 of 10".
      value: row.earned && row.goal !== null ? row.goal : row.value,
      goal: row.goal,
    }));
}

// The first unearned badge after `id` in the same group; failing that, the
// first unearned badge anywhere in the group; null when the group is done.
export function nextInGroup(views: BadgeView[], id: string): BadgeView | null {
  const at = views.findIndex((v) => v.id === id);
  if (at < 0) return null;
  const group = views[at].group;
  const unearned = (v: BadgeView) => v.group === group && !v.earned && v.id !== id;
  return views.slice(at + 1).find(unearned) ?? views.find(unearned) ?? null;
}

// First unearned badge, in catalogue order; null when all are earned.
export function nextBadge(views: BadgeView[]): BadgeView | null {
  return views.find((v) => !v.earned) ?? null;
}

export function earnedCount(views: BadgeView[]): number {
  return views.filter((v) => v.earned).length;
}
