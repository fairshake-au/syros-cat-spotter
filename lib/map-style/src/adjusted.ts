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
] as const;

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
  paint: { 'line-color': '#fa8072', 'line-width': 1.5, 'line-dasharray': [1, 2] },
};

/** The Protomaps place layers' text-field for a language (two-line towns). */
export function placeTextFields(lang: MapLang) {
  const all = protomapsLayers('protomaps', flavor, { lang }) as LayerSpecification[];
  return PLACE_LABEL_LAYER_IDS.map((layerId) => {
    const l = all.find((x) => x.id === layerId);
    return { layerId, textField: (l?.layout as Record<string, unknown> | undefined)?.['text-field'] as ExpressionSpecification };
  }).filter((f) => f.textField !== undefined);
}

export function adjustedLayers(lang: MapLang): LayerSpecification[] {
  const layers = (protomapsLayers('protomaps', flavor, { lang }) as LayerSpecification[]).map((l) => {
    if (!(OVERRIDDEN_LABEL_LAYER_IDS as readonly string[]).includes(l.id)) return l;
    return { ...l, layout: { ...l.layout, 'text-field': nameExpression(lang) } } as LayerSpecification;
  });
  const roadsRail = layers.findIndex((l) => l.id === 'roads_rail');
  layers.splice(roadsRail < 0 ? layers.length : roadsRail, 0, pathsLayer);
  const pois = layers.findIndex((l) => l.id === 'pois');
  layers.splice(pois, 0, ...extraLayers(lang));
  // Labels stay upright when the map turns. Point labels are fixed to the
  // viewport (no tilt, no rotation); line labels keep following the street
  // (rotation 'map', kept upright) and leave pitch alignment at its default.
  return layers.map((l) => {
    if (l.type !== 'symbol') return l;
    const placement = (l.layout as Record<string, unknown> | undefined)?.['symbol-placement'];
    const isLine = placement === 'line' || placement === 'line-center';
    const extra = isLine
      ? { 'text-rotation-alignment': 'map', 'text-keep-upright': true }
      : { 'text-pitch-alignment': 'viewport', 'text-rotation-alignment': 'viewport' };
    return { ...l, layout: { ...l.layout, ...extra } } as LayerSpecification;
  });
}
