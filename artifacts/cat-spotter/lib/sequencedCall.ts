/**
 * Guards against a stale async completion overriding a newer one.
 *
 * `syncCameraPermission` in spot.tsx is called from three places — on mount,
 * on Android `AppState` resume, and by the retry button — and those calls
 * can overlap. Without this, a slow call that started first but fails after
 * a faster, more recent call already succeeded would overwrite that success
 * with a stale failure, unmounting a working live preview.
 *
 * `run` stamps each call with a token. A result is only reported `applied`
 * when no later call has STARTED since — regardless of which call settles
 * first. This is pure and has no timers of its own, so it is testable
 * without a real camera or real permission APIs.
 */
export function createSequencedRunner<T>() {
  let latestToken = 0;

  return function run(
    call: () => Promise<T>,
  ): Promise<{ applied: boolean; value?: T; error?: unknown }> {
    latestToken += 1;
    const token = latestToken;
    return call().then(
      (value) => ({ applied: token === latestToken, value }),
      (error) => ({ applied: token === latestToken, error }),
    );
  };
}
