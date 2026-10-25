import { describe, expect, it } from 'vitest';
import type { LayerSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { layers as protomapsLayers, namedFlavor } from '@protomaps/basemaps';
import { MAP_LANG, buildStyle, labelFieldsFor } from './index';

const EN = { lang: 'en', pmtilesUrl: 'pmtiles://x', glyphsUrl: 'g/{fontstack}/{range}.pbf', spriteUrl: 's' } as const;
const EL = { ...EN, lang: 'el' } as const;

function layer(s: StyleSpecification, id: string): LayerSpecification {
  const l = s.layers.find((x) => x.id === id);
  if (!l) throw new Error(`no layer ${id}`);
  return l;
}
const paint = (s: StyleSpecification, id: string) => (layer(s, id).paint ?? {}) as Record<string, unknown>;
const textField = (s: StyleSpecification, id: string) =>
  ((layer(s, id).layout ?? {}) as Record<string, unknown>)['text-field'];

describe('map style', () => {
  it('maps app languages to map languages', () => {
    expect(MAP_LANG('fr')).toBe('en');
    expect(MAP_LANG('el')).toBe('el');
    expect(MAP_LANG('en')).toBe('en');
  });

  it('uses the adjusted colours', () => {
    const s = buildStyle(EN);
    expect(paint(s, 'earth')['fill-color']).toBe('#f2efe9');
    expect(paint(s, 'water')['fill-color']).toBe('#aad3df');
  });

  it('wires the source, glyphs and sprite', () => {
    const s = buildStyle(EN);
    expect(s.glyphs).toBe(EN.glyphsUrl);
    expect(s.sprite).toBe('s');
    expect(s.sources.protomaps).toMatchObject({ type: 'vector', url: 'pmtiles://x' });
  });

  it('adds churches, hill tops and beach names before pois, and footpaths', () => {
    const ids = buildStyle(EN).layers.map((l) => l.id);
    expect(ids.indexOf('church')).toBeLessThan(ids.indexOf('pois'));
    expect(ids.indexOf('peak')).toBeLessThan(ids.indexOf('pois'));
    expect(ids.indexOf('beach_name')).toBeLessThan(ids.indexOf('pois'));
    expect(ids).toEqual(expect.arrayContaining(['church', 'peak', 'beach_name', 'paths']));
    const p = buildStyle(EN).layers.find((l) => l.id === 'paths')!;
    expect(p.minzoom).toBe(14);
    expect(p.paint).toMatchObject({ 'line-color': '#fa8072', 'line-dasharray': [1, 2] });
  });

  it('English streets and landmarks are one line; towns are two', () => {
    expect(JSON.stringify(textField(buildStyle(EN), 'roads_labels_minor'))).not.toContain('\\n');
    expect(JSON.stringify(textField(buildStyle(EN), 'pois'))).not.toContain('\\n');
    expect(JSON.stringify(textField(buildStyle(EN), 'places_locality'))).toContain('\\n');
  });

  it('uses name:en then name for en, name:el then name for el', () => {
    expect(textField(buildStyle(EN), 'roads_labels_minor')).toEqual(['coalesce', ['get', 'name:en'], ['get', 'name']]);
    expect(textField(buildStyle(EL), 'pois')).toEqual(['coalesce', ['get', 'name:el'], ['get', 'name']]);
  });

  it('labelFieldsFor swaps only label layers', () => {
    const ids = labelFieldsFor('el').map((f) => f.layerId);
    expect(ids).toContain('roads_labels_minor');
    expect(ids).toContain('places_locality');
    expect(ids).not.toContain('earth');
    const s = buildStyle(EL);
    for (const f of labelFieldsFor('el')) expect(textField(s, f.layerId)).toEqual(f.textField);
  });

  it('leaves Protomaps own alignment on shields and one-way arrows', () => {
    const plain = (protomapsLayers('protomaps', namedFlavor('light'), { lang: 'en' }) as LayerSpecification[]);
    const s = buildStyle(EN);
    for (const id of ['roads_shields', 'roads_oneway']) {
      expect(layer(s, id).layout, id).toEqual(plain.find((l) => l.id === id)!.layout);
    }
  });

  it.each(['en', 'el'] as const)('labelFieldsFor covers every symbol layer that reads a name (%s)', (lang) => {
    const s = buildStyle({ ...EN, lang });
    const fields = new Map(labelFieldsFor(lang).map((f) => [f.layerId, f.textField]));
    const reads = /"(name|name:en|name:el|pgf:name[^"]*)"/;
    const named = s.layers.filter((l) => l.type === 'symbol' && reads.test(JSON.stringify(textField(s, l.id))));
    expect(named.length).toBeGreaterThan(8);
    for (const l of named) expect(fields.get(l.id), l.id).toEqual(textField(s, l.id));
    for (const id of ['church', 'peak', 'beach_name', 'earth_label_islands']) expect(fields.has(id), id).toBe(true);
  });

  it('keeps point labels upright and flat, and line labels following the street', () => {
    const symbols = buildStyle(EN).layers.filter((l) => l.type === 'symbol');
    expect(symbols.length).toBeGreaterThan(5);
    let lines = 0;
    const KEEP = ['roads_shields', 'roads_oneway'];
    for (const l of symbols) {
      const lay = l.layout as Record<string, unknown>;
      const placement = lay['symbol-placement'];
      if (KEEP.includes(l.id)) continue;
      if (placement === 'line' || placement === 'line-center') {
        lines++;
        expect(lay['text-rotation-alignment'], l.id).toBe('map');
        expect(lay['text-keep-upright'], l.id).toBe(true);
        expect(lay['text-pitch-alignment'], l.id).toBeUndefined();
      } else {
        expect(lay['text-pitch-alignment'], l.id).toBe('viewport');
        expect(lay['text-rotation-alignment'], l.id).toBe('viewport');
      }
    }
    expect(lines).toBeGreaterThan(0);
  });
});
