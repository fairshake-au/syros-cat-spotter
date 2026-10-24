/**
 * SYC-148: the font files the app loads at start-up (native: TTF).
 *
 * The phone apps bundle these inside the app, so size doesn't matter there.
 * The website loads smaller subset WOFF2 copies instead: see fontSources.web.ts.
 */
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono';

export const fontSources = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  SpaceMono_400Regular,
  SpaceMono_700Bold,
};
