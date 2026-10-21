/**
 * Every message reaches the user, on every platform.
 *
 * `Alert.alert` is an empty function on react-native-web, so any `Alert.alert(` outside
 * the notify helper itself is a message a web tester will never see. This
 * scans the app's source so a reintroduced `Alert.alert` fails here rather
 * than silently swallowing a message on a tester's phone.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_ROOT = path.resolve(__dirname, '../..');
const SOURCE_DIRS = ['app', 'components', 'context', 'lib'];

// `lib/notify.ts` is the one place Alert.alert is allowed to live — it is the
// native branch of the cross-platform helper. (The Help & info screen used to
// have its own local helper; it now calls notify() like everything else.)
const EXCLUDED_FILES = new Set(['lib/notify.ts']);

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

/** Every `Alert.alert(` call outside the allowed files, as `path:line`. */
function rawAlertUsages(): string[] {
  const found: string[] = [];
  for (const dir of SOURCE_DIRS) {
    const root = path.join(APP_ROOT, dir);
    for (const file of sourceFiles(root)) {
      const rel = path.relative(APP_ROOT, file);
      if (EXCLUDED_FILES.has(rel)) continue;
      const src = readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (line.includes('Alert.alert(')) found.push(`${rel}:${i + 1}`);
      });
    }
  }
  return found;
}

describe('notify helper coverage', () => {
  it('no Alert.alert( outside lib/notify.ts', () => {
    expect(rawAlertUsages()).toEqual([]);
  });
});
