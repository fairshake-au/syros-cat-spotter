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

// The quiet base map for the dashboard (SYC-812 §3.4): the same layers, labels
// and shapes with the colour taken out, so the cats' marks stand out. Applied
// after adjustedLayers and only on request; the app's map never asks for it.
const QUIET_LAND = '#f4f2ec';
const QUIET_WATER = '#cfe7f9';
const QUIET_CASING = '#d9d5cc';
const QUIET_MAJOR_CASING = '#bab6ad';
const QUIET_HIGHWAY_CASING = '#a8a49b';
const QUIET_TUNNEL_CASING = '#ebe8e1';

/** Paint colours replaced by id (a single colour for the whole layer). */
const QUIET_PAINT: Record<string, Record<string, string>> = {
  background: { 'background-color': QUIET_WATER },
  earth: { 'fill-color': QUIET_LAND },
  landcover: { 'fill-color': '#ebeee3' },
  landuse_urban_green: { 'fill-color': '#e5ebdf' },
  landuse_hospital: { 'fill-color': '#f1efe7' },
  landuse_industrial: { 'fill-color': '#ecedea' },
  landuse_school: { 'fill-color': '#f1efe7' },
  landuse_beach: { 'fill-color': '#f1ecdc' },
  landuse_zoo: { 'fill-color': '#e6ebe7' },
  landuse_aerodrome: { 'fill-color': '#ecedee' },
  landuse_runway: { 'fill-color': '#eeeeef' },
  roads_runway: { 'line-color': '#eeeeef' },
  roads_taxiway: { 'line-color': '#eeeeef' },
  water: { 'fill-color': QUIET_WATER },
  water_stream: { 'line-color': QUIET_WATER },
  water_river: { 'line-color': QUIET_WATER },
  landuse_pedestrian: { 'fill-color': '#efeef0' },
  landuse_pier: { 'fill-color': '#ebe9e4' },
  buildings: { 'fill-color': '#e2ddd3' },
  roads_pier: { 'line-color': '#ebe9e4' },
  // Roads: white, with a hairline casing; the bigger the road, the darker the hairline.
  roads_minor_service_casing: { 'line-color': '#e1ddd5' },
  roads_minor_casing: { 'line-color': QUIET_CASING },
  roads_link_casing: { 'line-color': QUIET_CASING },
  roads_major_casing_early: { 'line-color': QUIET_MAJOR_CASING },
  roads_major_casing_late: { 'line-color': QUIET_MAJOR_CASING },
  roads_highway_casing_early: { 'line-color': QUIET_HIGHWAY_CASING },
  roads_highway_casing_late: { 'line-color': QUIET_HIGHWAY_CASING },
  roads_other: { 'line-color': '#fafaf8' },
  roads_link: { 'line-color': '#ffffff' },
  roads_minor_service: { 'line-color': '#ffffff' },
  roads_minor: { 'line-color': '#ffffff' },
  roads_major: { 'line-color': '#ffffff' },
  roads_highway: { 'line-color': '#ffffff' },
  paths: { 'line-color': '#b3a79a' },
  roads_bridges_other_casing: { 'line-color': QUIET_CASING },
  roads_bridges_link_casing: { 'line-color': QUIET_CASING },
  roads_bridges_minor_casing: { 'line-color': QUIET_CASING },
  roads_bridges_major_casing: { 'line-color': QUIET_MAJOR_CASING },
  roads_bridges_highway_casing: { 'line-color': QUIET_HIGHWAY_CASING },
  roads_bridges_other: { 'line-color': '#fafaf8' },
  roads_bridges_minor: { 'line-color': '#ffffff' },
  roads_bridges_link: { 'line-color': '#ffffff' },
  roads_bridges_major: { 'line-color': '#ffffff' },
  roads_bridges_highway: { 'line-color': '#ffffff' },
  roads_tunnels_other_casing: { 'line-color': QUIET_TUNNEL_CASING },
  roads_tunnels_minor_casing: { 'line-color': QUIET_TUNNEL_CASING },
  roads_tunnels_link_casing: { 'line-color': QUIET_TUNNEL_CASING },
  roads_tunnels_major_casing: { 'line-color': QUIET_TUNNEL_CASING },
  roads_tunnels_highway_casing: { 'line-color': QUIET_TUNNEL_CASING },
  roads_tunnels_other: { 'line-color': '#f1efe9' },
  roads_tunnels_minor: { 'line-color': '#f1efe9' },
  roads_tunnels_link: { 'line-color': '#f1efe9' },
  roads_tunnels_major: { 'line-color': '#f1efe9' },
  roads_tunnels_highway: { 'line-color': '#f1efe9' },
  // Labels stay, with darker text where the old colour fell under 4.5:1 on the new land or water.
  address_label: { 'text-color': '#6a6164' },
  water_waterway_label: { 'text-color': '#2d4a8a', 'text-halo-color': QUIET_WATER },
  water_label_ocean: { 'text-color': '#2d4a8a', 'text-halo-color': QUIET_WATER },
  water_label_lakes: { 'text-color': '#2d4a8a', 'text-halo-color': QUIET_WATER },
  earth_label_islands: { 'text-halo-color': QUIET_LAND },
  places_subplace: { 'text-halo-color': QUIET_LAND },
  places_region: { 'text-color': '#6b6b6b', 'text-halo-color': QUIET_LAND },
  places_locality: { 'text-halo-color': QUIET_LAND },
  places_country: { 'text-color': '#6b6b6b', 'text-halo-color': QUIET_LAND },
  church: { 'text-halo-color': QUIET_LAND },
  peak: { 'text-halo-color': QUIET_LAND },
  beach_name: { 'text-color': '#7a5f17' },
};

/** Colours swapped inside layers whose paint is an expression (parks, and landmark labels). */
const QUIET_SWAPS: Record<string, Record<string, string>> = {
  landuse_park: {
    '#c8facc': '#e4ebdf', // parks and woods: a pale grey-green
    '#add19e': '#d8e3d0',
    '#c8d7ab': '#e6ebdc',
    '#f5e9c6': '#f0ead8',
    '#c6dcdc': '#e3e9e8',
    '#f2efe9': QUIET_LAND,
  },
  pois: {
    '#20834D': '#1a6e40',
    '#1A8CBD': '#11688d',
    '#CB6704': '#a14f00',
    '#EF56BA': '#b02d86',
    '#f2efe9': QUIET_LAND,
  },
};

function swapColours<T>(value: T, swaps: Record<string, string>): T {
  const json = JSON.stringify(value);
  return JSON.parse(json.replace(/#[0-9a-fA-F]{6}\b/g, (hex) => swaps[hex] ?? hex)) as T;
}

/** The layers with low-colour paint. Layout, filters, widths and opacities are left alone. */
export function quietLayers(layers: LayerSpecification[]): LayerSpecification[] {
  return layers.map((l) => {
    const flat = QUIET_PAINT[l.id];
    const swaps = QUIET_SWAPS[l.id];
    if (!flat && !swaps) return l;
    const paint = { ...((l as { paint?: Record<string, unknown> }).paint ?? {}) };
    if (swaps) {
      for (const k of Object.keys(paint)) if (/color/.test(k)) paint[k] = swapColours(paint[k], swaps);
    }
    return { ...l, paint: { ...paint, ...flat } } as LayerSpecification;
  });
}
