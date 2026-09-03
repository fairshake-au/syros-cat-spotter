import { useColorScheme } from 'react-native';
import colors from '@/constants/colors';
import { useAppearance } from '@/context/AppearanceContext';

/**
 * Returns the design tokens for the current color scheme.
 *
 * The returned object contains all color tokens for the active palette
 * plus scheme-independent values like `radius`.
 *
 * Falls back to the light palette when no dark key is defined in
 * constants/colors.ts (the scaffold ships light-only by default).
 * The appearance preference defaults to the device's setting but can be
 * overridden locally from the Profile tab.
 */
type Palette = { [K in keyof typeof colors.light]: string };

export function useColors() {
  const systemScheme = useColorScheme();
  const { appearance } = useAppearance();
  const scheme = appearance === 'system' ? systemScheme : appearance;
  const palettes: { light: Palette; dark?: Palette } = colors;
  const palette = (scheme === 'dark' && palettes.dark) || palettes.light;
  return { ...palette, radius: colors.radius };
}
