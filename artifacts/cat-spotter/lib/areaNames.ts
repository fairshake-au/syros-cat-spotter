/**
 * SYC-810: the named area on a cat, as the app shows it. Pure.
 *
 * The server sends `areaKey` and `areaName` (worked out from the cat's
 * published cell centre, never its exact spot or home pin). English and
 * French show `areaName` as the team wrote it. Greek needs Greek script and
 * the database has no Greek column, so the names are held here by area key.
 * A key not on the list (an area the team adds later) falls back to the
 * server's name.
 */
import type { Language } from './i18n';

/**
 * DRAFT, and a stub: Greek names by area key, for the 21 seed areas
 * (artifacts/api-server/src/lib/areas/seedAreas.ts). Syros Cats or a Greek
 * speaker must check these before launch. Until they are written, each value
 * is the server's English name, except Kini.
 */
// TODO(session): Greek names
export const GREEK_AREA_NAMES: Readonly<Record<string, string>> = {
  ermoupoli: 'Ermoupoli',
  vaporia: 'Vaporia',
  kini: 'Κίνι',
  galissas: 'Galissas',
  finikas: 'Finikas',
  posidonia: 'Posidonia',
  azolimnos: 'Azolimnos',
  'ano-syros': 'Ano Syros',
  vari: 'Vari',
  fabrika: 'Fabrika',
  manna: 'Manna',
  'mega-gialos': 'Mega Gialos',
  chroussa: 'Chroussa',
  kampos: 'Kampos',
  chalandriani: 'Chalandriani',
  syringas: 'Syringas',
  aetos: 'Aetos',
  lia: 'Lia',
  grammata: 'Grammata',
  pagos: 'Pagos',
  episkopio: 'Episkopio',
};

/** The same numbers as SYROS_BOX in api-server/src/lib/areas/areaWrites.ts: where an area centre may be. */
const SYROS_BOX = { latMin: 37.36, latMax: 37.52, lngMin: 24.86, lngMax: 24.99 } as const;

export interface CatArea {
  areaKey?: string | null;
  areaName?: string | null;
}

/** The name to show for a cat's area, or null when it has none. */
export function areaLabel(cat: CatArea, lang: Language): string | null {
  if (typeof cat.areaKey === 'string' && lang === 'el') {
    const greek = Object.prototype.hasOwnProperty.call(GREEK_AREA_NAMES, cat.areaKey)
      ? GREEK_AREA_NAMES[cat.areaKey]
      : undefined;
    if (greek) return greek;
  }
  return typeof cat.areaName === 'string' && cat.areaName !== '' ? cat.areaName : null;
}

function onSyros(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= SYROS_BOX.latMin &&
    lat <= SYROS_BOX.latMax &&
    lng >= SYROS_BOX.lngMin &&
    lng <= SYROS_BOX.lngMax
  );
}

export type CardPlace =
  | { kind: 'area'; text: string }
  | { kind: 'island'; text: string }
  | { kind: 'none'; text: null };

/**
 * What a card's place row shows (spec 4.2). `none` keeps "Discovered by":
 * the cat is off the island, or it came from an old phone cache with no
 * `areaName` field at all (undefined, not null).
 */
export function cardPlace(
  cat: CatArea & { lat: number; lng: number },
  lang: Language,
  t: (key: string) => string,
): CardPlace {
  if (cat.areaName === undefined) return { kind: 'none', text: null };
  const label = areaLabel(cat, lang);
  if (label !== null) return { kind: 'area', text: label };
  if (onSyros(cat.lat, cat.lng)) return { kind: 'island', text: t('catAreaSomewhere') };
  return { kind: 'none', text: null };
}

/** What the Catalogue search looks at: the shown name and the server's name, so "Kini" and "Κίνι" both match in Greek. */
export function areaSearchText(cat: CatArea, lang: Language): string {
  const shown = areaLabel(cat, lang);
  const server = typeof cat.areaName === 'string' ? cat.areaName : '';
  return [shown, server]
    .filter((s): s is string => Boolean(s))
    .filter((s, i, all) => all.indexOf(s) === i)
    .join(' ');
}
