import { NOT_SEEN_LATELY_DAYS } from "../dashboard/countedCats";
import { timeAgo } from "./queuePage";

// One wording rule for "last seen" (SYC-396 PR 1.3 review): "Last seen 3 days
// ago" for under 30 days, then "Last seen on 12 Sept 2026". Dates are Athens
// time, so a sighting just after midnight there is that day, not the day
// before in UTC. Plain text: escape it where it is drawn.

const MONTH = 30 * 86_400_000;

/**
 * "6 weeks or more": how long a street cat must go unseen to be "not seen
 * lately" (SYC-485). Worked out from the one number Home counts with, so the
 * Cats list's filter and Home's hint both follow if Syros Cats change it
 * (SYC-442). A whole number of weeks reads as weeks, anything else as days.
 */
export function notSeenWords(days: number = NOT_SEEN_LATELY_DAYS): string {
  return days % 7 === 0 ? `${days / 7} ${days === 7 ? "week" : "weeks"} or more` : `${days} days or more`;
}

export function lastSeenWords(at: Date | null, now: Date): string {
  if (at === null) return "Never seen since first recorded";
  if (now.getTime() - at.getTime() < MONTH) return `Last seen ${timeAgo(at.toISOString(), now)}`;
  const date = at.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Athens",
  });
  return `Last seen on ${date}`;
}
