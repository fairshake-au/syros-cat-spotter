/**
 * SYC-113 test 22: scripts/check-web-env.js stops a web build that would
 * publish the tester key.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/check-web-env.js');

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function appDir(files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syc113-webenv-'));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

function run(mode: 'before' | 'after', dir: string, env: Record<string, string> = {}) {
  const clean = { ...process.env };
  delete clean.EXPO_PUBLIC_PRELAUNCH_KEY;
  delete clean.PRELAUNCH_TESTER_KEYS;
  return spawnSync(process.execPath, [script, mode, dir], { env: { ...clean, ...env }, encoding: 'utf8' });
}

const KEY = randomBytes(24).toString('base64url');

describe('check-web-env.js before the export', () => {
  it('passes when the key is nowhere', () => {
    const res = run('before', appDir({ '.env': 'EXPO_PUBLIC_DOMAIN=x\n' }));
    expect(res.status).toBe(0);
  });

  it('fails when EXPO_PUBLIC_PRELAUNCH_KEY is set in the environment', () => {
    const res = run('before', appDir(), { EXPO_PUBLIC_PRELAUNCH_KEY: KEY });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('The tester key must only be set in EAS store builds, never for the website.');
    expect(res.stderr + res.stdout).not.toContain(KEY);
  });

  it.each(['.env.production', '.env', '.env.local', '.env.production.local'])(
    'fails when the key is only in %s',
    (file) => {
      const res = run('before', appDir({ [file]: `# tester key\nEXPO_PUBLIC_PRELAUNCH_KEY="${KEY}"\n` }));
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain(file);
      expect(res.stderr + res.stdout).not.toContain(KEY);
    },
  );

  it('handles export prefixes and ignores comments and empty values', () => {
    expect(run('before', appDir({ '.env': `export EXPO_PUBLIC_PRELAUNCH_KEY=${KEY}\n` })).status).not.toBe(0);
    expect(run('before', appDir({ '.env': `# EXPO_PUBLIC_PRELAUNCH_KEY=${KEY}\n` })).status).toBe(0);
    expect(run('before', appDir({ '.env': 'EXPO_PUBLIC_PRELAUNCH_KEY=\n' })).status).toBe(0);
  });
});

describe('check-web-env.js after the export', () => {
  it('fails when a PRELAUNCH_TESTER_KEYS value appears anywhere in dist/', () => {
    const dir = appDir({
      'dist/index.html': '<html></html>',
      'dist/_expo/static/js/web/entry-abc.js': `var a=1;var k="${KEY}";`,
    });
    const res = run('after', dir, { PRELAUNCH_TESTER_KEYS: `old-key-not-present, ${KEY}` });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('entry-abc.js');
    expect(res.stderr).toContain('Tester key #2');
    expect(res.stderr + res.stdout).not.toContain(KEY);
  });

  it('passes when no key appears, or when no tester keys are configured', () => {
    const dir = appDir({ 'dist/index.html': '<html></html>', 'dist/a.js': 'var a=1;' });
    expect(run('after', dir, { PRELAUNCH_TESTER_KEYS: KEY }).status).toBe(0);
    expect(run('after', dir).status).toBe(0);
  });
});

describe('build:web runs the check before and after the export', () => {
  it('is wired into package.json', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(path.dirname(script), '..', 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const buildWeb = pkg.scripts['build:web']!;
    const before = buildWeb.indexOf('check-web-env.js before');
    const exportAt = buildWeb.indexOf('expo export');
    const after = buildWeb.indexOf('check-web-env.js after');
    expect(before).toBeGreaterThanOrEqual(0);
    expect(exportAt).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(exportAt);
  });
});
