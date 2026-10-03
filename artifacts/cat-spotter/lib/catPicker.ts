/**
 * The "Find the cat" list's pure logic (SYC-119,
 * docs/specs/choose-a-different-cat.md §3.2, §4.4, §4.8, §9).
 *
 * The list is built as if the matcher had never run: it takes the public
 * cat-alogue and the sighting's saved location, and nothing else. It is
 * ordered and bounded by lib/geo, the same rule the server enforces, and
 * search only ever narrows it.
 */
import { nearbyOrder, type LatLng } from '@workspace/geo';
import { ApiError, type NameTakenCat } from '@workspace/api-client-react';

type Searchable = LatLng & { id: number; name: string };

export type PickedFrom = 'nearby' | 'search';

/**
 * Lower-case, strip accents and fold final sigma, so "ΑΓΆΘΗ" finds "Αγάθη",
 * "zoe" finds "Zoé" and "ΝΗΣ" finds "Νησος" (the folding in DECISIONS
 * Part 2g: ς is the same letter as σ). Also strips invisible formatting
 * characters (zero-width spaces and the like) and collapses any run of
 * whitespace to one space, so a stray paste artefact in a cat's name
 * doesn't stop a search from finding it (Samuel, 3 Oct 2026).
 *
 * Matches `@workspace/db`'s `foldName` for every case above. The two still
 * disagree on Hangul (`foldName` normalises to NFC, this search fold
 * doesn't) — harmless here because this only ever narrows a visible list
 * and never merges two records; see `foldName`'s doc comment.
 */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\p{Cf}/gu, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "SYR-0042", "syr 42", "0042" and "42" all mean cat 42 (spec §9, test 12). */
function syrNumber(query: string): number | null {
  const m = /^\s*(?:syr)?[\s-]*0*(\d+)\s*$/i.exec(query);
  return m ? Number(m[1]) : null;
}

export function matchesSearch(cat: Searchable, query: string): boolean {
  if (query.trim() === '') return true;
  const number = syrNumber(query);
  if (number !== null && cat.id === number) return true;
  return fold(cat.name).includes(fold(query));
}

/** Cats known around here, nearest first, narrowed by the search box. */
export function pickerList<T extends Searchable>(
  from: LatLng,
  cats: readonly T[],
  query: string,
): T[] {
  return nearbyOrder(from, cats).filter((cat) => matchesSearch(cat, query));
}

export function pickedFromFor(query: string): PickedFrom {
  return query.trim() === '' ? 'nearby' : 'search';
}

/**
 * What to say when a choice can't be sent (spec §4.5, §6). The spec's line
 * promises the sighting waits in the review list, which is true only for a
 * sighting that went through the phone's queue. One sent straight away has
 * no entry there, so leaving the screen loses the way back to it: that
 * spotter is asked to keep the screen open instead.
 */
export function noSignalMessage({
  inReviewList,
}: {
  inReviewList: boolean;
}): 'pickerNoSignal' | 'pickerNoSignalStay' {
  return inReviewList ? 'pickerNoSignal' : 'pickerNoSignalStay';
}

/**
 * The request for a new cat. `openedPicker` says whether the spotter opened
 * "Find the cat yourself" first: weak evidence the cat really is new,
 * recorded for the team only (SYC-151, spec §4.6).
 */
export function newCatRequest(
  deviceId: string,
  name: string,
  openedPicker: boolean,
): { deviceId: string; newCatName: string; openedPicker: boolean } {
  return { deviceId, newCatName: name.trim(), openedPicker };
}

export type ResolveFailure =
  | { kind: 'not-nearby' }
  | { kind: 'name-taken'; cat: NameTakenCat | null }
  | { kind: 'offensive' }
  | { kind: 'offline' }
  | { kind: 'error' };

/** What went wrong when sending a choice, in the terms the review screen needs. */
export function classifyResolveError(err: unknown): ResolveFailure {
  if (!(err instanceof ApiError)) {
    // The request never got an answer from the server: no signal. The
    // sighting stays in the review list and nothing is lost (spec §4.5).
    return err instanceof TypeError ? { kind: 'offline' } : { kind: 'error' };
  }
  const data = (err.data ?? null) as { code?: string; cat?: NameTakenCat } | null;
  switch (data?.code) {
    case 'NOT_NEARBY':
      return { kind: 'not-nearby' };
    case 'NAME_TAKEN':
      return { kind: 'name-taken', cat: data.cat ?? null };
    case 'OFFENSIVE_NAME':
      return { kind: 'offensive' };
    default:
      return { kind: 'error' };
  }
}
