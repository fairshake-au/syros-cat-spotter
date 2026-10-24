/**
 * SYC-148: the website loads small subset WOFF2 fonts; the phone apps load the
 * full TTFs. Both lists, and the stand-in faces used before the files arrive,
 * must cover every font name the app's styles use.
 */
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fonts } from '../../constants/theme';

const root = resolve(__dirname, '../..');
const webSource = readFileSync(resolve(root, 'lib/fontSources.web.ts'), 'utf8');
const nativeSource = readFileSync(resolve(root, 'lib/fontSources.ts'), 'utf8');
const families = [...new Set(Object.values(fonts))];

describe('font sources', () => {
  it('lists every font family the theme uses, on web and on native', () => {
    for (const family of families) {
      expect(webSource, `web: ${family}`).toContain(`${family}: require('../assets/fonts/${family}.woff2')`);
      expect(nativeSource, `native: ${family}`).toMatch(new RegExp(`^  ${family},$`, 'm'));
    }
  });

  it('keeps each web font small', () => {
    for (const family of families) {
      const bytes = statSync(resolve(root, `assets/fonts/${family}.woff2`)).size;
      expect(bytes, family).toBeGreaterThan(10_000);
      expect(bytes, family).toBeLessThan(45_000);
    }
  });

  it('has a sans-serif or monospace stand-in for every family', () => {
    for (const family of families) {
      expect(webSource, family).toMatch(new RegExp(`^  ${family}: [A-Z_]+,$`, 'm'));
    }
  });
});
