import { haversineKm } from "../catHelpers";

// Named areas (spec §3.3): each has one centre, and a place belongs to the
// area whose centre is nearest. More than MAX_KM from every centre is
// "Off Syros". Bump AREAS_VERSION whenever the list changes.

export interface NamedArea {
  key: string;
  name: string;
  lat: number;
  lng: number;
}
export const AREAS_VERSION = 1;
export const OFF_SYROS = { key: "off", name: "Off Syros" } as const;
const MAX_KM = 2;

export const NAMED_AREAS: readonly NamedArea[] = [
  // The first 7 are copied exactly from lib/mapTiles/areas.ts (checked 15 Oct 2026).
  { key: "ermoupoli", name: "Ermoupoli", lat: 37.4447, lng: 24.9417 },
  { key: "vaporia", name: "Vaporia", lat: 37.4447, lng: 24.9475 },
  { key: "kini", name: "Kini", lat: 37.4436, lng: 24.8889 },
  { key: "galissas", name: "Galissas", lat: 37.4226, lng: 24.8825 },
  { key: "finikas", name: "Finikas", lat: 37.3976, lng: 24.8783 },
  { key: "posidonia", name: "Posidonia", lat: 37.3889, lng: 24.8874 },
  { key: "azolimnos", name: "Azolimnos", lat: 37.4105, lng: 24.9594 },
  // Added villages: centres are the OpenStreetMap place nodes, looked up
  // through Nominatim on 15 Oct 2026 (never typed from memory).
  { key: "ano-syros", name: "Ano Syros", lat: 37.4501993, lng: 24.9357722 }, // OSM node 1844864373 (place=town)
  { key: "vari", name: "Vari", lat: 37.3983488, lng: 24.9467109 }, // OSM node 1846917012 (place=village)
  { key: "fabrika", name: "Fabrika", lat: 37.3919149, lng: 24.9528053 }, // OSM node 2684088129 (place=locality)
  { key: "manna", name: "Manna", lat: 37.4196393, lng: 24.947383 }, // OSM node 1846917017 (place=village)
  // Found under their Greek spellings (Χρούσα, Μέγας Γιαλός), checked 15 Oct 2026.
  { key: "mega-gialos", name: "Mega Gialos", lat: 37.3809687, lng: 24.9109853 }, // OSM node 2684084813 (place=village)
  { key: "chroussa", name: "Chroussa", lat: 37.4022955, lng: 24.9193522 }, // OSM node 1846917030 (place=village)
];

export function areaFor(lat: number, lng: number): NamedArea | typeof OFF_SYROS {
  let best: NamedArea | null = null;
  let bestKm = Infinity;
  for (const a of NAMED_AREAS) {
    const km = haversineKm(lat, lng, a.lat, a.lng);
    if (km < bestKm) {
      best = a;
      bestKm = km;
    }
  }
  return best !== null && bestKm <= MAX_KM ? best : OFF_SYROS;
}

export const areaByKey = (key: unknown): NamedArea | undefined =>
  typeof key === "string" ? NAMED_AREAS.find((a) => a.key === key) : undefined;
