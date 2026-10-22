import { Platform } from 'react-native';

/**
 * SYC-6: on a desktop browser the app is a centred, phone-like column rather
 * than stretching across the window. Anything that renders outside that
 * column (sheets in a Modal portal) caps itself to the same width on web.
 */
export const APP_COLUMN_MAX_WIDTH = 480;

/** Whether the window is wider than the column, so its edges show. */
export function isWide(windowWidth: number): boolean {
  return windowWidth > APP_COLUMN_MAX_WIDTH;
}

/** Sheets: the column's width on web; native keeps its wider tablet cap. */
export const SHEET_MAX_WIDTH = Platform.OS === 'web' ? APP_COLUMN_MAX_WIDTH : 560;

/** The width the app actually has: the window, capped at the column on web. */
export function appWidth(windowWidth: number): number {
  return Platform.OS === 'web' ? Math.min(windowWidth, APP_COLUMN_MAX_WIDTH) : windowWidth;
}
