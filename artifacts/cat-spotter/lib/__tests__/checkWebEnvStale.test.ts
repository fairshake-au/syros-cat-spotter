/**
 * SYC-133 review: check-web-env.js `after` runs before precompress-web.js, so
 * any .br/.gz file it finds is left over from an earlier build. Its contents
 * can't be searched for the tester key (they're compressed), yet serve-web.js
 * would send it, so the build must stop.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { checkAfter } = require('../../scripts/check-web-env.js');

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function appWithDist(files: string[]): string {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-web-env-'));
  dirs.push(appDir);
  for (const f of files) {
    const full = path.join(appDir, 'dist', f);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'x');
  }
  return appDir;
}

describe('check-web-env after: stale compressed copies', () => {
  it('fails the build when dist/ already holds .br or .gz files', () => {
    const appDir = appWithDist(['index.html', '_expo/static/js/web/main.js', '_expo/static/js/web/main.js.br', 'main.css.gz']);
    const problems: string[] = checkAfter({ env: {}, appDir });
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toMatch(/main\.js\.br/);
    expect(problems.join('\n')).toMatch(/main\.css\.gz/);
  });

  it('passes a fresh export with no compressed copies', () => {
    const appDir = appWithDist(['index.html', '_expo/static/js/web/main.js']);
    expect(checkAfter({ env: {}, appDir })).toEqual([]);
  });
});
