import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TRANSLATIONS, type Language } from '../i18n';
import { FACT_IDS, MAX_FACT_WORDS, STARTER_FACTS, wordCount } from '../starterFacts';

// SYC-48: starter-facts.md §9.1 tests 10–12, plus a check that every word in
// the app is the spec's word (Greek and French go to Johnny from the spec).

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const factsSpec = readFileSync(path.join(ROOT, 'docs/specs/starter-facts.md'), 'utf8');
const nudgeSpec = readFileSync(path.join(ROOT, 'docs/specs/feeding-nudge.md'), 'utf8');
const LANGS: Language[] = ['en', 'el', 'fr'];
const TAG = { en: 'EN', el: 'EL', fr: 'FR' } as const;

/** Spaces, quotes and apostrophes compared loosely; everything else exactly. */
const norm = (s: string) =>
  s.replace(/ /g, ' ').replace(/[’‘']/g, "'").replace(/[“”"]/g, '"').trim();

function specFact(n: number, lang: Language): string {
  const block = factsSpec.split(`**Fact ${n} · `)[1]!.split('\n**Fact ')[0]!;
  const line = block.split('\n').find((l) => l.startsWith(`- **${TAG[lang]}** `))!;
  return line.slice(`- **${TAG[lang]}** `.length);
}

function specRow(md: string, key: string): Record<Language, string> {
  const line = md.split('\n').find((l) => l.startsWith(`| \`${key}\` |`))!;
  const [, en, el, fr] = line.split(' | ').map((c) => c.replace(/^\| /, '').replace(/ \|$/, ''));
  return { en: en!, el: el!, fr: fr! };
}

describe('the twenty facts', () => {
  it('there are twenty, ten core, nine needing sign-off, one with the photo', () => {
    expect(STARTER_FACTS).toHaveLength(20);
    expect(STARTER_FACTS.filter((f) => f.core)).toHaveLength(10);
    expect(STARTER_FACTS.filter((f) => f.signOff)).toHaveLength(9);
    expect(STARTER_FACTS.filter((f) => f.photo).map((f) => f.id)).toEqual(['fact.earTip']);
  });

  it('10. every fact and the card\'s words exist in English, Greek and French', () => {
    for (const lang of LANGS) {
      for (const id of [...FACT_IDS, 'waitingEyebrow', 'waitingFactA11yLabel']) {
        expect({ lang, id, has: Boolean(TRANSLATIONS[lang][id]) }).toEqual({ lang, id, has: true });
      }
    }
  });

  it('11. every fact is 35 words or fewer in each language', () => {
    for (const lang of LANGS) {
      for (const id of FACT_IDS) {
        const n = wordCount(TRANSLATIONS[lang][id]!);
        expect({ lang, id, ok: n <= MAX_FACT_WORDS }).toEqual({ lang, id, ok: true });
      }
    }
  });

  it('the word rule: « ? » and « : » aren\'t words; l’oignon is one', () => {
    expect(wordCount('L’oignon ? Oui : non')).toBe(3);
  });

  it('12. fact 20\'s quoted label matches the live "Can\'t tell" answer in each language', () => {
    for (const lang of LANGS) {
      expect(norm(TRANSLATIONS[lang]['fact.cantTell']!)).toContain(norm(TRANSLATIONS[lang].earTipCantTell!));
    }
  });

  it('every fact is the spec\'s words, in every language', () => {
    FACT_IDS.forEach((id, i) => {
      for (const lang of LANGS) {
        expect({ id, lang, text: norm(TRANSLATIONS[lang][id]!) }).toEqual({ id, lang, text: norm(specFact(i + 1, lang)) });
      }
    });
  });

  it('the card\'s and the nudge\'s words are the spec\'s', () => {
    for (const [md, keys] of [
      [factsSpec, ['waitingEyebrow', 'waitingFactA11yLabel']],
      [
        nudgeSpec,
        [
          'feedNudgeTitle', 'feedNudgeWhy', 'feedNudgeInstead', 'feedNudgeEuro', 'feedNudgeHelp',
          'feedNudgeDismiss', 'feedNudgeA11yLabel', 'feedNudgeLine', 'feedNudgeInsteadNoLink',
        ],
      ],
    ] as const) {
      for (const key of keys) {
        const row = specRow(md, key);
        for (const lang of LANGS) {
          expect({ key, lang, text: norm(TRANSLATIONS[lang][key]!) }).toEqual({ key, lang, text: norm(row[lang]) });
        }
      }
    }
  });

  it('French and Greek keep a non-breaking space between a number and €', () => {
    for (const lang of ['el', 'fr'] as const) {
      for (const [k, v] of Object.entries(TRANSLATIONS[lang])) {
        if (/\d €/.test(v)) throw new Error(`${lang} ${k} has a breaking space before €`);
      }
    }
  });
});
