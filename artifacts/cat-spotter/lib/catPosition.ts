/**
 * SYC-772 (spec §3.2): where the walking cat stands on the fact progress bar.
 * The cat faces right and its front paws (right edge) sit at the end of the
 * fill, so its left offset is the fill width minus the cat's width, kept on
 * the bar. Returns 0 when there is no total or the bar is no wider than the cat.
 */
export function catPosition(n: number, total: number, barWidth: number, catWidth: number): number {
  if (total <= 0 || barWidth <= catWidth) return 0;
  const left = (barWidth * n) / total - catWidth;
  return Math.max(0, Math.min(barWidth - catWidth, left));
}
