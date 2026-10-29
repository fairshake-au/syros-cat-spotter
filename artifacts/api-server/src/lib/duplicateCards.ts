import { haversineKm } from "./catHelpers";
import {
  addedWhileCheckDown,
  listDuplicates,
  newCatOfSightings,
  reporterLabels,
  type DuplicatePair,
  type ListedReport,
} from "./duplicateList";
import { centre } from "./mergeScreen";
import { shownName, teamCatView, type TeamCatView } from "./teamCatView";
import { coatPhraseOf } from "./teamPages/catFacts";

// What a row of the Possible duplicates list shows (which-cat-is-which.md
// §3.3; SYC-59 PR 5.1): the two cats side by side, why the pair is here in
// plain words, and who sent each report. The list itself, the ladder and the
// reopen rule are lib/duplicateList.ts. Team-only, built from the team's own
// cat view; a device id never reaches a card, only a nickname or "a spotter".

/** At most this many rows are drawn; the page says how many more there are. */
export const CARDS_SHOWN = 40;

export interface CardCat {
  id: number;
  name: string;
  syr: string;
  mainPhotoUrl: string | null;
  /** Up to two more recent photos. */
  recentPhotoUrls: string[];
  /** "Ginger tabby", or null when not known. */
  coat: string | null;
  colony: string | null;
}

export interface CardReporter {
  who: string;
  /** "same cat", "different cats" or "not sure"; empty for a new-cat check (the reason line says it). */
  says: string;
  newPhone: boolean;
}

export interface DuplicateCard {
  low: number;
  high: number;
  level: "likely" | "possible";
  cats: [CardCat, CardCat];
  /** How far apart the two cats are usually seen, in words ("120 m apart"), or null. */
  apart: string | null;
  reasons: string[];
  reporters: CardReporter[];
  reopened: boolean;
  /** Merged by the team and then undone: back on the list marked "Merge undone" (§4.4). */
  mergeUndone: boolean;
  /** The team's "not sure yet" note, if the row was marked that way. */
  notSure: { note: string | null } | null;
}

const SAYS_WORDS: Record<string, string> = { same: "same cat", different: "different cats", not_sure: "not sure" };

const km = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
export const apartWords = (d: number): string => (d < 1 ? `${Math.max(10, Math.round((d * 1000) / 10) * 10)} m apart` : `${km(d)} km apart`);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function cardCat(v: TeamCatView): CardCat {
  const shown = v.photos.filter((p) => p.hidden === null);
  const main = v.cat.mainPhotoUrl;
  const recent = shown
    .filter((p) => p.url !== main)
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
    .slice(0, 2)
    .map((p) => `${p.url}/small`);
  return {
    id: v.cat.id,
    name: shownName(v.cat),
    syr: v.cat.syr,
    mainPhotoUrl: main ? `${main}/small` : null,
    recentPhotoUrls: recent,
    coat: coatPhraseOf(v),
    colony: v.colony?.name ?? null,
  };
}

/**
 * The reasons, in plain words, in the order the spec's example gives them:
 * "2 spotters said same cat · fingerprints very alike · Mimi was added while
 * the photo check was down". Names are the cats' current names.
 */
export function reasonsOf(
  pair: DuplicatePair,
  names: { low: string; high: string },
  extra: { newCatOf: ReadonlyMap<number, number>; downCats: ReadonlySet<number>; ids: { low: number; high: number } },
): string[] {
  const reasons: string[] = [];
  const voices = (says: string, source: string) =>
    new Set(pair.reports.filter((r) => r.source === source && r.says === says).map((r) => r.deviceId ?? "cleared")).size;
  const same = voices("same", "spotter_question");
  const different = voices("different", "spotter_question");
  const unsure = voices("not_sure", "spotter_question");
  if (same > 0) reasons.push(`${plural(same, "spotter", "spotters")} said same cat`);
  if (different > 0) reasons.push(`${plural(different, "spotter", "spotters")} said different cats`);
  if (unsure > 0) reasons.push(`${plural(unsure, "spotter wasn't", "spotters weren't")} sure`);
  if (pair.reports.some((r) => r.source === "sweep")) reasons.push("fingerprints very alike");
  if (pair.reports.some((r) => r.source === "game")) reasons.push(`Players think ${names.low} and ${names.high} are one cat`);
  if (pair.mergeUndone) reasons.unshift(`The team merged ${names.low} and ${names.high}, then undid it`);
  if (pair.reports.some((r) => r.source === "team")) reasons.push("The team marked this pair");
  for (const r of pair.reports.filter((x) => x.source === "new_cat_check")) {
    const made = r.sightingId === null ? undefined : extra.newCatOf.get(r.sightingId);
    if (made === extra.ids.low || made === extra.ids.high) {
      const [mine, other] = made === extra.ids.low ? [names.low, names.high] : [names.high, names.low];
      reasons.push(`${mine} was added as a new cat though the photo check had suggested ${other}`);
    } else {
      reasons.push("One of these was added as a new cat though the photo check had suggested the other");
    }
  }
  for (const [id, name] of [
    [extra.ids.low, names.low],
    [extra.ids.high, names.high],
  ] as const) {
    if (extra.downCats.has(id)) reasons.push(`${name} was added while the photo check was down`);
  }
  return [...new Set(reasons)];
}

