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
    send: string;
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
    call: string;
    googleMaps: string;
    appleMaps: string;
    pinLandmark: string;
    pinSearch: string;
    municipalityHeading: string;
  };
};

export type WelfareGuidance = {
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

const VERSION = fnv1a(JSON.stringify([COPY, VETS, MUNICIPALITY]));

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
    version: VERSION,
    language,
    copy: COPY[language],
    vets: VETS,
    municipality: MUNICIPALITY,
  };
}

/**
 * The urgent block's words, in reading order, as one string: what the lock
 * test hashes (spec §5.4). Metadata (`review`, `locked`) is excluded so that a
 * note about the block never trips the lock; the words do.
 */
export function urgentBlockCanonical(copy: GuidanceCopy): string {
  const u = copy.urgent;
  return [
    u.send,
    u.intro,
    u.cage,
    u.vetListHeading,
    u.howToHeading,
    ...u.steps,
    u.wontGoIn,
    u.vetDoes,
    u.cost,
    u.decision,
    u.municipality,
  ].join("\n");
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
