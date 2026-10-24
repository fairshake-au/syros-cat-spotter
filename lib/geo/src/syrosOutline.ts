/**
 * A plain outline of Syros as [lat, lng] points, rough on purpose: enough to
 * show where the cats are on the island, never exact. One list for every
 * picture of the island: the Cats map draws it under its pictures while they
 * load (`data-outline` on #island-map, read by assets/dashboard-map.js, which
 * keeps its own copy only as the fallback for when pictures fail). A test
 * holds the two copies together.
 */
export const SYROS_OUTLINE: readonly (readonly [number, number])[] = [
  [37.515, 24.925], [37.5, 24.945], [37.48, 24.965], [37.462, 24.96], [37.448, 24.95],
  [37.437, 24.948], [37.42, 24.965], [37.405, 24.962], [37.393, 24.95], [37.38, 24.925],
  [37.373, 24.905], [37.378, 24.885], [37.392, 24.872], [37.41, 24.875], [37.425, 24.878],
  [37.44, 24.888], [37.455, 24.893], [37.47, 24.898], [37.49, 24.905], [37.508, 24.91],
];
