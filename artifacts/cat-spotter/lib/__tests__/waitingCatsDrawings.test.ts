/**
 * SYC-772 (spec §3.1, §3.4): the eight "While we look" drawings keep their
 * viewBox, every id their "Moving parts" comment names, and only the allowed
 * tags. The app moves those parts by id, so a refined drawing that drops one
 * must fail here and not on a phone.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = path.resolve(__dirname, '../../../../docs/specs/assets/while-we-look');
const ALLOWED = new Set(['svg', 'style', 'g', 'path', 'ellipse', 'circle', 'rect', 'polygon', 'line']);

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.svg')).sort();

function expectedViewBox(file: string): string {
  if (file.startsWith('topic-')) return '0 0 160 160';
  if (file === 'progress-walking-cat.svg') return '0 -3 48 35';
  if (file === 'progress-sleeping-cat.svg') return '0 0 48 32';
  throw new Error(`unexpected drawing ${file}`);
}

/** Ids named by "Moving parts:" — the text before the first ":" of each "|" piece, split on ",". */
function movingPartIds(svg: string): string[] {
  const line = svg.split('\n').find((l) => l.includes('Moving parts:'));
  if (!line) throw new Error('no Moving parts line');
  const text = line.slice(line.indexOf('Moving parts:') + 'Moving parts:'.length);
  return text
    .split('|')
    .flatMap((piece) => piece.slice(0, piece.indexOf(':')).split(','))
    .map((id) => id.trim())
    .filter(Boolean);
}

describe('while-we-look drawings', () => {
  it('finds all eight drawings', () => {
    expect(files).toHaveLength(8);
  });

  it.each(files)('%s keeps its viewBox, moving-part ids and allowed tags', (file) => {
    const svg = fs.readFileSync(path.join(DIR, file), 'utf8');
    expect(svg.match(/viewBox="([^"]+)"/)?.[1]).toBe(expectedViewBox(file));

    const ids = movingPartIds(svg);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(svg, `id ${id}`).toContain(`id="${id}"`);

    // Strip comments until none are left, then refuse an unclosed one, so a
    // tag can't hide inside a half-written comment.
    let body = svg;
    for (let prev = ''; body !== prev; ) {
      prev = body;
      body = body.replace(/<!--[\s\S]*?-->/g, '');
    }
    expect(body, 'unclosed comment').not.toContain('<!--');
    const tags = [...body.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1]);
    for (const tag of tags) expect(ALLOWED.has(tag), `tag <${tag}>`).toBe(true);
  });
});
