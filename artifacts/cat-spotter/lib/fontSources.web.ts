/**
 * SYC-148: the font files the website loads at start-up.
 *
 * Subset WOFF2 copies of the same Inter and Space Mono files the phone apps
 * use (about 165 KB in all, against 1.9 MB of full TTFs). Each holds Basic
 * Latin, Latin-1 and Latin Extended-A (English and French), Greek (with its accents), and common
 * punctuation, currency and arrows. A character outside that falls back to the
 * stand-in faces below. assets/fonts/README.md says how to regenerate them.
 */
export const fontSources = {
  Inter_400Regular: require('../assets/fonts/Inter_400Regular.woff2'),
  Inter_500Medium: require('../assets/fonts/Inter_500Medium.woff2'),
  Inter_600SemiBold: require('../assets/fonts/Inter_600SemiBold.woff2'),
  Inter_700Bold: require('../assets/fonts/Inter_700Bold.woff2'),
  Inter_800ExtraBold: require('../assets/fonts/Inter_800ExtraBold.woff2'),
  SpaceMono_400Regular: require('../assets/fonts/SpaceMono_400Regular.woff2'),
  SpaceMono_700Bold: require('../assets/fonts/SpaceMono_700Bold.woff2'),
};

/**
 * If a font file fails or is too slow (expo-font gives up after about 6 s and
 * the app draws anyway), or for a character the subset lacks, draw with the
 * visitor's own sans-serif at the matching weight instead of the browser's
 * default serif (Times). The app names its fonts one family per weight
 * ("Inter_700Bold"), so each family gets a stand-in face made from fonts
 * already on the device. It comes first in the page; expo-font's own face for
 * the real file is added after it and takes over whenever it has loaded.
 */
const SANS_REGULAR = ["'Helvetica Neue'", 'HelveticaNeue', 'Roboto', "'Segoe UI'", 'SegoeUI', 'Arial', 'ArialMT'];
const SANS_MEDIUM = ["'Helvetica Neue Medium'", 'HelveticaNeue-Medium', 'Roboto-Medium', "'Roboto Medium'", "'Segoe UI Semibold'", ...SANS_REGULAR];
const SANS_BOLD = ["'Helvetica Neue Bold'", 'HelveticaNeue-Bold', 'Roboto-Bold', "'Roboto Bold'", "'Segoe UI Bold'", 'SegoeUI-Bold', "'Arial Bold'", 'Arial-BoldMT', ...SANS_REGULAR];
const MONO_REGULAR = ['Menlo-Regular', 'Menlo', "'Courier New'", 'CourierNewPSMT', "'Roboto Mono'", 'Consolas'];
const MONO_BOLD = ['Menlo-Bold', "'Courier New Bold'", 'CourierNewPS-BoldMT', "'Roboto Mono Bold'", 'Consolas-Bold', ...MONO_REGULAR];

const STAND_INS: Record<string, string[]> = {
  Inter_400Regular: SANS_REGULAR,
  Inter_500Medium: SANS_MEDIUM,
  Inter_600SemiBold: SANS_BOLD,
  Inter_700Bold: SANS_BOLD,
  Inter_800ExtraBold: SANS_BOLD,
  SpaceMono_400Regular: MONO_REGULAR,
  SpaceMono_700Bold: MONO_BOLD,
};

if (typeof document !== 'undefined') {
  try {
    const css = Object.entries(STAND_INS)
      .map(
        ([family, names]) =>
          `@font-face{font-family:'${family}';src:${names.map((n) => `local(${n})`).join(',')};font-display:swap}`,
      )
      .join('');
    const style = document.createElement('style');
    style.setAttribute('data-cs-font-stand-ins', '');
    style.textContent = css;
    document.head.insertBefore(style, document.head.firstChild);
  } catch {
    // Cosmetic only: without it the browser's default font shows instead.
  }
}
