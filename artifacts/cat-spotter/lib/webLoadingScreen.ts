/**
 * SYC-133: the website's loading screen.
 *
 * server/serve-web.js writes a small "Loading…" screen into the page's HTML
 * (server/loading-screen.js) so a visitor on a weak connection sees something
 * straight away instead of a blank white page while the app downloads. It
 * sits outside the app's root element, so it stays up until the app says it
 * is ready to draw: the same moment the native splash screen hides.
 */

/** Must match LOADING_SCREEN_ID in server/loading-screen.js (tested). */
export const WEB_LOADING_SCREEN_ID = 'cs-loading';

type DocumentLike = Pick<Document, 'getElementById'>;

/** Removes the loading screen. Safe on native (no document) and when already gone. */
export function hideWebLoadingScreen(
  doc: DocumentLike | undefined = typeof document === 'undefined' ? undefined : document,
): void {
  doc?.getElementById(WEB_LOADING_SCREEN_ID)?.remove();
}
