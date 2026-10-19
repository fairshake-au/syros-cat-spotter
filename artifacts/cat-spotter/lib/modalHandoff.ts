import { Platform } from 'react-native';

/**
 * Opening one modal straight after closing another (SYC-44 PR 6.2: the
 * full-screen photo hands over to the reason sheet). iOS won't present a
 * modal while another is still fading out, so there the second one opens
 * once the first has gone (review finding 3). Elsewhere it opens at once.
 */
export const MODAL_HANDOFF_MS = 350;

export function afterModalCloses(open: () => void, os: string = Platform.OS): void {
  if (os === 'ios') setTimeout(open, MODAL_HANDOFF_MS);
  else open();
}
