// Calendar days and months on Syros (Europe/Athens), shared by the forms
// that refuse a future date and by Home's "This month" (SYC-396 PR 2.1).

const ZONE = "Europe/Athens";

/** Today's date on Syros, as YYYY-MM-DD. */
export function athensToday(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: ZONE });
}

/** The Syros wall-clock date and hour of an instant. */
function athensParts(at: Date): { y: number; m: number; d: number; h: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: n("year"), m: n("month"), d: n("day"), h: n("hour") };
}

/**
 * The instant a Syros calendar month starts: midnight on the 1st in Athens.
 * `m` is 1–12 and may run over or under (13 is next January, 0 last December).
 */
function monthStart(y: number, m: number): Date {
  const norm = new Date(Date.UTC(y, m - 1, 1));
  const year = norm.getUTCFullYear();
  const month = norm.getUTCMonth() + 1;
  // Athens is UTC+2 in winter and UTC+3 in summer; no month starts inside a
  // clock change (they fall on the last Sunday of March and October).
  for (const offset of [3, 2]) {
    const at = new Date(Date.UTC(year, month - 1, 1, 0) - offset * 3_600_000);
    const p = athensParts(at);
    if (p.y === year && p.m === month && p.d === 1 && p.h === 0) return at;
  }
  throw new Error(`no Athens midnight found for ${year}-${month}`);
}

/** This Syros calendar month and the one before, as [from, to) instants. */
export function athensMonths(now = new Date()): {
  now: { from: Date; to: Date };
  last: { from: Date; to: Date };
} {
  const { y, m } = athensParts(now);
  const from = monthStart(y, m);
  return {
    now: { from, to: monthStart(y, m + 1) },
    last: { from: monthStart(y, m - 1), to: from },
  };
}
