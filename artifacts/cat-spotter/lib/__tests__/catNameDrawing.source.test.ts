/**
 * SYC-677 D, ruling R26: a cat nobody has named yet carries its SYR number as
 * `name`. UI code never draws a raw cat name; it goes through catDisplayName.
 *
 * Allowlist by exception: EVERY `.name` read in app/ and components/ fails
 * this test unless the file and the line's text are listed below with a
 * reason. Style-sheet reads (`styles.name`, `compact.name`) are the one
 * blanket exclusion. Anything new that reads `.name` has to be looked at.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
/** Any `x.name`, `x[0]!.name`, `x?.name` read. */
const READ = /[\w\])!?]\.name\b/;
/** Style sheets, not data. */
const STYLE_SHEET = /\b(?:styles|compact)\.name\b/g;

type Allow = { includes: string; why: string };
const ALLOWED: Record<string, Allow[]> = {
  'app/(tabs)/cats.tsx': [
    { includes: 'const haystack = [c.name,', why: 'catalogue search matches the SYR number too (ruling R26)' },
  ],
  'app/review.tsx': [
    { includes: 'nameTakenCat.name', why: 'a cat holding a taken name is never pending' },
  ],
  'components/CatCard.tsx': [
    { includes: '{cat.name}', why: 'the SYR number under "No name yet", shown on purpose (only for a pending cat)' },
  ],
  'components/catPage/AboutTab.tsx': [
    { includes: 'name: cat.name, namePending: cat.namePending', why: 'handed on whole; QuestionCards picks the sentence name' },
  ],
  'components/ClaimCatSheet.tsx': [
    { includes: 'setCatName(cat.namePending', why: 'rename box prefill; empty for a pending cat' },
  ],
  'components/NameThisCat.tsx': [
    { includes: ".join(cat.name)", why: 'shows the SYR number on purpose, as "Its number is ..."' },
  ],
  'components/OwnershipNoticeBanner.tsx': [
    { includes: 'name: cat.name,', why: 'stored snapshot to compare renames, never drawn' },
    { includes: 'before.name !== cat.name', why: 'comparison of stored names, not drawn' },
    { includes: 'notice.name', why: 'notice.name was set through catDisplayName' },
  ],
  'components/profile/SpottersTab.tsx': [
    { includes: 'row.name', why: 'a spotter (person), not a cat' },
    { includes: 'summary.name', why: 'a rank level name, not a cat' },
  ],
  'components/report/VetList.tsx': [
    { includes: 'municipality.name', why: 'a municipality' },
    { includes: 'clinic.name', why: 'a vet clinic' },
  ],
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

function offenders(): string[] {
  const found: string[] = [];
  for (const dir of ['app', 'components']) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, file);
      const allowed = ALLOWED[rel] ?? [];
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const code = line.replace(STYLE_SHEET, '');
        if (!READ.test(code)) return;
        if (allowed.some((a) => line.includes(a.includes))) return;
        found.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  return found;
}

/**
 * Ruling R29: "No name yet" must not land inside a sentence. A `{name}`
 * template is filled from catNameInSentence, never from catDisplayName or a
 * variable made from it; and every `catName={...}` prop (the components that
 * receive a name fill sentences with it) is given catNameInSentence too. A
 * line may be listed with a reason when the name stands alone.
 */
const FILL_WITH_DISPLAY_NAME = /\{name\}['"][^\n]*(?:catDisplayName|shownName|catListName)/;
const CAT_NAME_PROP = /\bcatName=\{/;
const SENTENCE_ALLOWED: Record<string, Array<{ includes: string; why: string }>> = {
  'components/MoreToAdd.tsx': [
    { includes: 'catName={catName}', why: 'passes on the sentence name it was given (AboutTab gives catNameInSentence)' },
  ],
};

function sentenceOffenders(): string[] {
  const found: string[] = [];
  for (const dir of ['app', 'components']) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, file);
      const allowed = SENTENCE_ALLOWED[rel] ?? [];
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const bad =
          FILL_WITH_DISPLAY_NAME.test(line) ||
          (CAT_NAME_PROP.test(line) && !/catNameInSentence|sentenceName/.test(line));
        if (!bad) return;
        if (allowed.some((x) => line.includes(x.includes))) return;
        found.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  return found;
}

describe('a cat name inside a sentence (R29)', () => {
  it('fills a {name} template only through catNameInSentence', () => {
    expect(sentenceOffenders()).toEqual([]);
  });
});

describe('UI code never draws a raw cat name', () => {
  it('reads .name only where the allowlist says why', () => {
    expect(offenders()).toEqual([]);
  });

  it('every allowlist entry still matches a line (no stale exceptions)', () => {
    for (const [rel, entries] of Object.entries(ALLOWED)) {
      const text = readFileSync(join(ROOT, rel), 'utf8');
      for (const a of entries) expect(text, `${rel}: ${a.includes}`).toContain(a.includes);
    }
  });
});
