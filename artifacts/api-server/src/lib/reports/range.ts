// A report's time range (SYC-396 PR 3.3a; spec §9.3): this month, the last 3
// months, this year, all time, or dates you choose. On the Syros calendar
// (Europe/Athens), like Home's "This month". Only dates ever reach an address
// (`?range=custom&from=2026-08-01&to=2026-09-30`), never anything else.

const ZONE = "Europe/Athens";
const DAY = 86_400_000;

export type RangeKey = "month" | "3months" | "year" | "all" | "custom";
export const RANGE_KEYS: readonly RangeKey[] = ["month", "3months", "year", "all", "custom"];

export interface Range {
  key: RangeKey;
  /** The first instant counted; null for All time. */
  from: Date | null;
  /** The last instant counted: never after now. */
  to: Date;
  /** "Last 3 months", "1 Aug 2026 – 30 Sep 2026". */
  label: string;
  /** For a custom range: the two dates as chosen, YYYY-MM-DD (the form fills them back in). */
  dates?: { from: string; to: string };
}

/** The Syros wall-clock date of an instant. */
function athensDate(at: Date): { y: number; m: number; d: number } {
  const [y, m, d] = at.toLocaleDateString("en-CA", { timeZone: ZONE }).split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}

/**
 * Midnight on Syros at the start of a calendar day. Month and day may run
 * over or under (month 13 is next January, day 0 the last of the month
 * before). Athens is UTC+2 or UTC+3, and its clocks change at 03:00 or 04:00,
 * so every day has a midnight.
 */
export function athensMidnight(y: number, m: number, d: number): Date {
  const norm = new Date(Date.UTC(y, m - 1, d));
  for (const offset of [3, 2]) {
    const at = new Date(norm.getTime() - offset * 3_600_000);
    const p = athensDate(at);
    const h = Number(at.toLocaleTimeString("en-GB", { timeZone: ZONE, hour: "2-digit", hourCycle: "h23" }));
    if (p.y === norm.getUTCFullYear() && p.m === norm.getUTCMonth() + 1 && p.d === norm.getUTCDate() && h === 0) return at;
  }
  throw new Error(`no Athens midnight for ${y}-${m}-${d}`);
}

/** "18 Oct 2026", on Syros. */
export function dayWords(at: Date): string {
  const { y, m, d } = athensDate(at);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// Fixed, so "Sep" never becomes "Sept" with a different ICU.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date typed as YYYY-MM-DD, or null. */
function parseDate(v: unknown): { y: number; m: number; d: number; text: string } | null {
  if (typeof v !== "string") return null;
  const m = DATE_RE.exec(v);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  if (y < 2000) return null;
  return { y, m: mo, d, text: v };
}

const pick = (q: unknown, key: string): unknown =>
  q !== null && typeof q === "object" ? (q as Record<string, unknown>)[key] : undefined;

/**
 * The range a request asks for. Anything not understood is the last 3 months;
 * a range never ends after now, and a custom range whose start is after its
 * end (or after today) is the last 3 months too.
 */
export function parseRange(q: unknown, now: Date): Range {
  const key = pick(q, "range");
  const today = athensDate(now);
  if (key === "month") {
    return { key, from: athensMidnight(today.y, today.m, 1), to: now, label: "This month" };
  }
  if (key === "year") {
    return { key, from: athensMidnight(today.y, 1, 1), to: now, label: "This year" };
  }
  if (key === "all") return { key, from: null, to: now, label: "All time" };
  if (key === "custom") {
    const f = parseDate(pick(q, "from"));
    const t = parseDate(pick(q, "to"));
    if (f && t) {
      const from = athensMidnight(f.y, f.m, f.d);
      // The whole of the last day chosen, but never after now.
      const end = new Date(athensMidnight(t.y, t.m, t.d + 1).getTime() - 1);
      const to = end.getTime() > now.getTime() ? now : end;
      if (from.getTime() <= to.getTime()) {
        return { key, from, to, label: `${dayWords(from)} – ${dayWords(to)}`, dates: { from: f.text, to: t.text } };
      }
    }
  }
  return { key: "3months", from: athensMidnight(today.y, today.m - 3, today.d), to: now, label: "Last 3 months" };
}

/** The query string for a range, for links that keep it (dates only). */
export function rangeQuery(r: Range): string {
  if (r.key === "custom" && r.dates) return `range=custom&from=${r.dates.from}&to=${r.dates.to}`;
  return `range=${r.key}`;
}

/** Where a range starts, for working out its weeks or months: All time starts at the first event. */
const startOf = (r: Range, firstEvent: Date) =>
  r.from === null || r.from.getTime() < firstEvent.getTime() ? firstEvent : r.from;

/**
 * The Mondays (Syros midnight) starting each week that touches the range,
 * oldest first. The first may fall before the range starts.
 */
export function weeksIn(r: Range, firstEvent: Date): Date[] {
  const start = athensDate(startOf(r, firstEvent));
  // getUTCDay of the calendar date: 0 is Sunday.
  const dow = new Date(Date.UTC(start.y, start.m - 1, start.d)).getUTCDay();
  let at = athensMidnight(start.y, start.m, start.d - ((dow + 6) % 7));
  const out: Date[] = [];
  while (at.getTime() <= r.to.getTime()) {
    out.push(at);
    const p = athensDate(at);
    at = athensMidnight(p.y, p.m, p.d + 7);
  }
  return out;
}

/** The first of each Syros month that touches the range, oldest first. */
export function monthsIn(r: Range, firstEvent: Date): Date[] {
  const start = athensDate(startOf(r, firstEvent));
  const out: Date[] = [];
  for (let i = 0; ; i++) {
    const at = athensMidnight(start.y, start.m + i, 1);
    if (at.getTime() > r.to.getTime()) break;
    out.push(at);
  }
  return out;
}

/** Is the range short enough to be drawn week by week (3 months or less)? */
export function isShort(r: Range, firstEvent: Date): boolean {
  return r.to.getTime() - startOf(r, firstEvent).getTime() <= 93 * DAY;
}
