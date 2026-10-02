/**
 * The welfare guidance file: the injured-cat advice, the vet list and the
 * Municipality's number, in one place (SYC-42 plan, Slice 0 item 0.2;
 * Decision 6, Samuel 1 Oct 2026).
 *
 * - The API serves it (`GET /api/welfare/guidance?lang=`), so a fix is a
 *   one-file change plus a republish: no store review.
 * - The app imports the same files, so a copy is built into the app and the
 *   advice shows with no signal, even on a first-ever offline open.
 * - The English urgent block (spec §5.3(b)) is locked: a test in
 *   artifacts/api-server/src/lib/welfareGuidance.test.ts pins its exact text
 *   (spec §5.4). Changing it goes back through Samuel.
 *
 * Plain data and pure functions only: this runs in Node and in React Native.
 */
import copyEn from "./data/copy.en.json";
import copyEl from "./data/copy.el.json";
import copyFr from "./data/copy.fr.json";
import vetsFile from "./data/vets.json";
import municipalityFile from "./data/municipality.json";

export const GUIDANCE_LANGUAGES = ["en", "el", "fr"] as const;

/**
 * The shape of the served file. The app ignores a served copy whose schema
 * it doesn't know and falls back to the copy built into it, so a future
 * shape change can't break the advice on an older app.
 */
export const GUIDANCE_SCHEMA_VERSION = 1 as const;
export type GuidanceLanguage = (typeof GUIDANCE_LANGUAGES)[number];

export type ReviewState = "final" | "draft" | "pending-native-check";

export type PhoneKind =
  | "clinic_hours"
  | "after_hours"
  | "landline"
  | "mobile"
  | "main"
  | "emergency";

export type Phone = { display: string; tel: string; kind: PhoneKind };

export type Clinic = {
  id: string;
  name: string;
  vet: string;
  area: string;
  landmark: Record<GuidanceLanguage, string>;
  address: string;
  phones: Phone[];
  coordinates: { lat: number; lng: number } | null;
  /** "landmark": pin on the petrol station opposite (≈100 m). "search": no pin, map search links. */
  pin: "landmark" | "search";
  googleMapsUrl: string;
  appleMapsUrl: string;
};

export type Municipality = {
  name: Record<GuidanceLanguage, string>;
  phone: { display: string; tel: string };
};

export type GuidanceCopy = {
  language: GuidanceLanguage;
  urgent: {
    review: ReviewState;
    locked?: string;
    intro: string;
    cage: string;
    vetListHeading: string;
    howToHeading: string;
    steps: string[];
    wontGoIn: string;
    vetDoes: string;
    cost: string;
    decision: string;
    municipality: string;
    /**
     * Last, always (Samuel, 1 Oct 2026): Syros Cats is a private sanctuary,
     * not an emergency service. Never the lead (spec §5.2).
     */
    capacity: string;
  };
  attention: { review: ReviewState; heading: string; paragraphs: string[] };
  litter: { review: ReviewState; heading: string; paragraphs: string[] };
  confirmation: {
    review: ReviewState;
    sentHeading: string;
    sentBody: string;
    next: string;
    hurt: string;
    offline: string;
  };
  vetList: {
    review: ReviewState;
    phoneKinds: Record<PhoneKind, string>;
    /**
     * Short labels for the compact vet cards on the "Before you send" screen
     * (Samuel, 2 Oct 2026: no scrolling). A '*' marks a number the clinic
     * publishes itself, explained once by `publishedNote`, so the cards still
     * promise nothing about who answers.
     */
    phoneKindsShort: Record<PhoneKind, string>;
    publishedNote: string;
    call: string;
    googleMaps: string;
    appleMaps: string;
    pinLandmark: string;
    pinSearch: string;
    municipalityHeading: string;
  };
};

export type WelfareGuidance = {
  schemaVersion: typeof GUIDANCE_SCHEMA_VERSION;
  version: string;
  language: GuidanceLanguage;
  copy: GuidanceCopy;
  vets: Clinic[];
  municipality: Municipality;
};

function stripSource<T extends object>(o: T): Omit<T, "_source"> {
  const { _source: _ignored, ...rest } = o as T & { _source?: unknown };
  return rest;
}

const COPY: Record<GuidanceLanguage, GuidanceCopy> = {
  en: stripSource(copyEn) as unknown as GuidanceCopy,
  el: stripSource(copyEl) as unknown as GuidanceCopy,
  fr: stripSource(copyFr) as unknown as GuidanceCopy,
};
const VETS = vetsFile.clinics as unknown as Clinic[];
const MUNICIPALITY = stripSource(municipalityFile) as unknown as Municipality;

/** FNV-1a, 32-bit: a cheap content hash that runs anywhere. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Keys sorted at every level, so the text is the same whatever the key order. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The content hash of the whole file (exported so a test can prove it moves). */
export function computeGuidanceVersion(
  copies: Record<GuidanceLanguage, GuidanceCopy>,
  vets: Clinic[],
  municipality: Municipality,
): string {
  return fnv1a(stableStringify([copies, vets, municipality]));
}

const VERSION = computeGuidanceVersion(COPY, VETS, MUNICIPALITY);

/** One version for the whole file: any change to any language bumps it. */
export function guidanceVersion(): string {
  return VERSION;
}

export function isGuidanceLanguage(value: unknown): value is GuidanceLanguage {
  return (
    typeof value === "string" &&
    (GUIDANCE_LANGUAGES as readonly string[]).includes(value)
  );
}

export function getGuidance(language: GuidanceLanguage): WelfareGuidance {
  return {
    schemaVersion: GUIDANCE_SCHEMA_VERSION,
    version: VERSION,
    language,
    copy: COPY[language],
    vets: VETS,
    municipality: MUNICIPALITY,
  };
}

const URGENT_ORDER = [
  "intro",
  "cage",
  "vetListHeading",
  "howToHeading",
  "steps",
  "wontGoIn",
  "vetDoes",
  "cost",
  "decision",
  "municipality",
  "capacity",
];

/**
 * The WHOLE urgent block as one string: what the lock test hashes (spec
 * §5.4). Every field is included, so adding one (say, an out-of-hours line)
 * changes it as surely as editing a word. The known fields come first in
 * reading order, so the text also reads top to bottom for the "cage before
 * handling" check; any other field follows, keys sorted. Only the notes about
 * the block (`review`, `locked`) are left out.
 */
export function urgentBlockCanonical(copy: GuidanceCopy): string {
  const u = copy.urgent as unknown as Record<string, unknown>;
  const keys = [
    ...URGENT_ORDER.filter((k) => k in u),
    ...Object.keys(u)
      .filter((k) => !URGENT_ORDER.includes(k) && k !== "review" && k !== "locked")
      .sort(),
  ];
  return keys
    .map((k) => {
      const v = u[k];
      const text = Array.isArray(v) ? v.map(String).join("\n") : typeof v === "string" ? v : stableStringify(v);
      return URGENT_ORDER.includes(k) ? text : `${k}=${text}`;
    })
    .join("\n");
}

/** Every user-facing string in a language's copy (for phrase checks). */
export function allCopyStrings(copy: GuidanceCopy): string[] {
  const out: string[] = [];
  const walk = (v: unknown, key: string) => {
    if (key === "review" || key === "locked" || key === "language") return;
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach((x) => walk(x, ""));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(copy, "");
  return out;
}

export function telHref(phone: { tel: string }): string {
  return `tel:${phone.tel}`;
}
