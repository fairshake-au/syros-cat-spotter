/**
 * SYC-170 PR 1.3: the phone apps' safety check, through the same controller
 * the TurnstileHost component drives (the component only draws it).
 *
 * T1-13: a token from a fake postMessage; the timeout is ChallengeUnavailable
 * only after Cloudflare asked for a tap; a load error resolves null.
 * T1-15: navigation outside the allow-list is refused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isChallengeUnavailable } from '../challengeUnavailable';
import { createChallengeController } from '../turnstileController';

const APP = 'https://apptest.catspotters.com';
const PAGE = `${APP}/_challenge`;

function mounted(opts: Partial<Parameters<typeof createChallengeController>[0]> = {}) {
  const controller = createChallengeController({ origin: () => APP, ...opts });
  const unsubscribe = controller.subscribe(() => undefined); // the host is mounted
  return { controller, unsubscribe };
}

/** Lets the controller start the next queued check. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('T1-13: the host resolves a token, and times out only after a tap was asked for', () => {
  it('loads the challenge page for the action and cdata, then resolves the token from postMessage', async () => {
    const { controller } = mounted();
    const p = controller.run('welfare_report', 'r-abc');
    await settle();
    expect(controller.getView()).toEqual({
      url: `${PAGE}?action=welfare_report&cdata=r-abc`,
      sheet: false,
    });
    controller.handleMessage('{"type":"token","token":"TOK.123"}', `${PAGE}?action=welfare_report&cdata=r-abc`);
    await expect(p).resolves.toBe('TOK.123');
    // the WebView is gone again: it is only loaded on demand
    expect(controller.getView()).toEqual({ url: null, sheet: false });
  });

  it('shows the sheet only on interactive, and a tap then still yields the token', async () => {
    const { controller } = mounted();
    const p = controller.run('welfare_report', 'r-1');
    await settle();
    expect(controller.getView().sheet).toBe(false);
    controller.handleMessage('{"type":"interactive"}');
    expect(controller.getView().sheet).toBe(true);
    // a person needs time: well past the first 20 seconds, still waiting
    await vi.advanceTimersByTimeAsync(15_000);
    controller.handleMessage('{"type":"token","token":"TAPPED"}');
    await expect(p).resolves.toBe('TAPPED');
  });

  it('times out to ChallengeUnavailable only after an interactive', async () => {
    const { controller } = mounted();
    const p = controller.run('welfare_report', 'r-2');
    const outcome = p.then(
      (v) => ({ v }),
      (e: unknown) => ({ e }),
    );
    await settle();
    controller.handleMessage('{"type":"interactive"}');
    await vi.advanceTimersByTimeAsync(20_000);
    const res = await outcome;
    expect('e' in res && isChallengeUnavailable(res.e)).toBe(true);
    expect(controller.getView().url).toBeNull();
  });

  it('a timeout with no tap asked resolves null (tokenless), never ChallengeUnavailable', async () => {
    const { controller } = mounted();
    const p = controller.run('welfare_report', 'r-3');
    await settle();
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(p).resolves.toBeNull();
  });

  it('a load error resolves null and does not throw', async () => {
    const { controller } = mounted();
    const p = controller.run('welfare_report', 'r-4');
    await settle();
    controller.handleLoadError();
    await expect(p).resolves.toBeNull();
    expect(controller.getView().url).toBeNull();
  });

  it('a load error after the sheet came up is still tokenless (not an unanswered tap)', async () => {
    const { controller } = mounted();
    const p = controller.run('welfare_report', 'r-5');
    await settle();
    controller.handleMessage('{"type":"interactive"}');
    controller.handleLoadError();
    await expect(p).resolves.toBeNull();
  });

  it('an error message from the page resolves null', async () => {
    const { controller } = mounted();
    const p = controller.run('welfare_report', 'r-6');
    await settle();
    controller.handleMessage('{"type":"error","code":"600010"}');
    await expect(p).resolves.toBeNull();
  });

  it('a draft that Cloudflare wants a tap for goes tokenless without ever showing the sheet', async () => {
    const { controller } = mounted();
    const p = controller.run('welfare_draft', 'r-7');
    await settle();
    controller.handleMessage('{"type":"interactive"}');
    expect(controller.getView().sheet).toBe(false);
    await expect(p).resolves.toBeNull();
  });

  it('ignores junk, messages from another page, and messages when no check is running', async () => {
    const { controller } = mounted();
    controller.handleMessage('{"type":"token","token":"EARLY"}'); // nothing running: no effect
    const p = controller.run('welfare_report', 'r-8');
    await settle();
    controller.handleMessage('not json');
    controller.handleMessage('{"type":"token","token":"EVIL"}', 'https://evil.example/');
    expect(controller.getView().url).not.toBeNull(); // still waiting
    controller.handleMessage('{"type":"token","token":"GOOD"}', `${PAGE}?action=welfare_report&cdata=r-8`);
    await expect(p).resolves.toBe('GOOD');
  });

  it('with no host mounted, or no sitekey for the app host, resolves null without loading anything', async () => {
    const none = createChallengeController({ origin: () => APP });
    await expect(none.run('welfare_report', 'r-9')).resolves.toBeNull();

    const { controller } = mounted({ origin: () => 'https://eu-project.example.org' });
    await expect(controller.run('welfare_report', 'r-9')).resolves.toBeNull();
    expect(controller.getView().url).toBeNull();
  });

  it('runs checks one at a time, each with its own fresh page', async () => {
    const { controller } = mounted();
    const first = controller.run('welfare_report', 'r-a');
    const second = controller.run('welfare_draft', 'r-b');
    await settle();
    expect(controller.getView().url).toContain('cdata=r-a');
    controller.handleMessage('{"type":"token","token":"A"}');
    await expect(first).resolves.toBe('A');
    await settle();
    expect(controller.getView().url).toContain('cdata=r-b');
    controller.handleMessage('{"type":"token","token":"B"}');
    await expect(second).resolves.toBe('B');
  });

  it('waits for the app to be in the foreground, and that wait is not part of the 20 seconds', async () => {
    let wake!: () => void;
    const foreground = new Promise<void>((r) => (wake = r));
    const { controller } = mounted({ waitForActive: () => foreground });
    const p = controller.run('welfare_report', 'r-fg');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(controller.getView().url).toBeNull(); // nothing loaded in the background
    wake();
    await settle();
    expect(controller.getView().url).toContain('cdata=r-fg');
    controller.handleMessage('{"type":"token","token":"FG"}');
    await expect(p).resolves.toBe('FG');
  });

  it('the host going away mid-check lets the send carry on without a token', async () => {
    const { controller, unsubscribe } = mounted();
    const p = controller.run('welfare_report', 'r-gone');
    await settle();
    unsubscribe();
    await expect(p).resolves.toBeNull();
  });
});

describe('T1-15: navigation outside the allow-list is refused', () => {
  const { controller } = { controller: createChallengeController({ origin: () => APP }) };

  it.each([
    `${APP}/_challenge?action=welfare_report&cdata=x`,
    'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/turnstile/if/ov2/av0/rcv/x',
    'about:blank',
    'about:srcdoc',
  ])('lets %s load', (url) => expect(controller.shouldLoad(url)).toBe(true));

  it.each([
    'https://evil.example/',
    'https://apptest.catspotters.com.evil.example/',
    'https://catspotters.com/',
    'http://apptest.catspotters.com/',
    'http://challenges.cloudflare.com/',
    'javascript:alert(1)',
    'data:text/html,hi',
    'file:///etc/passwd',
    'intent://scan/#Intent;scheme=zxing;end',
    'not a url',
  ])('refuses %s', (url) => expect(controller.shouldLoad(url)).toBe(false));

  it('refuses everything if the app host cannot be read', () => {
    const broken = createChallengeController({
      origin: () => {
        throw new Error('no host');
      },
    });
    expect(broken.shouldLoad(`${APP}/`)).toBe(false);
  });
});
