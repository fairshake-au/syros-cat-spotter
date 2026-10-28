import { db, photosTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { canonicalCatOf, liveCats } from "./catIdentity";
import { colonyAfterMerge } from "./colonyMembership";
import { haversineKm } from "./catHelpers";
import type { CapabilityHolder } from "./capabilities";
import { countingPhones } from "./countingPhone";
import { DELETED_PREFIX } from "./deviceAuth";
import { defaultSurvivor, MERGE_WORDS, reportersOf } from "./mergeCats";
import { loadCatRecords } from "./observations";
import { POINTS_DUPLICATE } from "./points";
import { resolveLifeStatus, resolveSterilised, type EvidenceOfLife } from "./resolve";
import { TEAM_DESK_DEVICE } from "./teamDesk";
import { searchTeamCats, syrNumber, teamCatView, teamPhotoUrl, type TeamCatView } from "./teamCatView";
import { LIFE } from "./teamPages/catActions";
import { coatPhraseOf } from "./teamPages/catFacts";

// What the merge screen shows (which-cat-is-which.md §4.1, decision D7; SYC-59
// PR 4.2): the two cats side by side, which record stays (with its two
// limits), "What happens" before anything is saved, the warnings that are true
// and the one block. Read-only. The screen sends the counts it showed (§6);
// the merge itself, and every refusal, is lib/mergeCats.ts.

/** Bold marks in a line of words: the page turns these into <b>, after escaping. */
export const BOLD_ON = "";
export const BOLD_OFF = "";
const bold = (name: string) => `${BOLD_ON}${name.replace(/[]/g, "")}${BOLD_OFF}`;

export interface MergeAsk {
  /** The cat the team opened the screen from. */
  a: number;
  /** The other cat, once chosen. */
  b?: number;
  /** The cat that stays, if the team switched it. */
  survivor?: number;
  /** The search box's words, while choosing the other cat. */
  q: string;
}

export interface MergeSide {
  id: number;
  name: string;
  syr: string;
  namePending: boolean;
  since: string;
  mainPhotoUrl: string | null;
  photoUrls: string[];
  colony: string | null;
  sterilised: string;
  life: string;
  owner: boolean;
  followers: number;
  sightings: number;
}

export interface MergeScreen {
  /** As asked: the cat the screen was opened from, then the other. */
  sides: [MergeSide, MergeSide];
  stays: MergeSide;
  goes: MergeSide;
  /** Is "Which record stays?" a free choice? */
  canSwitch: boolean;
  /** Why it is not, in words ("" when it is). */
  limit: string;
  /** Blocks the merge, in the spec's words. */
  block: string | null;
  whatHappens: string[];
  warnings: string[];
  /** [the staying record's resolved sightings, the other's]: what the merge route is told to expect. */
  expectedCounts: [number, number];
}

export type MergeLoad =
  | { kind: "ok"; screen: MergeScreen }
  /** Choosing the other cat. */
  | {
      kind: "choose";
      a: MergeSide;
      note: string;
      results: { heading: string; cats: { id: number; name: string; syr: string; thumbnailUrl: string | null; away: string | null }[] };
    }
  /** Nothing can be merged from this address. */
  | { kind: "stop"; status: number; message: string; link?: { href: string; label: string } };

const NEARBY_SHOWN = 8;

export const nameOf = (v: Pick<TeamCatView, "cat">): string => (v.cat.namePending ? v.cat.syr : v.cat.name);

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Athens" });

const monthOf = (iso: string, now: Date) => {
  const opt = { timeZone: "Europe/Athens" } as const;
  const year = (d: Date) => d.toLocaleDateString("en-GB", { year: "numeric", ...opt });
  const at = new Date(iso);
  return at.toLocaleDateString("en-GB", { month: "long", ...(year(at) === year(now) ? {} : { year: "numeric" }), ...opt });
};

/** The spec's words for what is known about sterilisation: "Likely", "Unknown" (§4.1). */
function sterilWords(s: { value: boolean | null; confidence: string }): string {
  if (s.value === null || s.confidence === "unknown") return "Unknown";
  if (s.value) return s.confidence === "likely" ? "Likely" : s.confidence === "reported" ? "Reported" : "Yes";
  return s.confidence === "reported" ? "Reported not sterilised" : "No";
}

const sightingsWord = (n: number) => `${n} ${n === 1 ? "sighting" : "sightings"}`;
const km = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** Followers who count: never a deleted phone's leftover row, never the team desk. */
async function followersOf(catId: number): Promise<number> {
  const r = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from cat_subscriptions
     where cat_id = ${catId} and device_id not like ${DELETED_PREFIX + "%"} and device_id <> ${TEAM_DESK_DEVICE}`);
  return Number(r.rows[0]?.n ?? 0);
}

/** Of the merged-away cat's followers, how many will follow the survivor (those who unfollowed it won't). */
async function followersCarried(mergedId: number, survivorId: number): Promise<{ carried: number; stay: number }> {
  const r = await db.execute<{ carried: number; stay: number }>(sql`
    select count(*) filter (where not exists (select 1 from cat_unfollows u where u.device_id = f.device_id and u.cat_id = ${survivorId}))::int as carried,
           count(*) filter (where exists (select 1 from cat_unfollows u where u.device_id = f.device_id and u.cat_id = ${survivorId}))::int as stay
      from cat_subscriptions f
     where f.cat_id = ${mergedId} and f.device_id not like ${DELETED_PREFIX + "%"} and f.device_id <> ${TEAM_DESK_DEVICE}`);
  return { carried: Number(r.rows[0]?.carried ?? 0), stay: Number(r.rows[0]?.stay ?? 0) };
}

/** Cat guardians of these colonies, with the colony each guards. People who have left, and placements that ended, are left out. */
async function guardiansOf(colonyIds: readonly number[]): Promise<{ name: string; colonyId: number }[]> {
  if (colonyIds.length === 0) return [];
  const r = await db.execute<{ name: string; colony_id: number }>(sql`
    select p.name, ps.colony_id
      from person_scopes ps
      join people p on p.id = ps.person_id
     where ps.role = 'guardian' and ps.reach = 'colony'
       and ps.colony_id in (${sql.join(colonyIds.map((c) => sql`${c}`), sql`, `)})
       and p.left_at is null
       and (ps.expires_at is null or ps.expires_at > now())
     order by p.name, ps.colony_id`);
  return r.rows.map((row) => ({ name: row.name, colonyId: Number(row.colony_id) }));
}

/** Phones that said "same cat" about this pair, count now, and have not been paid for the pair already. */
async function phonesToPay(low: number, high: number): Promise<number> {
  const reporters = await reportersOf(db, { low, high }, null);
  if (reporters.length === 0) return 0;
  const counting = await countingPhones(reporters, {}, db);
  if (counting.size === 0) return 0;
  const paid = await db.execute<{ device_id: string }>(sql`
    select device_id from points_ledger
     where duplicate_cat_low = ${low} and duplicate_cat_high = ${high} and source = 'duplicate'`);
  const already = new Set(paid.rows.map((row) => row.device_id));
  return [...counting].filter((d) => !already.has(d)).length;
}

async function sideOf(v: TeamCatView): Promise<MergeSide> {
  const photos = v.photos.map((p) => `${p.url}/small`);
  return {
    id: v.cat.id,
    name: nameOf(v),
    syr: v.cat.syr,
    namePending: v.cat.namePending,
    since: day(v.cat.createdAt),
    mainPhotoUrl: v.cat.mainPhotoUrl,
    photoUrls: photos, // every photo of the cat (§4.1); the page wraps them
    colony: v.colony?.name ?? null,
    sterilised: sterilWords(v.records.sterilised),
    life: LIFE[v.records.lifeStatus.value ?? "street"],
    owner: v.owner.has || v.owner.orphanedHome,
    followers: await followersOf(v.cat.id),
    sightings: v.sightings.length,
  };
}

/** Where the cat is usually seen: the middle of its sightings, or where it was first recorded. */
function centre(v: TeamCatView): { lat: number; lng: number } {
  const spots: { lat: number; lng: number }[] = v.sightings.length > 0 ? v.sightings : [{ lat: v.cat.lat, lng: v.cat.lng }];
  return { lat: spots.reduce((n, p) => n + p.lat, 0) / spots.length, lng: spots.reduce((n, p) => n + p.lng, 0) / spots.length };
}

/**
 * Sterilised and life status worked out over both records together, as the
 * merge will (§4.2): the staying record's statements and the other's (never
 * the other's coat or markings, which stay its own), the newer evidence of
 * life, and the same resolvers the cat page uses. A test merges for real and
 * compares.
 */
async function combined(survivorId: number, mergedId: number, now: Date) {
  const recs = await loadCatRecords([survivorId, mergedId]);
  const s = recs.get(survivorId);
  const m = recs.get(mergedId);
  const own = s?.observations ?? [];
  const theirs = (m?.observations ?? []).filter((o) => o.kind !== "coat" && o.kind !== "markings");
  const seen = new Set(own.map((o) => o.id));
  const all = [...own, ...theirs.filter((o) => !seen.has(o.id))];
  const e1 = s?.evidenceOfLife ?? null;
  const e2 = m?.evidenceOfLife ?? null;
  const later = (a: Date | null, b: Date | null) => (a && b ? (a.getTime() >= b.getTime() ? a : b) : (a ?? b));
  const evidence: EvidenceOfLife | null =
    e1 && e2
      ? { ...(e1.at.getTime() >= e2.at.getTime() ? e1 : e2), lastSightingAt: later(e1.lastSightingAt, e2.lastSightingAt) }
      : (e1 ?? e2);
  const mergedIds = new Set(theirs.map((o) => o.id));
  return {
    sterilised: resolveSterilised(all, []),
    life: resolveLifeStatus(all, evidence, now),
    // Which kind of record of the other cat the answer rests on, for "from Mimi's clipped ear".
    fromMerged: (ids: readonly number[]) => all.filter((o) => mergedIds.has(o.id) && !seen.has(o.id) && ids.includes(o.id)).map((o) => o.kind),
  };
}

const KIND_WORDS: Record<string, string> = {
  ear_tip: "clipped ear",
  sterilised: "sterilisation record",
  vet_visit: "vet visit",
};

/** The cats to choose from while the other cat is not chosen: matching the words, or nearest first. */
async function candidates(q: string, a: TeamCatView): Promise<Extract<MergeLoad, { kind: "choose" }>["results"]> {
  const words = q.trim();
  if (words !== "") {
    const found = (await searchTeamCats(words)).filter((c) => c.id !== a.cat.id);
    return {
      heading: found.length === 0 ? `No cat found for “${words}”` : `Cats matching “${words}”`,
      cats: found.map((c) => ({
        id: c.id,
        name: c.alsoKnownAs ? `${c.alsoKnownAs} (now part of ${c.name})` : c.name,
        syr: c.syr,
        thumbnailUrl: c.thumbnailUrl,
        away: null,
      })),
    };
  }
  const all = await liveCats({
    id: sql<number>`cats.id`,
    name: sql<string>`cats.name`,
    lat: sql<number>`cats.lat`,
    lng: sql<number>`cats.lng`,
    photoPublicId: photosTable.publicId,
  }).leftJoin(photosTable, eq(photosTable.id, sql`cats.primary_photo_id`));
  const here = centre(a);
  const near = all
    .filter((c) => c.id !== a.cat.id)
    .map((c) => ({ c, d: haversineKm(here.lat, here.lng, c.lat, c.lng) }))
    .sort((x, y) => x.d - y.d || x.c.id - y.c.id)
    .slice(0, NEARBY_SHOWN);
  return {
    heading: `Cats near ${nameOf(a)}`,
    cats: near.map(({ c, d }) => ({
      id: c.id,
      name: c.name,
      syr: syrNumber(c.id),
      thumbnailUrl: c.photoPublicId ? `${teamPhotoUrl(c.photoPublicId)}/small` : null,
      away: d < 1 ? `${Math.max(10, Math.round((d * 1000) / 10) * 10)} m away` : `${km(d)} km away`,
    })),
  };
}

/** The cat's page address: a merge screen stop links to the cat the team should open instead. */
const catLink = (id: number, label: string) => ({ href: `/api/team/cats/${id}`, label });

/**
 * Loads the screen. A cat that doesn't exist, or is already part of another
 * cat, stops here with the words the route would have refused with.
 */
export async function loadMergeScreen(person: CapabilityHolder, ask: MergeAsk, now = new Date()): Promise<MergeLoad> {
  const first = await teamCatView(ask.a, now, person);
  if (!first) return { kind: "stop", status: 404, message: MERGE_WORDS.notFound };
  const firstCanonical = (await canonicalCatOf([ask.a])).get(ask.a);
  if (firstCanonical != null && firstCanonical !== ask.a) {
    const survivor = await teamCatView(firstCanonical, now, person);
    return {
      kind: "stop",
      status: 409,
      message: MERGE_WORDS.alreadyMerged(nameOf(first)),
      link: catLink(firstCanonical, `Open ${survivor ? nameOf(survivor) : "that cat"}`),
    };
  }

  // The other cat: chosen, or still to choose.
  let note = "";
  let second: TeamCatView | null = null;
  if (ask.b !== undefined) {
    if (ask.b === ask.a) note = MERGE_WORDS.sameCat;
    else {
      second = await teamCatView(ask.b, now, person);
      if (!second) note = MERGE_WORDS.notFound;
      else {
        const c = (await canonicalCatOf([ask.b])).get(ask.b);
        if (c != null && c !== ask.b) {
          const target = await teamCatView(c, now, person);
          note = `${MERGE_WORDS.alreadyMerged(nameOf(second))}${target ? ` It is part of ${nameOf(target)}.` : ""}`;
          second = null;
        }
      }
    }
  }
  if (second === null) {
    return { kind: "choose", a: await sideOf(first), note, results: await candidates(ask.q, first) };
  }

  const [sa, sb] = [await sideOf(first), await sideOf(second)];
  const views = new Map<number, TeamCatView>([
    [first.cat.id, first],
    [second.cat.id, second],
  ]);

  // Which record stays (D7). The default is the earlier record, unless its
  // name is still pending and the other's isn't. Two limits: a cat with an
  // owner always stays, and a pending name can't stay over a named one.
  const byDefault = defaultSurvivor(
    { id: first.cat.id, createdAt: new Date(first.cat.createdAt), namePending: first.cat.namePending },
    { id: second.cat.id, createdAt: new Date(second.cat.createdAt), namePending: second.cat.namePending },
  );
  let stayId = ask.survivor === first.cat.id || ask.survivor === second.cat.id ? ask.survivor : byDefault;
  let limit = "";
  let block: string | null = null;
  if (sa.owner && sb.owner) block = MERGE_WORDS.twoOwners;
  else if (sa.owner || sb.owner) {
    const owned = sa.owner ? sa : sb;
    stayId = owned.id;
    limit = `${owned.name} has an owner, so ${owned.name}'s record stays. An owner never moves from one record to another.`;
  } else if (first.cat.namePending !== second.cat.namePending) {
    const named = first.cat.namePending ? sb : sa;
    const waiting = first.cat.namePending ? sa : sb;
    stayId = named.id;
    limit = `${waiting.name}'s name is still waiting for a spotter, so it can't stay over a named record. Name ${waiting.name} first, or ${named.name}'s record stays.`;
  }
  const stays = stayId === sa.id ? sa : sb;
  const goes = stayId === sa.id ? sb : sa;
  const sv = views.get(stays.id)!;
  const gv = views.get(goes.id)!;

  const after = await combined(stays.id, goes.id, now);
  const lines: string[] = [];
  const total = stays.sightings + goes.sightings;
  lines.push(
    `${bold(goes.name)} becomes part of ${bold(stays.name)}. ${stays.name} will have ${sightingsWord(total)} (${stays.sightings} + ${goes.sightings}).`,
  );
  lines.push(`Also known as: ${goes.name}.`);

  // Sterilised, worked out over both records together.
  const was = sv.records.sterilised;
  const now_ = after.sterilised;
  const sameSter = was.value === now_.value && was.confidence === now_.confidence;
  if (sameSter) lines.push(`Sterilised: ${sterilWords(now_)}.`);
  else {
    const kinds = after.fromMerged(now_.supportingObservationIds);
    const from = kinds.length > 0 ? `, from ${goes.name}'s ${KIND_WORDS[kinds[0]!] ?? "record"}` : "";
    lines.push(`Sterilised: ${sterilWords(now_)}${from} (was ${sterilWords(was)}).`);
  }
  const lifeWas = sv.records.lifeStatus.value;
  if (after.life.value !== lifeWas && after.life.value !== null) {
    lines.push(`Where the cat lives: ${LIFE[after.life.value]} (was ${lifeWas ? LIFE[lifeWas] : "not recorded"}).`);
  }

  // Colony: the staying record's own wins, else the other's (spec §4.1 table, lib/colonyMembership).
  const sc = sv.colony;
  const gc = gv.colony;
  // The colony after the merge comes from the merge's own rule (colonyAfterMerge): the staying
  // record's statement wins even when it says "in no colony"; the other's counts only if it has none.
  const postId = await colonyAfterMerge(stays.id, goes.id);
  const colonyName = (id: number) => (sc?.id === id ? sc.name : gc?.id === id ? gc.name : "");
  const postName = postId === null ? null : colonyName(postId);
  if (postId === null) {
    lines.push(gc ? `Colony: none. ${goes.name} was in ${gc.name}; change it after merging if that's wrong.` : "Colony: none.");
  } else if (sc && postId === sc.id) {
    lines.push(
      gc && gc.id !== sc.id
        ? `Colony: ${sc.name}. ${goes.name} was in ${gc.name}; change it after merging if that's wrong.`
        : `Colony: ${sc.name}.`,
    );
  } else lines.push(`Colony: ${postName}, from ${goes.name} (${stays.name} had none).`);

  // Colour and markings are the staying record's own.
  const sColour = coatPhraseOf(sv);
  const gColour = coatPhraseOf(gv);
  if (gColour !== null && gColour !== sColour) {
    lines.push(`Colour: ${stays.name}'s (${sColour ?? "not recorded"}). ${goes.name} was recorded as ${gColour.toLowerCase()}; change it after merging if that's wrong.`);
  }

  if (!block) lines.push(stays.owner ? `Owner: ${stays.name} keeps hers. ${goes.name} has none.` : "Owner: neither has one.");

  const carried = await followersCarried(goes.id, stays.id);
  if (carried.carried > 0) {
    lines.push(`${carried.carried === 1 ? "1 person follows" : `${carried.carried} people follow`} ${goes.name}; they'll follow ${stays.name}.`);
  }
  if (carried.stay > 0) {
    lines.push(
      `${carried.stay === 1 ? "1 other person who follows" : `${carried.stay} other people who follow`} ${goes.name} had unfollowed ${stays.name}, so they won't follow ${stays.name}.`,
    );
  }

  // Cat guardians who gain or lose sight of the cat (a guardian sees a cat by its colony).
  const guards = await guardiansOf([...new Set([sc?.id, gc?.id].filter((x): x is number => x !== undefined))]);
  if (gc && postId !== gc.id) {
    const losing = guards.filter((g) => g.colonyId === gc.id);
    const keeping = postId === null ? [] : guards.filter((g) => g.colonyId === postId);
    if (losing.length > 0) {
      lines.push(
        `${losing.map((g) => `Cat guardian ${g.name} (${colonyName(g.colonyId)})`).join(", ")} will no longer see this cat` +
          (keeping.length > 0 ? `; ${keeping.map((g) => `${g.name}'s colony (${colonyName(g.colonyId)})`).join(", ")} keeps it.` : "."),
      );
    }
  } else if (gc && postId === gc.id && sc?.id !== gc.id) {
    const gaining = guards.filter((g) => g.colonyId === gc.id);
    if (gaining.length > 0) {
      lines.push(`${gaining.map((g) => `Cat guardian ${g.name} (${colonyName(g.colonyId)})`).join(", ")} will see ${stays.name}'s record.`);
    }
  }

  const pay = await phonesToPay(Math.min(stays.id, goes.id), Math.max(stays.id, goes.id));
  if (pay > 0) {
    lines.push(
      pay === 1
        ? `1 spotter who reported this gets ${POINTS_DUPLICATE} points.`
        : `${pay} spotters who reported this get ${POINTS_DUPLICATE} points each.`,
    );
  }
  lines.push("The island count goes down by one.");

  // The warnings, only the ones that are true (§4.1's table).
  const warnings: string[] = [];
  const ca = centre(sv);
  const cb = centre(gv);
  const apart = haversineKm(ca.lat, ca.lng, cb.lat, cb.lng);
  if (apart > 2) warnings.push(`These two are usually seen ${km(apart)} km apart.`);
  if (sc && gc && sc.id !== gc.id) {
    warnings.push(`${goes.name} is in ${gc.name} and ${stays.name} in ${sc.name}. After merging she'll show as ${sc.name}.`);
  }
  for (const [dead, other, otherView, deadView] of [
    [goes, stays, sv, gv],
    [stays, goes, gv, sv],
  ] as const) {
    const life = deadView.records.lifeStatus;
    const seen = otherView.sightings[0];
    if (life.value === "deceased" && life.confidence !== "unknown" && seen && Date.parse(seen.at) > Date.parse(life.asOf) && after.life.value !== "deceased") {
      warnings.push(
        `${dead.name} is recorded as having died in ${monthOf(life.asOf, now)}. ${other.name} was seen in ${monthOf(seen.at, now)}, so the merged record will say alive.`,
      );
    }
  }
  if (gc && postId === gc.id && sc?.id !== gc.id) warnings.push(`Only ${goes.name} is in a colony (${gc.name}). After merging, ${stays.name} will be in ${gc.name}.`);

  return {
    kind: "ok",
    screen: {
      sides: [sa, sb],
      stays,
      goes,
      canSwitch: limit === "" && block === null,
      limit,
      block,
      whatHappens: lines,
      warnings,
      expectedCounts: [stays.sightings, goes.sightings],
    },
  };
}
