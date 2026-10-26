/**
 * SYC-113 test 20 (guard): nothing in the app reaches the network except
 * through customFetch (which adds the tester key) or photoSource (which adds
 * it to images). A new screen that calls the API some other way would ship
 * with no pass, so this fails with the file and line.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIRS = ['app', 'components', 'context', 'hooks', 'lib'];

// Allowed: map tiles from tile.openstreetmap.org, not our API.
// lib/mapSource.ts: map data host, not our API — SYC-705.
const ALLOW = new Set(['lib/offlineTiles.ts', 'lib/mapSource.ts']);

const RULES: { name: string; re: RegExp; except?: Set<string> }[] = [
  { name: 'fetch(', re: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', re: /\bXMLHttpRequest\b/ },
  { name: 'axios', re: /\baxios\b/ },
  { name: 'uploadAsync', re: /\buploadAsync\b/ },
  // Images from our API must use photoSource(), which adds the tester key.
  { name: 'uri: absoluteUrl(', re: /\buri\s*:\s*absoluteUrl\s*\(/ },
  { name: 'absoluteUrl( outside lib/urls.ts', re: /\babsoluteUrl\s*\(/, except: new Set(['lib/urls.ts']) },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === '__fixtures__' || entry === 'node_modules') continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

export function strayCallers(): string[] {
  const hits: string[] = [];
  for (const dir of DIRS) {
    for (const file of sourceFiles(path.join(root, dir))) {
      const rel = path.relative(root, file).split(path.sep).join('/');
      if (ALLOW.has(rel)) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const rule of RULES) {
            if (rule.except?.has(rel)) continue;
            if (rule.re.test(line)) hits.push(`${rel}:${i + 1}: ${rule.name}: ${line.trim()}`);
          }
        });
    }
  }
  return hits;
}

describe('no stray API callers', () => {
  it('app code has no fetch/XHR/axios/uploadAsync, and no image built from absoluteUrl', () => {
    expect(strayCallers()).toEqual([]);
  });

  it('the scan actually reads the app (sanity)', () => {
    const files = DIRS.flatMap((d) => sourceFiles(path.join(root, d)));
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith(path.join('app', '(tabs)', 'cats.tsx')))).toBe(true);
    expect('refetch()').not.toMatch(RULES[0]!.re);
    expect("await fetch('/api/cats')").toMatch(RULES[0]!.re);
  });
});
