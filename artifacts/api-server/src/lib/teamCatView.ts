import {
  catsTable,
  db,
  foldName,
  isPersonId,
  peopleTable,
  photosTable,
  sightingsTable,
  type Observation,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { deriveCatStatuses, type DerivedCatStatus } from "./catHelpers";
import { loadCatRecords } from "./observations";
import {
  clippedTipCount,
  resolveLifeStatus,
  resolveSterilised,
  type Confidence,
  type LifeStatusValue,
} from "./resolve";

// The staff dashboard's view of a cat (SYC-43 part 2 plan, PR 3): finding a
// cat, and the team's cat page. Read-only.
//
// **Team payloads never go through the public serialiser**, and the public
// cat routes never come through here. This file builds the team's own shape:
// exact positions, every photo through the team photo route, and the full
// statement history with who said what. When data spine PR 6 adds
// `serialiseCat(cat, viewer)`, this becomes its `team` viewer. Every caller
// sits behind requireTeam("view_exact_location").
//
// Never in this shape: a device id, a raw account id, or a public photo
// address. Authors are labels ("a spotter", a team member's name), and
// photos are /api/team/photos/<publicId> only.

const teamPhotoUrl = (publicId: string) =>
  `/api/team/photos/${encodeURIComponent(publicId)}`;

/** SYR-0012 for cat 12: the number the app and the team use (cat/[id].tsx). */
export const syrNumber = (id: number) => `SYR-${String(id).padStart(4, "0")}`;

// ── Who said it ────────────────────────────────────────────────────────────

export type AuthorKind =
  | "spotter"
  | "team"
  | "system"
  | "deleted"
  | "unknown";

export interface TeamAuthor {
  kind: AuthorKind;
  /** What the page shows: "a spotter", "Maria (left)", "imported"… */
  label: string;
}

/**
 * Labels for the app's own authors (`SYSTEM_AUTHORS` in observations.ts). A
 * `system:` author not listed here is still shown as "imported" rather than
 * by its raw name.
 */
const SYSTEM_LABELS: Record<string, string> = {
  "system:legacy-backfill": "imported",
  "system:admin-route": "imported from the old admin tool",
  "system:vision": "read automatically from the photo",
  "system:welfare-report": "a welfare report",
};

interface PersonName {
  name: string;
  left: boolean;
}

function authorOf(o: Observation, people: Map<string, PersonName>): TeamAuthor {
  if (o.redactedAt)
    return { kind: "deleted", label: "someone who has since deleted their details" };
  // A device is always a member of the public: never shown by its id.
  if (o.deviceId) return { kind: "spotter", label: "a spotter" };
  const account = o.accountId ?? "";
  if (account.startsWith("system:"))
    return { kind: "system", label: SYSTEM_LABELS[account] ?? "imported" };
  const person = people.get(account);
  if (person)
    return {
      kind: "team",
      label: person.left ? `${person.name} (left)` : person.name,
    };
  return { kind: "unknown", label: "someone no longer on the team list" };
}

// ── What was said ──────────────────────────────────────────────────────────

const LIFE: Record<LifeStatusValue, string> = {
  street: "Lives on the street",
  homed: "Has a home",
  in_care: "In care",
  deceased: "Has died",
};

const SEVERITY: Record<string, string> = {
  urgent: "urgent",
  attention: "needs attention",
};

const COAT: Record<string, string> = {
  black: "black",
  white: "white",
  ginger: "ginger",
  grey: "grey",
  tabby: "tabby",
  tortoiseshell_or_calico: "tortoiseshell or calico",
  black_and_white: "black and white",
  not_sure: "not sure",
};

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

/** A statement in plain English. Never includes the reason (shown apart). */
export function describeStatement(kind: string, raw: unknown): string {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  switch (kind) {
    case "life_status":
      return LIFE[v["status"] as LifeStatusValue] ?? "Life status (unreadable)";
    case "sterilised": {
      const base =
        v["sterilised"] === true
          ? "Sterilised"
          : v["sterilised"] === false
            ? "Not sterilised"
            : "Sterilisation (unreadable)";
      const extra = [str(v["date"]), str(v["clinic"])].filter(Boolean);
      return extra.length ? `${base} (${extra.join(", ")})` : base;
    }
    case "ear_tip": {
      if (v["clipped"] === true) {
        const side = v["side"] === "left" || v["side"] === "right" ? `, ${v["side"]} ear` : "";
        return `Ear tip clipped${side}`;
      }
      if (v["clipped"] === false) return "Ear tip not clipped";
      return "Couldn't tell whether the ear is clipped";
    }
    case "food_and_water":
      return v["present"] === true
        ? "Food and water were out"
        : v["present"] === false
          ? "No food or water"
          : "Couldn't tell about food and water";
    case "note":
      return str(v["text"]) ? `Note: “${v["text"] as string}”` : "Note (text removed)";
    case "name":
      return str(v["name"]) ? `Named “${v["name"] as string}”` : "Named";
    case "colony":
      return typeof v["colonyId"] === "number"
        ? `Put in colony ${v["colonyId"]}`
        : "Colony";
    case "welfare_report":
      return `Welfare report: ${SEVERITY[v["severity"] as string] ?? "unknown severity"}${v["isLitter"] === true ? ", kittens" : ""}`;
    case "welfare_outcome":
      return v["state"] === "done"
        ? "Welfare report closed: done"
        : "Welfare report closed: nothing needed";
    case "coat": {
      const colours = Array.isArray(v["colours"]) ? (v["colours"] as unknown[]) : [];
      return `Coat: ${colours.map((c) => COAT[c as string] ?? "unknown").join(" and ") || "unknown"}`;
    }
    default:
      return `A “${kind}” statement`;
  }
}

/**
 * The reason given. A correction's reason is its `supersedeReason`; a fresh
 * team statement carries its reason inside its value (routes/observations.ts).
 */
function reasonOf(o: Observation): string | null {
  if (o.supersedesId != null && str(o.supersedeReason)) return o.supersedeReason;
  const v = o.value as Record<string, unknown> | null;
  return v && typeof v === "object" ? str(v["reason"]) : null;
}

// ── The shape ──────────────────────────────────────────────────────────────

export interface TeamStatement {
  id: number;
  kind: string;
  said: string;
  reason: string | null;
  author: TeamAuthor;
  /** When it was true (ISO). */
  observedAt: string;
  /** When it was recorded (ISO). */
  createdAt: string;
  /** The statement this one corrects, if any. */
  replaces: number | null;
  /** Statements that correct this one. Empty while it stands. */
  replacedBy: number[];
  photoUrl: string | null;
}

export interface TeamResolved<T> {
  value: T | null;
  confidence: Confidence;
  asOf: string;
  supportingStatementIds: number[];
  conflictingStatementIds: number[];
}

export interface TeamCatView {
  cat: {
    id: number;
    syr: string;
    name: string;
    description: string;
    /** Where the cat was first recorded: exact. */
    lat: number;
    lng: number;
    createdAt: string;
    mainPhotoUrl: string | null;
  };
  /** Exactly what the public cat page says (catHelpers.deriveCatStatuses). */
  publicStatus: DerivedCatStatus;
  /** The team-only detail behind it, straight from the resolver. */
  records: {
    lifeStatus: TeamResolved<LifeStatusValue> & {
      presumedDeceased: boolean;
      notSeenSince: string | null;
    };
    sterilised: TeamResolved<boolean> & { clippedTipSightings: number };
  };
  /** Every resolved sighting, newest first, at its exact position. */
  sightings: { id: number; lat: number; lng: number; at: string; photoUrl: string | null }[];
  /** Every photo of the cat, once each: main, then sightings, then statements. */
  photos: { url: string; source: "main" | "sighting" | "statement" }[];
  /** Every statement, newest first. Replaced ones stay, with what replaced them. */
  history: TeamStatement[];
}

async function peopleNames(observations: readonly Observation[]) {
  const ids = [
    ...new Set(
      observations.map((o) => o.accountId).filter((a): a is string => isPersonId(a)),
    ),
  ];
  const names = new Map<string, PersonName>();
  if (ids.length === 0) return names;
  // Read the list directly: findPersonById refuses a person who has left,
  // and this page must still name them, with "(left)".
  const rows = await db
    .select({ id: peopleTable.id, name: peopleTable.name, leftAt: peopleTable.leftAt })
    .from(peopleTable)
    .where(inArray(peopleTable.id, ids));
  for (const r of rows) names.set(r.id, { name: r.name, left: r.leftAt !== null });
  return names;
}

async function photoPublicIds(ids: readonly number[]): Promise<Map<number, string>> {
  const unique = [...new Set(ids)];
  const out = new Map<number, string>();
  if (unique.length === 0) return out;
  const rows = await db
    .select({ id: photosTable.id, publicId: photosTable.publicId })
    .from(photosTable)
    .where(inArray(photosTable.id, unique));
  for (const r of rows) out.set(r.id, r.publicId);
  return out;
}

/** The team's view of one cat, or null if there is no such cat. */
export async function teamCatView(catId: number, now = new Date()): Promise<TeamCatView | null> {
  const [cat] = await db.select().from(catsTable).where(eq(catsTable.id, catId));
  if (!cat) return null;

  const [records, statuses, sightings] = await Promise.all([
    loadCatRecords([cat.id]),
    deriveCatStatuses([{ id: cat.id, ownerDeviceId: cat.ownerDeviceId }]),
    db
      .select({
        id: sightingsTable.id,
        lat: sightingsTable.lat,
        lng: sightingsTable.lng,
        createdAt: sightingsTable.createdAt,
        photoId: sightingsTable.photoId,
      })
      .from(sightingsTable)
      .where(and(eq(sightingsTable.catId, cat.id), eq(sightingsTable.status, "resolved")))
      .orderBy(desc(sightingsTable.createdAt), desc(sightingsTable.id)),
  ]);
  const rec = records.get(cat.id);
  const observations = rec?.observations ?? [];
  const evidence = rec?.evidenceOfLife ?? null;

  const [people, photoIds] = await Promise.all([
    peopleNames(observations),
    photoPublicIds([
      cat.primaryPhotoId,
      ...sightings.map((s) => s.photoId),
      ...observations.map((o) => o.photoId).filter((p): p is number => p != null),
    ]),
  ]);
  const urlFor = (photoId: number | null) => {
    const publicId = photoId == null ? undefined : photoIds.get(photoId);
    return publicId ? teamPhotoUrl(publicId) : null;
  };

  const life = resolveLifeStatus(observations, evidence, now);
  const sterilised = resolveSterilised(observations, []);

  const replacedBy = new Map<number, number[]>();
  for (const o of observations) {
    if (o.supersedesId == null) continue;
    replacedBy.set(o.supersedesId, [...(replacedBy.get(o.supersedesId) ?? []), o.id]);
  }
  const history: TeamStatement[] = [...observations]
    .sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id,
    )
    .map((o) => ({
      id: o.id,
      kind: o.kind,
      said: describeStatement(o.kind, o.value),
      reason: reasonOf(o),
      author: authorOf(o, people),
      observedAt: o.observedAt.toISOString(),
      createdAt: o.createdAt.toISOString(),
      replaces: o.supersedesId ?? null,
      replacedBy: replacedBy.get(o.id) ?? [],
      photoUrl: urlFor(o.photoId),
    }));

  const photos: TeamCatView["photos"] = [];
  const seen = new Set<string>();
  const addPhoto = (url: string | null, source: TeamCatView["photos"][number]["source"]) => {
    if (url && !seen.has(url)) {
      seen.add(url);
      photos.push({ url, source });
    }
  };
  addPhoto(urlFor(cat.primaryPhotoId), "main");
  for (const s of sightings) addPhoto(urlFor(s.photoId), "sighting");
  for (const h of history) addPhoto(h.photoUrl, "statement");

  return {
    cat: {
      id: cat.id,
      syr: syrNumber(cat.id),
      name: cat.name,
      description: cat.description,
      lat: cat.lat,
      lng: cat.lng,
      createdAt: cat.createdAt.toISOString(),
      mainPhotoUrl: urlFor(cat.primaryPhotoId),
    },
    publicStatus: statuses.get(cat.id)!,
    records: {
      lifeStatus: {
        value: life.value,
        confidence: life.confidence,
        asOf: life.asOf,
        supportingStatementIds: life.supportingObservationIds,
        conflictingStatementIds: life.conflicts,
        presumedDeceased: life.presumedDeceased,
        notSeenSince: life.notSeenSince,
      },
      sterilised: {
        value: sterilised.value,
        confidence: sterilised.confidence,
        asOf: sterilised.asOf,
        supportingStatementIds: sterilised.supportingObservationIds,
        conflictingStatementIds: sterilised.conflicts,
        clippedTipSightings: clippedTipCount(observations),
      },
    },
    sightings: sightings.map((s) => ({
      id: s.id,
      lat: s.lat,
      lng: s.lng,
      at: s.createdAt.toISOString(),
      photoUrl: urlFor(s.photoId),
    })),
    photos,
    history,
  };
}

