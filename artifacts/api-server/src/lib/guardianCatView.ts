import {
  catsTable,
  coloniesTable,
  db,
  photosTable,
  sightingsTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { deriveCatStatuses, toPublicDay } from "./catHelpers";
import { liveCats } from "./catIdentity";
import type { CoatColour, CoatPattern, LegacyPublicCode, Mark } from "./appearance";
import { hiddenPhotoIds } from "./photoVisibility";
import { loadCatRecords } from "./observations";
import {
  athensDay,
  resolveLifeStatus,
  resolveSterilised,
  standingRows,
  type Confidence,
  type LifeStatusValue,
} from "./resolve";
import { syrNumber, teamPhotoUrl } from "./teamCatView";

// What a cat guardian sees of a cat IN HER OWN COLONIES (roles-and-invites.md
// §2.2; SYC-53 plan, PR 2.1). **Its own serialiser, built from its own list
// of fields**, not the team's cat view with a filter on it: the team's view
// carries things she must never see, and leaving them out here doesn't depend
// on anyone remembering to filter them.
//
// The allow-list (spec §2.2, "She sees"):
//   - the cat's name, SYR number and the public description;
//   - its exact discovery position, and its colony;
//   - photos that are visible to the public, through the team photo route
//     (whose target is the photo's cat, so the route checks her again);
//   - the sterilisation answer and how sure we are;
//   - life status, and the day the cat was last seen;
//   - colour and markings, as the public sees them (the colours and pattern
//     the public wire carries; her page words them in the team's words,
//     SYC-443 T1A).
//
// Never here, by construction (there is no field for them): welfare reports
// and their notes, hidden photos or any photo sent privately, team members'
// names (edits show as "Syros Cats" once statements are shown, PR 2.2), who a
// spotter is, any owner details (whether it has one, a name, a home note or
// pin), the team's notes, sightings' positions and their times, statement
// history, conflicts and the ids of the statements behind an answer.
//
// The team's health-notes block (SYC-2, behind `view_health_notes`) is a
// SEPARATE block on her page and never passes through here.
//
// The colony's feeding sites join this view once SYC-209 PR 4.1's
// `sitesForPerson` is on main (filtered in its query to her colonies).
//
// **Callers check first.** Every cat passed in must already have passed
// can(person, "view_exact_location", catTarget(cat)) with the colony read
// from the record. A cat outside her colonies gets the public view instead
// (lib/publicCat.ts), never this one.

export interface GuardianCat {
  id: number;
  syr: string;
  name: string;
  /** SYC-677 D: left for spotters to name; `name` is then its SYR number. */
  namePending: boolean;
  description: string;
  /** Where the cat was first recorded: exact. */
  lat: number;
  lng: number;
  colony: { id: number; name: string } | null;
  /** The photo the public sees for the cat, through the team photo route. */
  mainPhotoUrl: string | null;
  /** Every public photo of the cat, once each (main, then sightings, newest first). */
  photoUrls: string[];
  sterilised: { value: boolean | null; confidence: Confidence };
  lifeStatus: LifeStatusValue | null;
  /** The day (Syros / Europe/Athens, YYYY-MM-DD) of the newest sighting, or null for none. */
  lastSeen: string | null;
  /** The old public codes, kept for now (SYC-443 plan, PR 2); her page no longer reads them. */
  coat: LegacyPublicCode[];
  /** The resolved colours (catHelpers status.coatColours); [] means not known. */
  coatColours: CoatColour[];
  /** The resolved pattern; null means not known. */
  coatPattern: CoatPattern | null;
  markings: Mark[];
  /**
   * Her cat's vet visits, newest first (dashboard §10.2; SYC-396 PR 3.1a):
   * the day (Syros, YYYY-MM-DD) and what was done, **never** "vaccinated",
   * the cost, who paid, the clinic or a note. Built from those two fields
   * alone, so nothing else can ride along.
   */
  vetVisits: GuardianVetVisit[];
}

export interface GuardianVetVisit {
  date: string;
  did: ("sterilised" | "treated" | "checked")[];
}

const GUARDIAN_DID: ReadonlySet<string> = new Set(["sterilised", "treated", "checked"]);

/** The visits a guardian may see of, from the cat's own rows (§10.2). */
function guardianVisits(observations: Parameters<typeof standingRows>[0]): GuardianVetVisit[] {
  return standingRows(observations, "vet_visit")
    .filter((o) => !o.redactedAt)
    .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime() || b.id - a.id)
    .map((o) => {
      const did = (o.value as { did?: unknown }).did;
      return {
        date: athensDay(o.observedAt),
        did: (Array.isArray(did) ? did : []).filter((d): d is GuardianVetVisit["did"][number] =>
          typeof d === "string" && GUARDIAN_DID.has(d),
        ),
      };
    });
}

/**
 * The guardian's view of each of these cats, in the order given; a cat that
 * doesn't exist is left out. A fixed number of queries whatever the count.
 */
