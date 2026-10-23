import type { TeamCatView, TeamStatement } from "../../teamCatView";

// Shared builders for the team cat page's tests (SYC-602): one statement, one
// cat, a well-evidenced cat and a bare one. Each is a fresh object, so a test
// may change it freely.

export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export const statement = (id: number, over: Partial<TeamStatement> = {}): TeamStatement => ({
  id,
  kind: "note",
  said: `Said ${id}`,
  reason: null,
  author: { kind: "team", label: "Maria" },
  observedAt: "2026-03-01T10:00:00Z",
  createdAt: "2026-03-01T10:00:00Z",
  asGuardian: false,
  replaces: null,
  replacedBy: [],
  movedTo: null,
  ownerClaim: false,
  movedFrom: null,
  photoUrl: null,
  sightingId: null,
  correction: null,
  ...over,
});

const isPlain = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** Objects merge key by key; arrays and everything else replace. */
function merge<T>(base: T, over: unknown): T {
  if (!isPlain(base) || !isPlain(over)) return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = v === undefined ? out[k] : merge(out[k], v);
  return out as T;
}

const resolvedNothing = {
  value: null,
  confidence: "unknown" as const,
  asOf: "2026-03-01T10:00:00Z",
  supportingStatementIds: [] as number[],
  conflictingStatementIds: [] as number[],
};

const noAppearance = {
  value: null,
  confidence: "unknown" as const,
  checkReasons: [],
  statements: [],
  guardianDecides: false,
  aboveTeamIds: [],
  guardianDisagrees: false,
};

/** A cat with next to nothing recorded: on the street, no colony, no sightings. */
export const bareCatView = (): TeamCatView => ({
  cat: {
    id: 7,
    syr: "SYR-0007",
    name: "Tiger",
    description: "",
    // Ermoupoli's harbour.
    lat: 37.4447,
    lng: 24.9418,
    createdAt: "2026-01-01T10:00:00Z",
    mainPhotoUrl: null,
  },
  owner: { has: false, orphanedHome: false, homeDescription: null, homePin: null },
  colony: null,
  publicStatus: {
    hasHome: false,
    lifeStatus: "street",
    notSeenSince: null,
    sterilised: { value: null, confidence: "unknown", clippedTipSightings: 0 },
    coat: [],
    coatColours: [],
    coatPattern: null,
    markings: [],
  },
  records: {
    lifeStatus: { ...resolvedNothing, value: "street", presumedDeceased: false, notSeenSince: null },
    sterilised: { ...resolvedNothing, clippedTipSightings: 0 },
    vaccinations: [],
  },
  appearance: { coat: { ...noAppearance }, markings: { ...noAppearance }, handPick: false },
  sightings: [],
  photos: [],
  history: [],
  recentGuardianMark: null,
});

/** A bare cat with some of it changed: objects merge, arrays replace. */
export const catView = (over: DeepPartial<TeamCatView> = {}): TeamCatView => merge(bareCatView(), over);

/**
 * A cat the team knows well: sterilised (confirmed by Maria, statement 298), a
 * team member says it lives on the street (301), in a colony, a rabies
 * vaccination, and 21 sightings since April 2026.
 */
export function richCatView(): TeamCatView {
  const sightings = Array.from({ length: 21 }, (_, i) => ({
    id: 900 - i,
    lat: 37.4447,
    lng: 24.9418,
    // Newest first: 13 Oct 2026 back to 16 Apr 2026, nine days apart.
    at: new Date(Date.UTC(2026, 9, 13, 8) - i * 9 * 86_400_000).toISOString(),
    photoUrl: null,
    extraPhotos: [],
    mixedCats: false,
  }));
  return catView({
    cat: { description: "Grey tabby with white paws, often by the harbour steps." },
    colony: { id: 4, name: "Vaporia steps", wasName: null },
    records: {
      lifeStatus: {
        value: "street",
        confidence: "confirmed",
        asOf: "2026-10-14T09:00:00Z",
        supportingStatementIds: [301],
      },
      sterilised: {
        value: true,
        confidence: "confirmed",
        asOf: "2026-08-13T09:00:00Z",
        supportingStatementIds: [298],
        clippedTipSightings: 3,
      },
      vaccinations: [{ observationId: 1, date: "2026-08-13T00:00:00Z", vaccines: ["rabies"], clinic: null }],
    },
    sightings,
    history: [
      statement(301, {
        kind: "life_status",
        said: "Lives on the street",
        createdAt: "2026-10-14T09:00:00Z",
        observedAt: "2026-10-14T09:00:00Z",
      }),
      statement(298, {
        kind: "sterilised",
        said: "Sterilised at Syros Vet",
        createdAt: "2026-08-13T09:00:00Z",
        observedAt: "2026-08-13T09:00:00Z",
      }),
    ],
  });
}