/** Who sent the spotter reports: a nickname or "a spotter", once each, with "new phone" for a phone that does not count yet. */
function reportersOf(pair: DuplicatePair, labels: ReadonlyMap<string, string>): CardReporter[] {
  const out: CardReporter[] = [];
  const seen = new Set<string>();
  // A new-cat check is the system's flag, not the spotter's answer; the reason line covers it.
  const spotter = pair.reports.filter((r: ListedReport) => r.source === "spotter_question" && (r.deviceId !== null || r.redacted));
  for (const r of spotter) {
    const key = `${r.deviceId ?? "cleared"}:${r.says}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      who: (r.deviceId !== null ? labels.get(r.deviceId) : undefined) ?? "a spotter",
      says: SAYS_WORDS[r.says] ?? r.says,
      newPhone: r.deviceId !== null && pair.newPhones.has(r.deviceId),
    });
  }
  // The new-cat checks of phones that do not count yet keep their "new phone" mark, with no answer attached.
  for (const r of pair.reports) {
    if (r.source !== "new_cat_check" || r.deviceId === null || !pair.newPhones.has(r.deviceId)) continue;
    const key = `${r.deviceId}:new_cat_check`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ who: labels.get(r.deviceId) ?? "a spotter", says: "", newPhone: true });
  }
  return out;
}

/** The rows of the list, newest evidence first within each ladder step, ready to draw. */
export async function loadDuplicateCards(now: Date = new Date()): Promise<{ cards: DuplicateCard[]; total: number }> {
  const all = await listDuplicates(now);
  const shown = all.slice(0, CARDS_SHOWN);
  if (shown.length === 0) return { cards: [], total: all.length };

  const reports = shown.flatMap((p) => p.reports);
  const labels = await reporterLabels(reports.flatMap((r) => (r.deviceId !== null ? [r.deviceId] : [])));
  const newCatOf = await newCatOfSightings(reports.flatMap((r) => (r.source === "new_cat_check" && r.sightingId !== null ? [r.sightingId] : [])));
  const downCats = await addedWhileCheckDown(shown.flatMap((p) => [p.low, p.high]));

  const cards: DuplicateCard[] = [];
  for (const p of shown) {
    const [lo, hi] = await Promise.all([teamCatView(p.low, now), teamCatView(p.high, now)]);
    if (!lo || !hi) continue;
    const a = cardCat(lo);
    const b = cardCat(hi);
    const ca = centre(lo);
    const cb = centre(hi);
    cards.push({
      low: p.low,
      high: p.high,
      level: p.level,
      cats: [a, b],
      apart: apartWords(haversineKm(ca.lat, ca.lng, cb.lat, cb.lng)),
      reasons: reasonsOf(p, { low: lo.cat.namePending ? lo.cat.syr : lo.cat.name, high: hi.cat.namePending ? hi.cat.syr : hi.cat.name }, { newCatOf, downCats, ids: { low: p.low, high: p.high } }),
      reporters: reportersOf(p, labels),
      reopened: p.reopened,
      mergeUndone: p.mergeUndone,
      notSure: p.notSure ? { note: p.notSure.note } : null,
    });
  }
  return { cards, total: all.length };
}
