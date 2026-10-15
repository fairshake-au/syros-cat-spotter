/**
 * SYC-170 PR 1.2: shared by both halves of the client Turnstile twin
 * (lib/turnstile.ts for the phone apps, lib/turnstile.web.ts for the website).
 */

export type ChallengeAction = 'welfare_report' | 'welfare_draft' | 'report_issue';

/** How long a safety check may take before the send gives up and keeps the report. */
export const CHALLENGE_TIMEOUT_MS = 20_000;

/**
 * The safety check couldn't run or finish (script blocked, offline, timed out,
 * Cloudflare reported an error). The report is NOT refused: it stays saved and
 * is tried again later, with no strike (spec §9.5).
 */
export class ChallengeUnavailable extends Error {
  readonly reason: string;
  constructor(reason = 'unavailable') {
    super(`Turnstile challenge unavailable: ${reason}`);
    this.name = 'ChallengeUnavailable';
    this.reason = reason;
  }
}

export function isChallengeUnavailable(err: unknown): err is ChallengeUnavailable {
  return err instanceof ChallengeUnavailable || (err as { name?: unknown } | null)?.name === 'ChallengeUnavailable';
}
