/**
 * SYC-186: "Saved. Find it under Spots on your phone." A one-shot flag set when
 * the spotter leaves "Have we met?" for a spot kept in the list, read once by
 * the Spot tab. Module state on purpose: it never outlives the app, and a
 * second read is empty, so the note shows once per leaving.
 */
let left = false;

export function markLeftUnfinished(): void {
  left = true;
}

/** True once after a mark; false after that and when nothing was marked. */
export function consumeLeftUnfinished(): boolean {
  const was = left;
  left = false;
  return was;
}
