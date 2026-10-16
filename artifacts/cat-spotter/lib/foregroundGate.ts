/**
 * SYC-170 PR 1.3 (C9): a send that needs a safety check only happens while the
 * app is in the foreground. The check runs in a WebView, and a phone may
 * freeze or throttle a page when the app is in the background.
 *
 * Framework-free: the caller supplies the app's state and a way to hear about
 * changes (React Native's `AppState`), so the rules are unit-testable.
 */

export type AppStateName = string; // 'active' | 'background' | 'inactive' | ...

export interface ForegroundSource {
  current(): AppStateName;
  /** Calls `listener` on every change; returns a way to stop listening. */
  onChange(listener: (state: AppStateName) => void): () => void;
}

/** Resolves once the app is active (straight away if it already is). */
export function waitForActive(source: ForegroundSource): Promise<void> {
  if (source.current() === 'active') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const stop = source.onChange((state) => {
      if (state !== 'active') return;
      stop();
      resolve();
    });
    // It may have flipped between the check and the subscription.
    if (source.current() === 'active') {
      stop();
      resolve();
    }
  });
}

/**
 * Decides whether a trigger (a NetInfo event, the timer, opening the app) may
 * start a send now. In the background it only marks the queue "due"; the next
 * trigger in the foreground (the app becoming active is one) sends it.
 */
export function createSendGate(deps: { state(): AppStateName; send(): void }) {
  let due = false;
  return {
    /** A trigger fired. `state` overrides the app's state when the caller already knows it. */
    trigger(state?: AppStateName): void {
      if ((state ?? deps.state()) === 'active') {
        due = false;
        deps.send();
      } else {
        due = true;
      }
    },
    /** Whether a trigger arrived in the background and is waiting for the foreground. */
    isDue: () => due,
  };
}
