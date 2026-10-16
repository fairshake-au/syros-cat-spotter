/**
 * SYC-170 PR 1.3 (C9): a send that needs a safety check waits for the app to
 * be in the foreground.
 *
 * T1-14: a NetInfo event in the background doesn't start a check.
 */
import { describe, expect, it, vi } from 'vitest';
import { createSendGate, waitForActive, type ForegroundSource } from '../foregroundGate';

function fakeApp(initial: string) {
  let state = initial;
  const listeners = new Set<(s: string) => void>();
  const source: ForegroundSource = {
    current: () => state,
    onChange: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return {
    source,
    state: () => state,
    set(next: string) {
      state = next;
      for (const l of [...listeners]) l(next);
    },
    listenerCount: () => listeners.size,
  };
}

describe('T1-14: a background NetInfo event does not start a check', () => {
  it('only marks the queue due; the next foreground trigger sends once', () => {
    const app = fakeApp('background');
    const send = vi.fn();
    const gate = createSendGate({ state: app.state, send });

    gate.trigger(); // NetInfo: connected, while in the background
    gate.trigger(); // the 60 s timer, still in the background
    expect(send).not.toHaveBeenCalled();
    expect(gate.isDue()).toBe(true);

    app.set('active');
    gate.trigger('active'); // what the AppState listener does
    expect(send).toHaveBeenCalledTimes(1);
    expect(gate.isDue()).toBe(false);
  });

  it('does not send while inactive (the app switcher, an incoming call) either', () => {
    const app = fakeApp('inactive');
    const send = vi.fn();
    createSendGate({ state: app.state, send }).trigger();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends straight away when the app is active', () => {
    const app = fakeApp('active');
    const send = vi.fn();
    const gate = createSendGate({ state: app.state, send });
    gate.trigger();
    expect(send).toHaveBeenCalledTimes(1);
    expect(gate.isDue()).toBe(false);
  });
});

describe('waitForActive', () => {
  it('resolves straight away when active', async () => {
    const app = fakeApp('active');
    await expect(waitForActive(app.source)).resolves.toBeUndefined();
    expect(app.listenerCount()).toBe(0);
  });

  it('waits through background and inactive, then resolves and stops listening', async () => {
    const app = fakeApp('background');
    let done = false;
    const p = waitForActive(app.source).then(() => (done = true));
    app.set('inactive');
    await Promise.resolve();
    expect(done).toBe(false);
    app.set('active');
    await p;
    expect(done).toBe(true);
    expect(app.listenerCount()).toBe(0);
  });
});
