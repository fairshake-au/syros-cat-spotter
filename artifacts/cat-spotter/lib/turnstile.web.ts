/**
 * SYC-170 PR 1.2: the client twin of the server's Turnstile check, website
 * half (spec docs/specs/report-an-issue.md §9.3).
 *
 * `getTurnstileToken(action, cdata)` loads Cloudflare's script once, renders a
 * managed widget and resolves its token. If no token can be made (unmapped
 * host, script blocked, widget error, timeout) it resolves `null` and the
 * report is sent with no token: the client never stops a report, the server
 * decides. It throws `ChallengeUnavailable` only when Cloudflare asked this
 * person to tap and they didn't in time.
 * A token is single-use, so every call renders a fresh widget: nothing is
 * cached or reused, including for each resend from the saved list.
 *
 * The widget lives in a small sheet that stays invisible unless Cloudflare
 * asks for a tap (`before-interactive-callback`). The wait is cut off after
 * about 20 seconds (it restarts once if a tap is asked for, since a person
 * needs time). A draft (`welfare_draft`) is best effort and never interrupts
 * anyone: if Cloudflare wants a tap for it, it gives up quietly.
 *
 * The sheet is plain DOM, so any caller (the queue, the draft) can use it
 * without a place in the React tree. Its one line of text follows the
 * language the person chose (the same local storage key as the app).
 */
import { CHALLENGE_TIMEOUT_MS, ChallengeUnavailable, type ChallengeAction } from './challengeUnavailable';
import { TRANSLATIONS, type Language } from './i18n';
import { TEST_KEY_STORAGE_KEY, sitekeyForHost } from './turnstileConfig';

export { ChallengeUnavailable, CHALLENGE_TIMEOUT_MS, type ChallengeAction } from './challengeUnavailable';

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render(container: HTMLElement, params: Record<string, unknown>): string | undefined;
  remove(widgetId: string): void;
}

function api(): TurnstileApi | undefined {
  return (globalThis as { turnstile?: TurnstileApi }).turnstile;
}

let scriptLoad: Promise<void> | null = null;

/** Loads Cloudflare's script once. A failed load is forgotten, so a later send can try again. */
function loadScript(): Promise<void> {
  if (api()) return Promise.resolve();
  if (scriptLoad) return scriptLoad;
  scriptLoad = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = SCRIPT_URL;
    el.async = true;
    el.onload = () => (api() ? resolve() : reject(new ChallengeUnavailable('script')));
    el.onerror = () => reject(new ChallengeUnavailable('script'));
    document.head.appendChild(el);
  }).catch((err) => {
    scriptLoad = null;
    document.querySelectorAll(`script[src="${SCRIPT_URL}"]`).forEach((n) => n.remove());
    throw err;
  });
  return scriptLoad;
}

function storedValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function sheetLine(): string {
  const stored = storedValue('cat-spotter/language');
  const lang: Language = stored === 'el' || stored === 'fr' ? stored : 'en';
  return TRANSLATIONS[lang].turnstileTapLine ?? TRANSLATIONS.en.turnstileTapLine;
}

/** The sheet for one check: hidden until Cloudflare asks for a tap. */
function createSheet(): { root: HTMLElement; widget: HTMLElement; show(): void; destroy(): void } {
  const root = document.createElement('div');
  root.setAttribute('data-turnstile-sheet', '');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-live', 'polite');
  root.hidden = true;
  Object.assign(root.style, {
    position: 'fixed',
    left: '50%',
    bottom: '16px',
    transform: 'translateX(-50%)',
    width: 'min(92vw, 360px)',
    boxSizing: 'border-box',
    padding: '14px 16px',
    background: '#ffffff',
    color: '#1f1f1f',
    border: '1px solid #d6d6d6',
    borderRadius: '14px',
    boxShadow: '0 6px 24px rgba(0,0,0,0.22)',
    font: '15px/22px system-ui, sans-serif',
    textAlign: 'center',
    zIndex: '2147483000',
  } satisfies Partial<CSSStyleDeclaration>);
  const line = document.createElement('p');
  line.textContent = sheetLine();
  line.style.margin = '0 0 10px';
  const widget = document.createElement('div');
  widget.style.display = 'flex';
  widget.style.justifyContent = 'center';
  root.append(line, widget);
  document.body.appendChild(root);
  return {
    root,
    widget,
    show: () => {
      root.hidden = false;
    },
    destroy: () => root.remove(),
  };
}

export async function getTurnstileToken(action: ChallengeAction, cdata: string): Promise<string | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new ChallengeUnavailable('no-browser');
  }
  const sitekey = sitekeyForHost(window.location.host, storedValue(TEST_KEY_STORAGE_KEY));
  // A host with no sitekey mapping (the EU project's own address, a future
  // launch domain): send with no token, like the native stub. The client must
  // never be the thing that stops a report. The server decides: `observe`
  // accepts it, `enforce` answers 428 (retried, no strike).
  if (!sitekey) return null;

  const sheet = createSheet();
  let widgetId: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;

  const cleanup = () => {
    settled = true;
    if (timer) clearTimeout(timer);
    try {
      if (widgetId !== undefined) api()?.remove(widgetId);
    } catch {
      // the widget is already gone
    }
    sheet.destroy();
  };

  try {
    return await new Promise<string | null>((resolve, reject) => {
      // Cloudflare asked this person to tap and they haven't yet.
      let tapAsked = false;
      // The client must never be the thing that stops a report. Whatever goes
      // wrong (script blocked, widget error, nothing finishing in time) the
      // report is sent with no token and the server decides: `observe`
      // accepts it, `enforce` answers 428 (retried, no strike, message shown).
      // Only "asked for a tap and they didn't in time" is ChallengeUnavailable.
      const fail = (reason: string) => {
        if (settled) return;
        const unanswered = tapAsked;
        cleanup();
        if (unanswered) reject(new ChallengeUnavailable(reason));
        else resolve(null);
      };
      const arm = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fail('timeout'), CHALLENGE_TIMEOUT_MS);
      };
      arm();
      loadScript().then(
        () => {
          if (settled) return;
          try {
            widgetId = api()!.render(sheet.widget, {
              sitekey,
              action,
              cData: cdata,
              appearance: 'interaction-only',
              retry: 'never',
              'refresh-expired': 'never',
              callback: (token: string) => {
                if (settled) return;
                cleanup();
                resolve(token);
              },
              'error-callback': () => {
                fail('error');
                return true;
              },
              'expired-callback': () => fail('expired'),
              'timeout-callback': () => fail('timeout'),
              'unsupported-callback': () => fail('unsupported'),
              'before-interactive-callback': () => {
                if (action === 'welfare_draft') return fail('interactive'); // never interrupt for a draft: sent tokenless
                tapAsked = true;
                sheet.show();
                arm();
              },
              'after-interactive-callback': () => {
                tapAsked = false;
                sheet.root.hidden = true;
              },
            });
          } catch {
            fail('render');
          }
        },
        () => fail('script'),
      );
    });
  } finally {
    if (!settled) cleanup();
  }
}
