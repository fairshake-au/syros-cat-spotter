import { timeAgo } from "./queuePage";

// One wording rule for "last seen" (SYC-396 PR 1.3 review): "Last seen 3 days
// ago" for under 30 days, then "Last seen on 12 Sept 2026". Dates are Athens
// time, so a sighting just after midnight there is that day, not the day
// before in UTC. Plain text: escape it where it is drawn.

const MONTH = 30 * 86_400_000;

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
