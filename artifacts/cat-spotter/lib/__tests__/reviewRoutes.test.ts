/**
 * F7: every navigation to the review screen is built by buildReviewParams().
 *
 * The photograph used to travel to the review screen through the route —
 * which expo-router puts in the browser address — in THREE places: submit(),
 * reviewPending() and ReviewReadyBanner. PR #9 fixed two. This scans the app's
 * source so a fourth, or a regression in any of the three, fails here rather
 * than on a tester's phone.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_ROOT = path.resolve(__dirname, '../..');
const SOURCE_DIRS = ['app', 'components', 'context', 'hooks', 'lib'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

interface Navigation {
  where: string;
  builtBy: string | null;
  /** The route's source text, up to the end of its params object. */
  args?: string;
}

/** Every place the source names the /review route, other than comparisons. */
function reviewNavigations(): Navigation[] {
  const found: Navigation[] = [];
  for (const dir of SOURCE_DIRS) {
    for (const file of sourceFiles(path.join(APP_ROOT, dir))) {
      const src = readFileSync(file, 'utf8');
      const pattern = /(['"`])\/review(?=[?'"`/])/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(src))) {
        // Mentions in comments navigate nowhere.
        const linePrefix = src.slice(src.lastIndexOf('\n', match.index) + 1, match.index);
        if (/^\s*(\*|\/\*|\/\/)/.test(linePrefix) || linePrefix.includes('//')) continue;
        const before = src.slice(Math.max(0, match.index - 40), match.index);
        // `pathname === '/review'` reads where the user is; it navigates nowhere.
        if (/[!=]==\s*$/.test(before)) continue;
        const line = src.slice(0, match.index).split('\n').length;
        const where = `${path.relative(APP_ROOT, file)}:${line}`;
        if (!/pathname:\s*$/.test(before)) {
          // A string route such as router.push('/review?data=…').
          found.push({ where, builtBy: null });
          continue;
        }
        const after = src.slice(match.index, match.index + 600);
        const params = /params:\s*([A-Za-z_$][\w$]*)?\s*([({])/.exec(after);
        found.push({
          where,
          builtBy: params && params[2] === '(' ? (params[1] ?? null) : null,
          args: after.slice(0, after.indexOf('})') + 2),
        });
      }
    }
  }
  return found;
}

describe('review routes', () => {
  it('F7: every /review navigation is built by buildReviewParams()', () => {
    const navigations = reviewNavigations();
    const bypasses = navigations
      .filter((n) => n.builtBy !== 'buildReviewParams')
      .map((n) => n.where);
    expect(bypasses).toEqual([]);
  });

  it('finds all three known places, so the check above cannot pass by finding none', () => {
    const files = reviewNavigations().map((n) => n.where.split(':')[0]);
    expect(files.filter((f) => f.endsWith('spot.tsx'))).toHaveLength(2);
    expect(files.filter((f) => f.endsWith('ReviewReadyBanner.tsx'))).toHaveLength(1);
  });

  // SYC-503: a route that drops the check result reopens a failed check as
  // "no look-alikes, you're the first to spot this cat".
  it('every /review navigation passes the look-alike check result along', () => {
    const missing = reviewNavigations()
      .filter((n) => !/matchCheck:/.test(n.args ?? '') || !/canRecheck:/.test(n.args ?? ''))
      .map((n) => n.where);
    expect(missing).toEqual([]);
  });
});
