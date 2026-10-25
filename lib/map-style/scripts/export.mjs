// Run with: pnpm --filter @workspace/map-style export  (needs tsx for the .ts imports)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStyle } from '../src/index.ts';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
mkdirSync(dist, { recursive: true });
for (const lang of ['en', 'el']) {
  const style = buildStyle({
    lang,
    pmtilesUrl: '{PMTILES_URL}',
    glyphsUrl: '{GLYPHS_URL}',
    spriteUrl: '{SPRITE_URL}',
  });
  writeFileSync(join(dist, `style-${lang}.json`), JSON.stringify(style, null, 2));
  console.log(`wrote dist/style-${lang}.json (${style.layers.length} layers)`);
}
