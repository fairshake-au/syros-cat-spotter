import { useColors } from '@/hooks/useColors';
import { palette } from '@/constants/colors';

/**
 * SYC-624 (from SYC-509): the grey for quiet text on the cat page. Today's
 * muted grey is about 4.07:1 on the page background in light mode; this one
 * reaches 4.5:1. Dark mode's muted grey already does. Page-only: the app-wide
 * token change stays in SYC-509.
 */
export function useQuietColor(): string {
  const colors = useColors();
  return colors.mutedForeground === palette.stone600 ? palette.stone700 : colors.mutedForeground;
}