export async function guardianCats(
  catIds: readonly number[],
  colonyOf: ReadonlyMap<number, number>,
  now = new Date(),
): Promise<GuardianCat[]> {
  const ids = [...new Set(catIds)];
  if (ids.length === 0) return [];
  const cats = await liveCats(
    {
      id: catsTable.id,
      name: catsTable.name,
      namePending: catsTable.namePending,
      description: catsTable.description,
      lat: catsTable.lat,
      lng: catsTable.lng,
      ownerDeviceId: catsTable.ownerDeviceId,
      primaryPhotoId: catsTable.primaryPhotoId,
    },
    { where: inArray(catsTable.id, ids) },
  );
  if (cats.length === 0) return [];

  const colonyIds = [...new Set(cats.map((c) => colonyOf.get(c.id)).filter((c): c is number => c !== undefined))];
  const [records, statuses, sightings, colonies] = await Promise.all([
    loadCatRecords(cats.map((c) => c.id)),
    deriveCatStatuses(cats.map((c) => ({ id: c.id, ownerDeviceId: c.ownerDeviceId }))),
    db
      .select({
        catId: sightingsTable.catId,
        createdAt: sightingsTable.createdAt,
        photoId: sightingsTable.photoId,
      })
      .from(sightingsTable)
      .where(
        and(
          inArray(sightingsTable.catId, cats.map((c) => c.id)),
          eq(sightingsTable.status, "resolved"),
        ),
      )
      .orderBy(desc(sightingsTable.createdAt), desc(sightingsTable.id)),
    colonyIds.length === 0
      ? Promise.resolve([] as { id: number; name: string }[])
      : db
          .select({ id: coloniesTable.id, name: coloniesTable.name })
          .from(coloniesTable)
          .where(inArray(coloniesTable.id, colonyIds)),
  ]);

  // Public photos only: the main photo and the resolved sightings' photos,
  // minus every one the team has hidden. Statement photos (an ear-tip
  // close-up, a report's photo) are never public, so never here.
  const photoIds = [
    ...new Set([
      ...cats.map((c) => c.primaryPhotoId),
      ...sightings.map((s) => s.photoId),
    ].filter((id): id is number => typeof id === "number" && id > 0)),
  ];
  const [photoRows, hidden] = await Promise.all([
    photoIds.length === 0
      ? Promise.resolve([] as { id: number; publicId: string }[])
      : db
          .select({ id: photosTable.id, publicId: photosTable.publicId })
          .from(photosTable)
          .where(inArray(photosTable.id, photoIds)),
    hiddenPhotoIds(photoIds),
  ]);
  const publicIdOf = new Map(photoRows.map((p) => [p.id, p.publicId]));
  const urlFor = (photoId: number | null | undefined): string | null => {
    if (photoId == null || hidden.has(photoId)) return null;
    const publicId = publicIdOf.get(photoId);
    return publicId ? teamPhotoUrl(publicId) : null;
  };
  const colonyName = new Map(colonies.map((c) => [c.id, c.name]));

  const byId = new Map(cats.map((c) => [c.id, c]));
  const out: GuardianCat[] = [];
  for (const id of ids) {
    const cat = byId.get(id);
    if (!cat) continue;
    const rec = records.get(id);
    const observations = rec?.observations ?? [];
    const own = sightings.filter((s) => s.catId === id);
    // The resolver's own answer, not the public line: spec §2.2 gives her
    // "how sure we are", so she sees *Probably sterilised* even if the
    // public Likely gate (likelyGate.ts) is ever shut. A choice, written
    // down (PR 2.1 review, nit 6).
    const sterilised = resolveSterilised(observations, []);
    const life = resolveLifeStatus(observations, rec?.evidenceOfLife ?? null, now);
    const status = statuses.get(id);
    const mainPhotoUrl = urlFor(cat.primaryPhotoId);
    const photoUrls = [
      ...new Set(
        [mainPhotoUrl, ...own.map((s) => urlFor(s.photoId))].filter(
          (u): u is string => u !== null,
        ),
      ),
    ];
    const colonyId = colonyOf.get(id);
    const name = colonyId !== undefined ? colonyName.get(colonyId) : undefined;
    // Built field by field, never by spreading a row, so a new column can't ride along.
    out.push({
      id: cat.id,
      syr: syrNumber(cat.id),
      name: cat.name,
      namePending: cat.namePending,
      description: cat.description,
      lat: cat.lat,
      lng: cat.lng,
      colony: colonyId !== undefined && name !== undefined ? { id: colonyId, name } : null,
      mainPhotoUrl: mainPhotoUrl ?? photoUrls[0] ?? null,
      photoUrls,
      sterilised: { value: sterilised.value, confidence: sterilised.confidence },
      lifeStatus: life.value,
      lastSeen: own[0] ? toPublicDay(own[0].createdAt) : null,
      coat: status ? [...status.coat] : [],
      coatColours: status ? [...status.coatColours] : [],
      coatPattern: status?.coatPattern ?? null,
      markings: status ? [...status.markings] : [],
      vetVisits: guardianVisits(observations),
    });
  }
  return out;
}

/** One cat's guardian view, or null for no such cat. */
export async function guardianCatView(
  catId: number,
  colonyId: number,
  now = new Date(),
): Promise<GuardianCat | null> {
  const [cat] = await guardianCats([catId], new Map([[catId, colonyId]]), now);
  return cat ?? null;
}

/** The exact list of fields a guardian's cat carries (T4 pins it). */
export const GUARDIAN_CAT_FIELDS = [
  "id",
  "syr",
  "name",
  "namePending",
  "description",
  "lat",
  "lng",
  "colony",
  "mainPhotoUrl",
  "photoUrls",
  "sterilised",
  "lifeStatus",
  "lastSeen",
  "coat",
  "coatColours",
  "coatPattern",
  "markings",
  "vetVisits",
] as const satisfies readonly (keyof GuardianCat)[];
