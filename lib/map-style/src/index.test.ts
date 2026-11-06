import { readFileSync } from 'node:fs';
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

  it.each(['en', 'el'] as const)('writes no label in capitals, so Greek keeps correct accents (%s)', (lang) => {
    const upper = buildStyle({ ...EN, lang }).layers
      .filter((l) => ((l.layout ?? {}) as Record<string, unknown>)['text-transform'] === 'uppercase')
      .map((l) => l.id);
    expect(upper).toEqual([]);
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
  describe('quieter look (SYC-720)', () => {
    const MAIN = ['match', ['get', 'kind_detail'], ['primary', 'secondary', 'trunk', 'motorway'], true, false];

    it('only main roads are orange; minor major-road kinds are white with a grey casing', () => {
      const s = buildStyle(EN);
      expect(paint(s, 'roads_major')['line-color']).toEqual(['case', MAIN, '#fcd6a4', '#ffffff']);
      for (const id of ['roads_major_casing_early', 'roads_major_casing_late']) {
        expect(paint(s, id)['line-color'], id).toEqual(['case', MAIN, '#c79d6a', '#c8c0b6']);
      }
    });

    it('bridges follow the same main-road split', () => {
      const s = buildStyle(EN);
      expect(paint(s, 'roads_bridges_major')['line-color']).toEqual(['case', MAIN, '#fcd6a4', '#ffffff']);
      expect(paint(s, 'roads_bridges_major_casing')['line-color']).toEqual(['case', MAIN, '#c79d6a', '#c8c0b6']);
    });

    it('footpaths are fainter and thinner at low zoom', () => {
      const p = paint(buildStyle(EN), 'paths');
      expect(p['line-opacity']).toEqual(['interpolate', ['linear'], ['zoom'], 13, 0.15, 15, 0.4, 16.5, 0.85]);
      expect(p['line-width']).toEqual(['interpolate', ['linear'], ['zoom'], 13, 0.6, 16, 1, 18, 1.6]);
    });

    it('hill tops show from zoom 12', () => {
      expect(layer(buildStyle(EN), 'peak').minzoom).toBe(12);
    });

    it.each(['en', 'el'] as const)('pois leaves beaches and peaks to our own layers (%s)', (lang) => {
      const f = layer(buildStyle({ ...EN, lang }), 'pois').filter;
      expect(JSON.stringify(f)).toContain('["!",["in",["get","kind"],["literal",["beach","peak"]]]]');
      expect(f![0]).toBe('all');
    });
  });
});

describe('the quiet base map (SYC-812 §3.4)', () => {
  const QUIET = { ...EN, quiet: true } as const;
  const LAND = '#f4f2ec';
  const WATER = '#cfe7f9';
  const here = (f: string) => new URL(`./__fixtures__/${f}`, import.meta.url);

  it.each(['en', 'el'] as const)('with no quiet option the style is unchanged (%s)', (lang) => {
    // The fixture is the style as it was before the quiet option existed.
    const before = JSON.parse(readFileSync(here(`style-before-quiet.${lang}.json`), 'utf8'));
    const opts = { ...EN, lang } as const;
    expect(JSON.parse(JSON.stringify(buildStyle(opts)))).toEqual(before);
    expect(JSON.parse(JSON.stringify(buildStyle({ ...opts, quiet: false })))).toEqual(before);
    expect(JSON.parse(JSON.stringify(buildStyle({ ...opts, quiet: undefined })))).toEqual(before);
  });

  it('quiet land is #f4f2ec and water is #cfe7f9', () => {
    const s = buildStyle(QUIET);
    expect(paint(s, 'earth')['fill-color']).toBe(LAND);
    expect(paint(s, 'water')['fill-color']).toBe(WATER);
    expect(paint(s, 'background')['background-color']).toBe(WATER);
    expect(paint(s, 'water_river')['line-color']).toBe(WATER);
  });

  it('quiet keeps every layer, in order, and every label layer exactly as it was apart from colour', () => {
    const plain = buildStyle(EN);
    const quiet = buildStyle(QUIET);
    expect(quiet.layers.map((l) => l.id)).toEqual(plain.layers.map((l) => l.id));
    const labels = plain.layers.filter((l) => l.type === 'symbol');
    expect(labels.length).toBeGreaterThan(10);
    for (const l of labels) {
      const q = layer(quiet, l.id);
      expect(q.layout, l.id).toEqual(l.layout);
      expect((q as { filter?: unknown }).filter, l.id).toEqual((l as { filter?: unknown }).filter);
      expect(q.minzoom, l.id).toEqual(l.minzoom);
      expect(q.maxzoom, l.id).toEqual(l.maxzoom);
    }
    expect(labelFieldsFor('en').every((f) => JSON.stringify(textField(quiet, f.layerId)) === JSON.stringify(f.textField))).toBe(true);
  });

  it('quiet changes only colours, never a width, an opacity or a shape', () => {
    const plain = buildStyle(EN);
    const quiet = buildStyle(QUIET);
    const strip = (l: LayerSpecification) => {
      const p = { ...((l.paint ?? {}) as Record<string, unknown>) };
      for (const k of Object.keys(p)) if (/color/.test(k)) delete p[k];
      return { ...l, paint: p };
    };
    for (const l of plain.layers) expect(strip(layer(quiet, l.id)), l.id).toEqual(strip(l));
  });

  // Contrast, worked out from the colours in the style itself (WCAG relative luminance).
  const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };
  const hexes = (v: unknown) => [...JSON.stringify(v).matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]);

  it('every label colour is at least 4.5:1 on its ground (land, or water for water names)', () => {
    const s = buildStyle(QUIET);
    const onWater = new Set(['water_waterway_label', 'water_label_ocean', 'water_label_lakes']);
    let checked = 0;
    for (const l of s.layers.filter((x) => x.type === 'symbol')) {
      const colour = paint(s, l.id)['text-color'];
      if (colour === undefined) continue;
      for (const c of hexes(colour)) {
        // A label drawn in the halo's own colour is not drawn (pois of unknown kinds).
        if (c === paint(s, l.id)['text-halo-color']) continue;
        expect(ratio(c, onWater.has(l.id) ? WATER : LAND), `${l.id} ${c}`).toBeGreaterThanOrEqual(4.5);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(15);
  });
});
