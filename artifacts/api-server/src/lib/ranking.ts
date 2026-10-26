/**
 * Standard competition ranking ("1, 1, 3"): equal points share a place and
 * the places after them are skipped. `rows` must already be sorted by points
 * descending (and then by whatever tie-break the caller wants for display).
 */
export function competitionRanks<T>(
  rows: T[],
  points: (r: T) => number,
): (T & { rank: number })[] {
  let rank = 0;
  let previous: number | null = null;
  return rows.map((row, i) => {
    const p = points(row);
    if (previous === null || p !== previous) rank = i + 1;
    previous = p;
    return { ...row, rank };
  });
}
