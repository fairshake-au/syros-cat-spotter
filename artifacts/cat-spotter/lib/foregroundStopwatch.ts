/**
 * How long the waiting card has been on screen, counting only time while the
 * app is in the foreground (SYC-48, match-wait plan PR 1, review finding 9): a
 * fact counts as seen after 3 seconds on screen, and a phone put in a pocket
 * mid-upload hasn't been read. Pure, so it is tested with fixed times.
 */
export class ForegroundStopwatch {
  private total = 0;
  private since: number | null;

  constructor(now: number, active = true) {
    this.since = active ? now : null;
  }

  pause(now: number): void {
    if (this.since !== null) {
      this.total += Math.max(0, now - this.since);
      this.since = null;
    }
  }

  resume(now: number): void {
    if (this.since === null) this.since = now;
  }

  elapsed(now: number): number {
    return this.total + (this.since === null ? 0 : Math.max(0, now - this.since));
  }
}