// ── Finding a cat ──────────────────────────────────────────────────────────

export const SEARCH_LIMIT = 30;
export const QUERY_MAX = 100;

export interface TeamCatSearchResult {
  id: number;
  syr: string;
  name: string;
  thumbnailUrl: string | null;
  status: DerivedCatStatus;
}

/** "SYR-0012", "syr 12", "SYR12" or "12": cat 12. */
const SYR_RE = /^(?:syr)?[\s-]*0*(\d{1,9})$/i;

/**
 * Cats whose name matches `q` on the folded form (foldName: case, accents,
 * final sigma, invisible characters, spacing; not Greek/Latin look-alikes,
 * DECISIONS.md Part 2j), or whose SYR number is `q`. Best matches first: the
 * SYR number, then the whole name, then names starting with it, then names
 * containing it. At most 30.
 *
 * The names are folded here rather than in SQL: Postgres has no foldName, and
 * there is no folded-name column until SYC-101 adds one. The catalogue is a
 * few hundred cats, so reading every name is one small query. SYC-101's
 * column moves this into an index.
 */
export async function searchTeamCats(rawQuery: string): Promise<TeamCatSearchResult[]> {
  const q = foldName(rawQuery.slice(0, QUERY_MAX));
  if (q === "") return [];
  const syr = SYR_RE.exec(q);
  const syrId = syr ? Number(syr[1]) : null;

  const all = await db
    .select({
      id: catsTable.id,
      name: catsTable.name,
      ownerDeviceId: catsTable.ownerDeviceId,
      photoPublicId: photosTable.publicId,
    })
    .from(catsTable)
    .leftJoin(photosTable, eq(photosTable.id, catsTable.primaryPhotoId));

  const rank = (c: (typeof all)[number]): number => {
    if (c.id === syrId) return 0;
    const name = foldName(c.name);
    if (name === q) return 1;
    if (name.startsWith(q)) return 2;
    if (name.includes(q)) return 3;
    return -1;
  };
  const found = all
    .map((c) => ({ c, r: rank(c) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.c.name.localeCompare(b.c.name, "el") || a.c.id - b.c.id)
    .slice(0, SEARCH_LIMIT)
    .map((x) => x.c);

  const statuses = await deriveCatStatuses(found);
  return found.map((c) => ({
    id: c.id,
    syr: syrNumber(c.id),
    name: c.name,
    thumbnailUrl: c.photoPublicId ? teamPhotoUrl(c.photoPublicId) : null,
    status: statuses.get(c.id)!,
  }));
}
