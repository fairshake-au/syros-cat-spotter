/**
 * SYC-677 D, ruling R26: a cat nobody has named yet carries its SYR number as
 * `name`. UI code never draws a raw cat name; it goes through catDisplayName.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const RAW = /\b(?:cat|c|selected|hintCat|result\.cat|data\.cat)\.name\b/;

/** Lines that read the name but do not draw it: key = file, value = line text to allow. */
const ALLOWED: Record<string, string[]> = {
  'lib/catDisplayName.ts': [],
  'app/(tabs)/cats.tsx': ['const haystack = [c.name,'],
  'components/OwnershipNoticeBanner.tsx': ['name: cat.name,', 'before.name !== cat.name'],
  'components/ClaimCatSheet.tsx': ['setCatName(cat.namePending'],
  'components/NameThisCat.tsx': ['.join(cat.name)'],
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '__tests__' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

describe('UI code never draws a raw cat name', () => {
  it('uses catDisplayName wherever a cat\'s name is shown', () => {
    const offenders: string[] = [];
    for (const dir of ['app', 'components']) {
      for (const file of walk(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        const allowed = ALLOWED[rel] ?? [];
        readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
          if (!RAW.test(line)) return;
          if (allowed.some((a) => line.includes(a))) return;
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
