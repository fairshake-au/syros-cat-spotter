/**
 * SYC-133: the loading screen the server writes into the website's HTML, so
 * a visitor on a weak connection sees the app's name and "Loading…" at once
 * instead of a blank white page while the JavaScript downloads.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { TRANSLATIONS, type Language } from '@/lib/i18n';
import { hideWebLoadingScreen, WEB_LOADING_SCREEN_ID } from '@/lib/webLoadingScreen';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { injectLoadingScreen, LOADING_TEXT, LOADING_SCREEN_ID } = require('./loading-screen.js') as {
  injectLoadingScreen: (html: string, options?: { slowAfterMs?: number }) => string;
  LOADING_TEXT: Record<Language, { title: string; loading: string; slow: string; failed: string; retry: string }>;
  LOADING_SCREEN_ID: string;
};

// The shape `expo export --platform web` writes today (Expo SDK 54).
const EXPO_SHELL = `<!DOCTYPE html>
<html lang="en">
  <head>
    <title>Syros Cat Spotters</title>
    <style id="expo-reset">#root { display: flex; height: 100%; flex: 1; }</style>
  <link rel="stylesheet" href="/_expo/static/css/a.css"></head>
  <body>
    <noscript>You need to enable JavaScript to run this app.</noscript>
    <div id="root"></div>
  <script src="/_expo/static/js/web/entry-abc.js" defer></script>
</body>
</html>`;

function dom(html: string, language?: string) {
  const window = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://cats.example/',
    beforeParse(win) {
      if (language) win.localStorage.setItem('cat-spotter/language', language);
    },
  }).window;
  return window;
}

const text = (w: Window) => w.document.getElementById(LOADING_SCREEN_ID)?.textContent ?? '';

describe('injectLoadingScreen', () => {
  it('puts a loading screen in front of the empty app root, with the name and "Loading…"', () => {
    const html = injectLoadingScreen(EXPO_SHELL);
    const w = dom(html);
    const screen = w.document.getElementById(LOADING_SCREEN_ID);
    expect(screen).not.toBeNull();
    // Outside #root, so React clearing the root can't remove it early.
    expect(w.document.getElementById('root')!.contains(screen)).toBe(false);
    expect(text(w)).toContain('Syros Cat Spotters');
    expect(text(w)).toContain('Loading…');
    // The app's script tag and root are untouched.
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('<script src="/_expo/static/js/web/entry-abc.js" defer></script>');
    // Styles go in the head, so the screen is styled on its first paint.
    expect(html.indexOf('cs-loading-style')).toBeLessThan(html.indexOf('</head>'));
  });

  it('shows the visitor’s saved language (Greek, French), English otherwise', () => {
    expect(text(dom(injectLoadingScreen(EXPO_SHELL), 'el'))).toContain(LOADING_TEXT.el.loading);
    expect(text(dom(injectLoadingScreen(EXPO_SHELL), 'fr'))).toContain(LOADING_TEXT.fr.loading);
    expect(text(dom(injectLoadingScreen(EXPO_SHELL), 'de'))).toContain(LOADING_TEXT.en.loading);
    const w = dom(injectLoadingScreen(EXPO_SHELL), 'el');
    expect(w.document.documentElement.lang).toBe('el');
  });

  it('adds a reassuring note when loading is slow', async () => {
    const w = dom(injectLoadingScreen(EXPO_SHELL, { slowAfterMs: 10 }), 'fr');
    const note = w.document.getElementById(`${LOADING_SCREEN_ID}-slow`)!;
    expect(note.hidden).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe(LOADING_TEXT.fr.slow);
  });

  it('says so, with a retry button, if the app’s script fails to download', () => {
    const w = dom(injectLoadingScreen(EXPO_SHELL));
    const script = w.document.querySelector('script[src]')!;
    const note = w.document.getElementById(`${LOADING_SCREEN_ID}-slow`)!;
    expect(note.hidden).toBe(true);
    // An unrelated error (e.g. an image) changes nothing.
    w.document.body.appendChild(w.document.createElement('img')).dispatchEvent(new w.Event('error'));
    expect(note.hidden).toBe(true);
    script.dispatchEvent(new w.Event('error'));
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe(LOADING_TEXT.en.failed);
    expect(w.document.getElementById(`${LOADING_SCREEN_ID}-row`)!.hidden).toBe(true);
    const button = w.document.querySelector(`#${LOADING_SCREEN_ID} button`) as HTMLButtonElement;
    expect(button.textContent).toBe(LOADING_TEXT.en.retry);
    expect(button.hidden).toBe(false);
  });

  it('leaves HTML without an empty app root unchanged', () => {
    expect(injectLoadingScreen('<html>home</html>')).toBe('<html>home</html>');
    expect(injectLoadingScreen('<html><body><div id="root"><p>x</p></div></body></html>')).toBe(
      '<html><body><div id="root"><p>x</p></div></body></html>',
    );
  });

  it('the app removes it once it is ready to draw', () => {
    const w = dom(injectLoadingScreen(EXPO_SHELL));
    expect(WEB_LOADING_SCREEN_ID).toBe(LOADING_SCREEN_ID);
    hideWebLoadingScreen(w.document);
    expect(w.document.getElementById(LOADING_SCREEN_ID)).toBeNull();
    // Safe to call twice, and with no document (native).
    hideWebLoadingScreen(w.document);
    hideWebLoadingScreen(undefined);
  });
});

describe('LOADING_TEXT matches the app’s translations (lib/i18n.ts is the source)', () => {
  it.each(['en', 'el', 'fr'] as Language[])('%s', (lang) => {
    const t = TRANSLATIONS[lang];
    expect(LOADING_TEXT[lang]).toEqual({
      title: t.welcomeTitle,
      loading: t.webLoading,
      slow: t.webLoadingSlow,
      failed: t.webLoadingFailed,
      retry: t.tryAgain,
    });
  });
});
