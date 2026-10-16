import { z } from "zod";
import { areaByKey } from "./areas/namedAreas";
import { COAT_COLOURS } from "./appearance";
import type { CoatColour } from "./appearance";
import { QUERY_MAX } from "./teamCatView";
import { LAST_SEEN, LIVES, MARKS, SORTS, type CatListFilters } from "./teamCatList";

// The Cats page's filters, read from and written to the web address (SYC-396
// PR 1.3; spec §5.1). **An address only ever carries colour codes, an area's
// short key, a colony's number, statuses, the name box and a page number.**
// Never a position, a colony's name or a person's name (plan, global
// constraints). The one exception is the search box's own text (D11), carried
// as typed and capped at QUERY_MAX, as the old search did. Anything else in
// the address is dropped silently.

const MAX_PAGE = 10_000;

/** A query value as a list: `?a=1&a=2` is two, `?a=1` is one, anything odd is none. */
function listOf(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : [v];
  return raw.filter((x): x is string => typeof x === "string");
}

function single(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function subset<T extends string>(v: unknown, allowed: readonly T[]): T[] | undefined {
  const picked = new Set(listOf(v));
  // Keep the canonical order so an address is the same whichever way it was typed.
  const ordered = allowed.filter((a) => picked.has(a));
  return ordered.length ? ordered : undefined;
}

const positiveInt = z.coerce.number().int().min(1).max(2_147_483_647);

export function parseCatFilters(query: unknown): CatListFilters {
  const src = (typeof query === "object" && query !== null ? query : {}) as Record<string, unknown>;
  const f: CatListFilters = {};

  const colours = subset<CoatColour>(src["colours"], COAT_COLOURS);
  if (colours) f.colours = colours;

  const area = single(src["area"]);
  if (area !== undefined && areaByKey(area)) f.area = area;

  const colonyRaw = single(src["colony"]);
  if (colonyRaw !== undefined && /^\d{1,10}$/.test(colonyRaw)) {
    const n = positiveInt.safeParse(colonyRaw);
    if (n.success) f.colony = n.data;
  }

  const sterilised = subset(src["sterilised"], MARKS);
  if (sterilised) f.sterilised = sterilised;

  const lives = subset(src["lives"], LIVES);
  if (lives) f.lives = lives;

  const lastSeen = single(src["lastSeen"]);
  if (lastSeen !== undefined && (LAST_SEEN as readonly string[]).includes(lastSeen)) {
    f.lastSeen = lastSeen as (typeof LAST_SEEN)[number];
  }

  // A repeated or bracketed q is no query (as the old search did).
  const q = single(src["q"])?.slice(0, QUERY_MAX).trim();
  if (q) f.q = q;

  const sort = single(src["sort"]);
  if (sort !== undefined && (SORTS as readonly string[]).includes(sort)) {
    f.sort = sort as (typeof SORTS)[number];
  }

  const pageRaw = single(src["page"]);
  if (pageRaw !== undefined && /^\d{1,5}$/.test(pageRaw)) {
    const n = Number(pageRaw);
    if (n >= 2 && n <= MAX_PAGE) f.page = n;
  }
  return f;
}

/**
 * The filters as a query string (no leading "?"), in a fixed order. Page 1 is
 * left out. Re-checks what it writes, so even a hand-built filter object can
 * not put a position in an address.
 */
export function filtersToQuery(f: CatListFilters): string {
  const p = new URLSearchParams();
  for (const c of f.colours ?? []) if ((COAT_COLOURS as readonly string[]).includes(c)) p.append("colours", c);
  if (f.area !== undefined && areaByKey(f.area)) p.set("area", f.area);
  if (f.colony !== undefined && Number.isInteger(f.colony) && f.colony > 0) p.set("colony", String(f.colony));
  for (const s of f.sterilised ?? []) if ((MARKS as readonly string[]).includes(s)) p.append("sterilised", s);
  for (const l of f.lives ?? []) if ((LIVES as readonly string[]).includes(l)) p.append("lives", l);
  if (f.lastSeen !== undefined && (LAST_SEEN as readonly string[]).includes(f.lastSeen)) p.set("lastSeen", f.lastSeen);
  const q = f.q?.slice(0, QUERY_MAX).trim();
  if (q) p.set("q", q); // the search box's own text may be in the address (D11)
  if (f.sort !== undefined && (SORTS as readonly string[]).includes(f.sort)) p.set("sort", f.sort);
  if (f.page !== undefined && Number.isInteger(f.page) && f.page >= 2 && f.page <= MAX_PAGE) p.set("page", String(f.page));
  return p.toString();
}
