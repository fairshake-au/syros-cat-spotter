export interface ProfileStats {
  points: number;
  totalSightings: number;
  uniqueCatsDiscovered: number;
  catsSpotted: number;
}

export type BadgeGroup =
  | "first_steps"
  | "coming_back"
  | "weekly"
  | "finding"
  | "covering";

export interface BadgeStats extends ProfileStats {
  weeksSpotted: number;
  areasSpotted: number;
  areasTotal: number;
  remoteCats: number;
  podiums: number;
  champions: number;
}

export interface BadgeDef {
  id: string;
  group: BadgeGroup;
  /** "event" badges are earned at the moment of a spot, never from totals. */
  stat: keyof BadgeStats | "event";
  /** For areas_all this is a placeholder; the real goal is stats.areasTotal. */
  goal: number;
}

// Display order within each group. Badge ids are translated on the client.
export const BADGE_CATALOGUE: readonly BadgeDef[] = [
  { id: "first_sighting", group: "first_steps", stat: "totalSightings", goal: 1 },
  { id: "first_discovery", group: "first_steps", stat: "uniqueCatsDiscovered", goal: 1 },
  { id: "five_cats", group: "first_steps", stat: "catsSpotted", goal: 5 },
  { id: "ten_cats", group: "first_steps", stat: "catsSpotted", goal: 10 },
  { id: "explorer", group: "first_steps", stat: "totalSightings", goal: 25 },
  { id: "island_legend", group: "first_steps", stat: "points", goal: 500 },

  { id: "weeks_2", group: "coming_back", stat: "weeksSpotted", goal: 2 },
  { id: "weeks_4", group: "coming_back", stat: "weeksSpotted", goal: 4 },
  { id: "weeks_8", group: "coming_back", stat: "weeksSpotted", goal: 8 },

  { id: "podium", group: "weekly", stat: "podiums", goal: 1 },
  { id: "champion", group: "weekly", stat: "champions", goal: 1 },

  { id: "ten_discoveries", group: "finding", stat: "uniqueCatsDiscovered", goal: 10 },
  { id: "discover_25", group: "finding", stat: "uniqueCatsDiscovered", goal: 25 },
  { id: "discover_50", group: "finding", stat: "uniqueCatsDiscovered", goal: 50 },
  { id: "discover_100", group: "finding", stat: "uniqueCatsDiscovered", goal: 100 },

  { id: "areas_3", group: "covering", stat: "areasSpotted", goal: 3 },
  { id: "areas_8", group: "covering", stat: "areasSpotted", goal: 8 },
  { id: "areas_all", group: "covering", stat: "areasSpotted", goal: 0 },
  { id: "pathfinder", group: "covering", stat: "event", goal: 0 },
  { id: "trailblazer", group: "covering", stat: "event", goal: 0 },
  { id: "remote_1", group: "covering", stat: "remoteCats", goal: 1 },
  { id: "remote_5", group: "covering", stat: "remoteCats", goal: 5 },
];

function goalFor(def: BadgeDef, stats: BadgeStats): number {
  return def.id === "areas_all" ? stats.areasTotal : def.goal;
}

function metBy(def: BadgeDef, stats: BadgeStats): boolean {
  if (def.stat === "event") return false;
  // With no current areas there is nothing to cover.
  if (def.id === "areas_all" && stats.areasTotal <= 0) return false;
  return stats[def.stat] >= goalFor(def, stats);
}

/** Badges the totals alone earn. Event badges are never in this list. */
export function thresholdBadges(stats: BadgeStats): string[] {
  return BADGE_CATALOGUE.filter((d) => metBy(d, stats)).map((d) => d.id);
}

export function badgeProgress(
  stats: BadgeStats,
  earned: ReadonlySet<string>,
): { id: string; group: BadgeGroup; earned: boolean; value: number | null; goal: number | null }[] {
  return BADGE_CATALOGUE.map((d) => {
    const isEarned = earned.has(d.id);
    if (d.stat === "event") {
      return { id: d.id, group: d.group, earned: isEarned, value: null, goal: null };
    }
    const goal = goalFor(d, stats);
    // An earned badge is complete, never "9 of 10" (areas can retire, etc.).
    const value = isEarned ? goal : Math.min(stats[d.stat], goal);
    return { id: d.id, group: d.group, earned: isEarned, value, goal };
  });
}
