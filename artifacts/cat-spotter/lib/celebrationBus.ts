/**
 * A tapped weekly-result push or bell row asks the celebration to play. The
 * CelebrationProvider registers a handler while it is mounted; with none (the
 * app is still starting) the tap simply opens the Spotters board, and the
 * celebration plays there once the app has loaded.
 */
type Handler = () => Promise<boolean>;

let handler: Handler | null = null;

export function registerWeeklyResultHandler(h: Handler): () => void {
  handler = h;
  return () => {
    if (handler === h) handler = null;
  };
}

interface Navigator {
  push: (href: never) => void;
}

/** Plays the queued weekly-result celebration, or else opens the Spotters board. */
export async function openWeeklyResult(nav: Navigator): Promise<void> {
  let shown = false;
  try {
    shown = handler ? await handler() : false;
  } catch {
    shown = false;
  }
  if (!shown) nav.push({ pathname: '/profile', params: { tab: 'spotters' } } as never);
}
