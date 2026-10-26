import type { ExpressionSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import {
  OVERRIDDEN_LABEL_LAYER_IDS,
  adjustedLayers,
  nameExpression,
  otherNameTextFields,
  type MapLang,
} from './adjusted';

export { OVERRIDDEN_LABEL_LAYER_IDS, type MapLang };

export function MAP_LANG(appLang: 'en' | 'el' | 'fr'): MapLang {
  return appLang === 'el' ? 'el' : 'en';
}

export interface BuildStyleOptions {
  lang: MapLang;
  pmtilesUrl: string;
  glyphsUrl: string;
  spriteUrl: string;
}

export function buildStyle(opts: BuildStyleOptions): StyleSpecification {
  return {
    version: 8,
    glyphs: opts.glyphsUrl,
    sprite: opts.spriteUrl,
    sources: {
      protomaps: { type: 'vector', url: opts.pmtilesUrl, attribution: '© OpenStreetMap contributors' },
    },
    layers: adjustedLayers(opts.lang),
  };
}

/** text-field per label layer, for switching language without reloading the style. */
export function labelFieldsFor(lang: MapLang): Array<{ layerId: string; textField: ExpressionSpecification }> {
  return [
    ...OVERRIDDEN_LABEL_LAYER_IDS.map((layerId) => ({ layerId: layerId as string, textField: nameExpression(lang) })),
    ...otherNameTextFields(lang),
  ];
}
