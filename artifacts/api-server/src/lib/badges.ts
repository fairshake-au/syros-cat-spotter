export interface ProfileStats {
  points: number;
  totalSightings: number;
  uniqueCatsDiscovered: number;
  catsSpotted: number;
}

interface BadgeDef {
  id: string;
  earned: (s: ProfileStats) => boolean;
}

// Badge ids are translated on the client.
export const BADGE_DEFS: BadgeDef[] = [
  { id: "first_sighting", earned: (s) => s.totalSightings >= 1 },
  { id: "first_discovery", earned: (s) => s.uniqueCatsDiscovered >= 1 },
  { id: "five_cats", earned: (s) => s.catsSpotted >= 5 },
  { id: "ten_cats", earned: (s) => s.catsSpotted >= 10 },
  { id: "ten_discoveries", earned: (s) => s.uniqueCatsDiscovered >= 10 },
  { id: "explorer", earned: (s) => s.totalSightings >= 25 },
  { id: "island_legend", earned: (s) => s.points >= 500 },
];

export function badgesFor(stats: ProfileStats): string[] {
  return BADGE_DEFS.filter((b) => b.earned(stats)).map((b) => b.id);
}
