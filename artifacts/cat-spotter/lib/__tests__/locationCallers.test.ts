/**
 * SYC-524 Task 3: which screens read location from the shared provider, and
 * which of them may ask. `app/` is outside vitest's render paths, so like
 * spotMapStart.test.ts this reads the screens' source.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === '__tests__' || name === 'node_modules') return [];
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('location callers', () => {
  it('no screen or component imports the old useLocation hook, and the hook is gone', () => {
    const files = [...sourceFiles(path.join(root, 'app')), ...sourceFiles(path.join(root, 'components'))];
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/@\/hooks\/useLocation/);
    }
    expect(existsSync(path.join(root, 'hooks/useLocation.ts'))).toBe(false);
  });

  it.each(['app/(tabs)/index.tsx', 'app/(tabs)/cats.tsx'])(
    '%s reads the provider and never asks',
    (file) => {
      const src = read(file);
      expect(src).toContain('useAppLocation()');
      expect(src).not.toContain('askAndLocate');
    },
  );

  // Task 5: the interim ask-on-open is gone; Spot asks only from the card,
  // the link, or straight after a photo for a spotter who shared before.
  it('Spot never asks from a mount effect', () => {
    const src = read('app/(tabs)/spot.tsx');
    expect(src).toContain('useAppLocation()');
    expect(src).not.toMatch(/useEffect\(\(\) => \{\s*void askAndLocate\(\);/);
    // Each effect up to its own dependency list; a mount effect's is empty.
    const re = /useEffect\(\(\) => \{([\s\S]*?)\n\s*\}, \[([^\]]*)\]\);/g;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      if (m[2].trim() === '') expect(m[1]).not.toMatch(/askAndLocate\(\)/);
    }
  });

  it('the report flow asks once, from a mount effect', () => {
    const src = read('app/report.tsx');
    expect(src).toMatch(/useEffect\(\(\) => \{\s*void askAndLocate\(\);/);
    expect(src.match(/askAndLocate\(\)/g)?.length).toBe(1);
  });

  // First frame: the mount effect has not run yet, so "not asked yet" must read
  // as locating or the wizard drops its fallback pin for one render.
  it('the report flow counts "not asked yet" as locating', () => {
    const src = read('app/report.tsx');
    expect(src).toMatch(/const \[asked, setAsked\] = useState\(false\)/);
    expect(src).toMatch(/useEffect\(\(\) => \{\s*setAsked\(true\);\s*void askAndLocate\(\);/);
    expect(src).toMatch(/gps=\{\{ coords, locating: locating \|\| !asked, denied \}\}/);
  });
});
