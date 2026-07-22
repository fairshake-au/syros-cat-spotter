import { useColorScheme } from 'react-native';
import colors from '@/constants/colors';

/**
 * Returns the design tokens for the current color scheme.
 *
 * The returned object contains all color tokens for the active palette
 * plus scheme-independent values like `radius`.
 *
 * Falls back to the light palette when no dark key is defined in
 * constants/colors.ts (the scaffold ships light-only by default).
 * When a sibling web artifact's dark tokens are synced into a `dark`
 * key, this hook will automatically switch palettes based on the
 * device's appearance setting.
 */
type Palette = { [K in keyof typeof colors.light]: string };

export function useColors() {
  const scheme = useColorScheme();
  const palettes: { light: Palette; dark?: Palette } = colors;
  const palette = (scheme === 'dark' && palettes.dark) || palettes.light;
  return { ...palette, radius: colors.radius };
}
