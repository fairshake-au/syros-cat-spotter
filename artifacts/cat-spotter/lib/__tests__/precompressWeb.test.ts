/**
 * SYC-133: scripts/precompress-web.js writes .br and .gz copies of the web
 * export's text files, which server/serve-web.js then sends.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/precompress-web.js');

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function dist(files: Record<string, string | Buffer>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syc133-precompress-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

describe('precompress-web', () => {
  it('writes .br and .gz for big text files and fonts; skips HTML, images and tiny files', () => {
    const js = 'const cat = "on the harbour wall";\n'.repeat(200);
    const dir = dist({
      '_expo/static/js/web/entry-abc.js': js,
      'assets/Inter.ttf': Buffer.alloc(5000, 1),
      'assets/cat.png': Buffer.alloc(5000, 2),
      'index.html': '<html>' + 'x'.repeat(5000) + '</html>',
      '_expo/static/js/web/tiny.js': 'x()',
    });
    const result = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/precompress-web: 2 files/);

    const entry = path.join(dir, '_expo/static/js/web/entry-abc.js');
    expect(zlib.brotliDecompressSync(fs.readFileSync(`${entry}.br`)).toString('utf8')).toBe(js);
    expect(zlib.gunzipSync(fs.readFileSync(`${entry}.gz`)).toString('utf8')).toBe(js);
    expect(fs.existsSync(path.join(dir, 'assets/Inter.ttf.br'))).toBe(true);

    expect(fs.existsSync(path.join(dir, 'assets/cat.png.br'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'index.html.br'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '_expo/static/js/web/tiny.js.br'))).toBe(false);
  });

  it('build:web runs it after the tester-key scan, which cannot read compressed files', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(path.dirname(script), '..', 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const steps = pkg.scripts['build:web'].split('&&').map((s) => s.trim());
    expect(steps.indexOf('node scripts/precompress-web.js')).toBeGreaterThan(
      steps.indexOf('node scripts/check-web-env.js after'),
    );
    expect(steps.indexOf('node scripts/check-web-env.js after')).toBeGreaterThan(-1);
  });
});
