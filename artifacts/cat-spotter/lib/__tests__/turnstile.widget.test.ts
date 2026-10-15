// @vitest-environment jsdom
/**
 * SYC-170 PR 1.2 (review finding 6): the real widget path, against a fake
 * `window.turnstile`. The token callback resolves; `before-interactive` shows
 * the sheet and `after-interactive` hides it; a draft that meets a tap goes
 * tokenless; the widget and the sheet are always removed afterwards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTurnstileToken } from '../turnstile.web';

type Params = Record<string, unknown> & {
  action: string;
  cData: string;
  sitekey: string;
  callback: (t: string) => void;
  'before-interactive-callback': () => void;
  'after-interactive-callback': () => void;
};

let renders: Params[];
let removed: string[];
let onRender: ((p: Params, id: string) => void) | null;

beforeEach(() => {
  renders = [];
  removed = [];
  onRender = null;
  (globalThis as { turnstile?: unknown }).turnstile = {
    render: (_c: unknown, p: Params) => {
      renders.push(p);
      const id = `w${renders.length}`;
      queueMicrotask(() => onRender?.(p, id));
      return id;
    },
    remove: (id: string) => {
      removed.push(id);
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { turnstile?: unknown }).turnstile;
  document.body.innerHTML = '';
});

const sheet = () => document.querySelector<HTMLElement>('[data-turnstile-sheet]');

describe('the widget path', () => {
  it('passes action and cData through unchanged, resolves the token, then removes the widget and the sheet', async () => {
    onRender = (p) => p.callback('tok-1');
    await expect(getTurnstileToken('welfare_report', 'r-abc123')).resolves.toBe('tok-1');
    expect(renders).toHaveLength(1);
    expect(renders[0]!.action).toBe('welfare_report');
    expect(renders[0]!.cData).toBe('r-abc123');
    expect(renders[0]!.sitekey).toBe('1x00000000000000000000AA'); // localhost: the always-passes test key
    expect(removed).toEqual(['w1']);
    expect(sheet()).toBeNull();
  });

  it('is invisible until Cloudflare asks for a tap, shows then, and hides again after', async () => {
    let seenHidden: boolean | undefined;
    let shownHidden: boolean | undefined;
    let afterHidden: boolean | undefined;
    onRender = (p) => {
      seenHidden = sheet()!.hidden; // as soon as the widget exists: still hidden
      p['before-interactive-callback']();
      shownHidden = sheet()!.hidden;
      p['after-interactive-callback']();
      afterHidden = sheet()!.hidden;
      p.callback('tok-tap');
    };
    await expect(getTurnstileToken('welfare_report', 'r-abc')).resolves.toBe('tok-tap');
    expect(seenHidden).toBe(true);
    expect(shownHidden).toBe(false);
    expect(afterHidden).toBe(true);
    expect(sheet()).toBeNull();
    expect(removed).toEqual(['w1']);
  });

  it('a draft that meets a tap resolves null, never shows the sheet, and cleans up', async () => {
    let shown: boolean | undefined;
    onRender = (p) => {
      p['before-interactive-callback']();
      shown = sheet() ? !sheet()!.hidden : false;
    };
    await expect(getTurnstileToken('welfare_draft', 'r-abc')).resolves.toBeNull();
    expect(shown).toBe(false);
    expect(removed).toEqual(['w1']);
    expect(sheet()).toBeNull();
  });

  it('two sends render two widgets and never reuse a token', async () => {
    let n = 0;
    onRender = (p) => p.callback(`tok-${++n}`);
    const a = await getTurnstileToken('welfare_report', 'r-abc');
    const b = await getTurnstileToken('welfare_report', 'r-abc');
    expect([a, b]).toEqual(['tok-1', 'tok-2']);
    expect(renders).toHaveLength(2);
    expect(removed).toEqual(['w1', 'w2']);
    expect(sheet()).toBeNull();
  });
});
