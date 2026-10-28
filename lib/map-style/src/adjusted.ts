import {
  layers as protomapsLayers,
  namedFlavor,
} from '@protomaps/basemaps';
import type { ExpressionSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';

export type MapLang = 'en' | 'el';

/**
 * Protomaps layers whose text-field we replace with a single-line
 * name:<lang> -> name expression (street, landmark, beach and water labels).
 * Town labels (places_*) keep Protomaps' own two-line text-field.
 */
export const OVERRIDDEN_LABEL_LAYER_IDS = [
  'water_waterway_label',
  'roads_labels_minor',
  'water_label_ocean',
  'water_label_lakes',
  'roads_labels_major',
  'pois',
] as const;

/** Protomaps place layers; their text-field is taken from Protomaps per lang. */
export const PLACE_LABEL_LAYER_IDS = [
  'places_subplace',
  'places_region',
  'places_locality',
  'places_country',
  'earth_label_islands',
] as const;

/** Our own name-bearing layers added before pois. */
export const EXTRA_LABEL_LAYER_IDS = ['church', 'peak', 'beach_name'] as const;

/** Layers that keep Protomaps' own text/icon alignment settings. */
const KEEP_ALIGNMENT_LAYER_IDS = ['roads_shields', 'roads_oneway'];

export function nameExpression(lang: MapLang): ExpressionSpecification {
  return ['coalesce', ['get', `name:${lang}`], ['get', 'name']];
}

// Ported from docs/specs/source/map-labels-style-prototype.html adjusted().
const flavor = {
  ...namedFlavor('light'),
  background: '#aad3df', earth: '#f2efe9', water: '#aad3df',
  park_a: '#c8facc', park_b: '#c8facc', wood_a: '#add19e', wood_b: '#add19e',
  scrub_a: '#c8d7ab', scrub_b: '#c8d7ab',
  beach: '#fff1ba', sand: '#f5e9c6', school: '#ffffe5', hospital: '#ffffe5', pedestrian: '#dddde8',
  buildings: '#d9d0c9',
  minor_a: '#ffffff', minor_b: '#ffffff', minor_service: '#ffffff', other: '#f7f7f7',
  minor_casing: '#c8c0b6', minor_service_casing: '#d4ccc2',
  link: '#fcd6a4', major: '#fcd6a4', highway: '#f9b29c',
  major_casing_early: '#c79d6a', major_casing_late: '#c79d6a',
  highway_casing_early: '#c27a63', highway_casing_late: '#c27a63', link_casing: '#c79d6a',
  roads_label_minor: '#333333', roads_label_major: '#333333',
  city_label: '#222222', subplace_label: '#444444',
};

function extraLayers(lang: MapLang): LayerSpecification[] {
  const nameExpr = nameExpression(lang);
  return [
    {
      id: 'church', type: 'symbol', source: 'protomaps', 'source-layer': 'pois', minzoom: 14,
      filter: ['==', ['get', 'kind'], 'place_of_worship'],
      layout: {
        'text-field': ['step', ['zoom'],
          ['format', '†', { 'font-scale': 1.6 }],
          16, ['format', '†', { 'font-scale': 1.6 }, '\n', {}, nameExpr, { 'font-scale': 0.8 }]],
        'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-allow-overlap': false,
      },
      paint: { 'text-color': '#333', 'text-halo-color': '#f2efe9', 'text-halo-width': 1.5 },
    },
    {
      id: 'peak', type: 'symbol', source: 'protomaps', 'source-layer': 'pois', minzoom: 12,
      filter: ['==', ['get', 'kind'], 'peak'],
      layout: {
        'text-field': ['format',
          '▲', { 'font-scale': 0.8, 'text-color': '#9c6b3b' }, '\n', {},
          nameExpr, { 'font-scale': 0.85 }, '\n', {},
          ['case', ['has', 'elevation'], ['concat', ['to-string', ['get', 'elevation']], ' m'], ''],
          { 'font-scale': 0.75 }],
        'text-font': ['Noto Sans Regular'], 'text-size': 12,
      },
      paint: { 'text-color': '#7a5a3a', 'text-halo-color': '#f2efe9', 'text-halo-width': 1.5 },
    },
    {
      id: 'beach_name', type: 'symbol', source: 'protomaps', 'source-layer': 'pois', minzoom: 13,
      filter: ['==', ['get', 'kind'], 'beach'],
      layout: { 'text-field': nameExpr, 'text-font': ['Noto Sans Italic'], 'text-size': 12 },
      paint: { 'text-color': '#8a6d1f', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
    },
  ];
}

const pathsLayer: LayerSpecification = {
  id: 'paths', type: 'line', source: 'protomaps', 'source-layer': 'roads', minzoom: 14,
  filter: ['any',
    ['==', ['get', 'kind'], 'path'],
    ['==', ['get', 'kind_detail'], 'track']],
  layout: { 'line-cap': 'butt', 'line-join': 'round' },
  // Fainter and thinner when zoomed out so footpaths don't crowd the streets (SYC-720).
  paint: {
    'line-color': '#fa8072',
    'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 16, 1, 18, 1.6],
    'line-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.15, 15, 0.4, 16.5, 0.85],
    'line-dasharray': [1, 2],
  },
};

// Only real main roads are orange; other "major road" kinds stay white (SYC-720).
const MAIN_ROAD: ExpressionSpecification =
  ['match', ['get', 'kind_detail'], ['primary', 'secondary', 'trunk', 'motorway'], true, false];
const MAIN_FILL: ExpressionSpecification = ['case', MAIN_ROAD, '#fcd6a4', '#ffffff'];
const MAIN_CASING: ExpressionSpecification = ['case', MAIN_ROAD, '#c79d6a', '#c8c0b6'];
const QUIET_LINE_COLORS: Record<string, ExpressionSpecification> = {
  roads_major: MAIN_FILL,
  roads_bridges_major: MAIN_FILL,
  roads_major_casing_early: MAIN_CASING,
  roads_major_casing_late: MAIN_CASING,
  roads_bridges_major_casing: MAIN_CASING,
};

function textFieldOf(l: LayerSpecification | undefined): ExpressionSpecification | undefined {
  return (l?.layout as Record<string, unknown> | undefined)?.['text-field'] as ExpressionSpecification | undefined;
}

/**
 * Text-fields we keep from Protomaps for a language (two-line towns, island
 * names) plus our own extra layers (church, peak, beach_name).
 */
export function otherNameTextFields(lang: MapLang) {
  const all = [
    ...(protomapsLayers('protomaps', flavor, { lang }) as LayerSpecification[]),
    ...extraLayers(lang),
  ];
  return [...PLACE_LABEL_LAYER_IDS, ...EXTRA_LABEL_LAYER_IDS]
    .map((layerId) => ({ layerId: layerId as string, textField: textFieldOf(all.find((x) => x.id === layerId)) }))
    .filter((f): f is { layerId: string; textField: ExpressionSpecification } => f.textField !== undefined);
}

export function adjustedLayers(lang: MapLang): LayerSpecification[] {
  const layers = (protomapsLayers('protomaps', flavor, { lang }) as LayerSpecification[]).map((l) => {
    const quiet = QUIET_LINE_COLORS[l.id];
    if (quiet) return { ...l, paint: { ...l.paint, 'line-color': quiet } } as LayerSpecification;
    if (l.id === 'pois') {
      // Beaches and peaks are labelled by our own beach_name / peak layers only.
      const notOurs: ExpressionSpecification = ['!', ['in', ['get', 'kind'], ['literal', ['beach', 'peak']]]];
      return {
        ...l,
        filter: ['all', (l as { filter?: unknown }).filter, notOurs],
        layout: { ...l.layout, 'text-field': nameExpression(lang) },
      } as LayerSpecification;
    }
    if (!(OVERRIDDEN_LABEL_LAYER_IDS as readonly string[]).includes(l.id)) return l;
    return { ...l, layout: { ...l.layout, 'text-field': nameExpression(lang) } } as LayerSpecification;
  });
  const roadsRail = layers.findIndex((l) => l.id === 'roads_rail');
  layers.splice(roadsRail < 0 ? layers.length : roadsRail, 0, pathsLayer);
  const pois = layers.findIndex((l) => l.id === 'pois');
  layers.splice(pois, 0, ...extraLayers(lang));
  // No capitals on labels that can hold Greek (SYC-764): MapLibre's uppercase keeps
  // the accents ("ΝΗΣΆΚΙ"), and Greek written in capitals drops them. Both languages,
  // since the app switches language without reloading the style.
  const noCaps = layers.map((l) => {
    const { 'text-transform': _caps, ...layout } = (l.layout ?? {}) as Record<string, unknown>;
    return l.type === 'symbol' && _caps === 'uppercase' ? ({ ...l, layout } as LayerSpecification) : l;
  });
  // Labels stay upright when the map turns. Point labels are fixed to the
  // viewport (no tilt, no rotation); line labels keep following the street
  // (rotation 'map', kept upright) and leave pitch alignment at its default.
  return noCaps.map((l) => {
    if (l.type !== 'symbol' || KEEP_ALIGNMENT_LAYER_IDS.includes(l.id)) return l;
    const placement = (l.layout as Record<string, unknown> | undefined)?.['symbol-placement'];
    const isLine = placement === 'line' || placement === 'line-center';
    const extra = isLine
      ? { 'text-rotation-alignment': 'map', 'text-keep-upright': true }
      : { 'text-pitch-alignment': 'viewport', 'text-rotation-alignment': 'viewport' };
    return { ...l, layout: { ...l.layout, ...extra } } as LayerSpecification;
  });
}
