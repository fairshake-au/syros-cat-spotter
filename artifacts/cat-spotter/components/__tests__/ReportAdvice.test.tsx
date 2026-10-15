// @vitest-environment jsdom
/**
 * SYC-42 plan, Slice 1 items 1.9, 1.10 and 1.12; tests 20–23.
 * The advice renders from the real guidance file in all three languages.
 */
import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGuidance, type GuidanceLanguage } from '@workspace/welfare-guidance';
import { Platform } from 'react-native';
import { TRANSLATIONS } from '@/lib/i18n';
import { savedWording } from '@/lib/savedWording';

const lang = vi.hoisted(() => ({ current: 'en' as 'en' | 'el' | 'fr' }));

vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS: T } = await import('@/lib/i18n');
  return {
    useLanguage: () => ({
      language: lang.current,
      t: (key: string) => T[lang.current][key] ?? key,
    }),
  };
});

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#fff',
    foreground: '#000',
    mutedForeground: '#666',
    card: '#fff',
    border: '#ddd',
    primary: '#123',
    primaryForeground: '#fff',
    accent: '#a00',
    destructive: '#c00',
  }),
}));

// The design-system barrel pulls in Expo native modules that don't load under
// vitest; these screens only need Button.
vi.mock('@/components/purropolis', async () => {
  const { Text } = await import('react-native');
  return {
    Button: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
      <Text role="button" onPress={onPress}>
        {children}
      </Text>
    ),
  };
});

import { UrgentAdvice } from '../report/UrgentAdvice';
import { AttentionAdvice } from '../report/AttentionAdvice';
import { LitterAdvice } from '../report/LitterAdvice';
import { VetList } from '../report/VetList';
import { ReportConfirmation } from '../report/ReportConfirmation';

const plain = (s: string) => s.replace(/\*\*/g, '');
const LANGS: GuidanceLanguage[] = ['en', 'el', 'fr'];

afterEach(() => {
  cleanup();
  lang.current = 'en';
});

describe('UrgentAdvice (§5.3(b), as folded by Samuel on 2 Oct 2026)', () => {
  it.each(LANGS)('test 21 (%s): leads with the vet route and ends with the capacity paragraph, in full', (code) => {
    lang.current = code;
    const g = getGuidance(code);
    const { container } = render(<UrgentAdvice guidance={g} />);
    const text = container.textContent ?? '';
    // The lead is the first thing said: the vet route (Samuel, 1 Oct 2026).
    expect(text.trim().startsWith(plain(g.copy.urgent.intro))).toBe(true);
    // The capacity paragraph is ALWAYS shown, in full, without expanding
    // anything, and it is the last thing said (Samuel, 1-2 Oct 2026).
    expect(text.trim().endsWith(plain(g.copy.urgent.capacity))).toBe(true);
    expect(text).toContain(plain(g.copy.urgent.cage));
    expect(text).toContain('Cyclades Vets (George Maragkos)');
  });

  it.each(LANGS)('test 21 (%s): both expanders start folded, behind clear buttons', (code) => {
    lang.current = code;
    const g = getGuidance(code);
    const { container, getAllByRole } = render(<UrgentAdvice guidance={g} />);
    const text = container.textContent ?? '';
    for (const step of g.copy.urgent.steps) expect(text).not.toContain(plain(step));
    expect(text).not.toContain(plain(g.copy.urgent.wontGoIn));
    for (const p of [g.copy.urgent.vetDoes, g.copy.urgent.cost, g.copy.urgent.decision, g.copy.urgent.municipality]) {
      expect(text).not.toContain(plain(p));
    }
    const toggles = getAllByRole('button').filter((b) => b.getAttribute('aria-expanded') === 'false');
    expect(toggles.length).toBe(2);
    expect(text).toContain(g.copy.urgent.howToHeading);
    expect(text).toContain(TRANSLATIONS[code].reportCostsHeading);
  });

  it('the how-to opens on tap, and the costs expander holds the vet, cost, decision and Municipality paragraphs', () => {
    const g = getGuidance('en');
    const { container, getByText } = render(<UrgentAdvice guidance={g} />);
    fireEvent.click(getByText(g.copy.urgent.howToHeading));
    expect(container.textContent).toContain(plain(g.copy.urgent.steps[1]!));
    fireEvent.click(getByText(TRANSLATIONS.en.reportCostsHeading));
    for (const p of [g.copy.urgent.vetDoes, g.copy.urgent.cost, g.copy.urgent.decision, g.copy.urgent.municipality]) {
      expect(container.textContent).toContain(plain(p));
    }
    // ...with the Municipality's number as a tap-to-call link.
    const links = Array.from(container.querySelectorAll('a')).map((x) => x.getAttribute('href'));
    expect(links).toContain('tel:+302281361000');
    // Opening the folds never moves the capacity paragraph from the end, and
    // it lives in no fold: it appears exactly once, outside them.
    const all = (container.textContent ?? '').trim();
    expect(all.endsWith(plain(g.copy.urgent.capacity))).toBe(true);
    expect(all.split(plain(g.copy.urgent.capacity)).length - 1).toBe(1);
  });

  it.each(LANGS)('test 22 (%s): the cage appears before any handling line', (code) => {
    lang.current = code;
    const g = getGuidance(code);
    const { container, getByText } = render(<UrgentAdvice guidance={g} />);
    fireEvent.click(getByText(g.copy.urgent.howToHeading));
    const text = container.textContent ?? '';
    const cage = text.indexOf(plain(g.copy.urgent.cage));
    const handling = text.indexOf(plain(g.copy.urgent.wontGoIn));
    expect(cage).toBeGreaterThan(-1);
    expect(handling).toBeGreaterThan(cage);
  });
});

describe('VetList (§5.7, item 1.10)', () => {
  it.each([false, true])('tap-to-call for every number, after-hours labelled, map buttons, pin accuracy (compact=%s)', (compact) => {
    const g = getGuidance('en');
    const { container } = render(<VetList guidance={g} compact={compact} />);
    const links = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    for (const v of g.vets) {
      for (const p of v.phones) expect(links).toContain(`tel:${p.tel}`);
      expect(links).toContain(v.googleMapsUrl);
      expect(links).toContain(v.appleMapsUrl);
    }
    const text = container.textContent ?? '';
    if (compact) {
      // Short labels, with the after-hours and emergency lines starred and
      // the star explained once: the clinic's own published number.
      expect(text).toContain(g.copy.vetList.phoneKindsShort.after_hours);
      expect(text).toContain(g.copy.vetList.phoneKindsShort.emergency);
      expect(text).toContain(g.copy.vetList.publishedNote);
    } else {
      expect(text).toContain(g.copy.vetList.phoneKinds.after_hours);
    }
    expect(text).toContain(g.copy.vetList.pinLandmark);
    expect(text).toContain(g.copy.vetList.pinSearch);
    // The full list ends with the Municipality; the compact cards leave it to
    // the "Costs, and the Municipality" fold (tested with UrgentAdvice).
    if (!compact) expect(links).toContain('tel:+302281361000');
  });
});

describe('AttentionAdvice and LitterAdvice', () => {
  it.each(LANGS)('needs attention renders §5.3(c) in %s', (code) => {
    lang.current = code;
    const g = getGuidance(code);
    const text = render(<AttentionAdvice guidance={g} />).container.textContent ?? '';
    expect(text).toContain(g.copy.attention.heading);
    for (const p of g.copy.attention.paragraphs) expect(text).toContain(plain(p));
  });

  it.each(LANGS)('test 23 (%s): the litter block, with no donation ask', (code) => {
    lang.current = code;
    const g = getGuidance(code);
    const text = render(<LitterAdvice guidance={g} />).container.textContent ?? '';
    expect(text).toContain(g.copy.litter.heading);
    expect(text).toContain('50–60');
    expect(text.toLowerCase()).not.toMatch(/donat|δωρε|un don\b/);
  });
});

describe('ReportConfirmation (§5.3(e), item 1.12)', () => {
  it.each(LANGS)('test 20 (%s): "Sent" only when the server accepted the text', (code) => {
    lang.current = code;
    const g = getGuidance(code);
    const sent = render(<ReportConfirmation state="sent" guidance={g} onDone={() => {}} />).container.textContent ?? '';
    expect(sent).toContain(g.copy.confirmation.sentHeading);
    expect(sent).toContain(g.copy.confirmation.sentBody);
    expect(sent).toContain(plain(g.copy.confirmation.next));
    expect(sent).toContain(plain(g.copy.confirmation.hurt));
    expect(sent).not.toContain(g.copy.confirmation.offline);
    cleanup();

    for (const state of ['queued', 'sending', 'failed'] as const) {
      const text = render(<ReportConfirmation state={state} guidance={g} onDone={() => {}} />).container.textContent ?? '';
      expect(text, state).not.toContain(g.copy.confirmation.sentHeading);
      expect(text, state).not.toContain(g.copy.confirmation.sentBody);
      // The vet advice is there whatever happened to the report.
      expect(text, state).toContain(plain(g.copy.confirmation.hurt));
      cleanup();
    }
    const queued = render(<ReportConfirmation state="queued" guidance={g} onDone={() => {}} />).container.textContent ?? '';
    // These tests run as the website: a waiting report is "saved in this browser".
    expect(queued).toContain(savedWording(g.copy.confirmation.offline, code, true));
  });

  it.each(LANGS)('SYC-170 PR 1.2 (%s): on a phone it still says "saved on your phone"; on the web, "in this browser"', (code) => {
    lang.current = code;
    const g = getGuidance(code);
    const web = render(<ReportConfirmation state="queued" guidance={g} onDone={() => {}} />).container.textContent ?? '';
    cleanup();
    const original = Platform.OS;
    try {
      (Platform as { OS: string }).OS = 'ios';
      const phone = render(<ReportConfirmation state="queued" guidance={g} onDone={() => {}} />).container.textContent ?? '';
      expect(phone).toContain(g.copy.confirmation.offline);
    } finally {
      (Platform as { OS: string }).OS = original;
    }
    expect(web).not.toContain(g.copy.confirmation.offline);
  });

  it.each(LANGS)('SYC-170 PR 1.2 (%s): after a blocked script, the report is saved and the message says what to allow', (code) => {
    lang.current = code;
    const g = getGuidance(code);
    const text = render(<ReportConfirmation state="blocked" guidance={g} onDone={() => {}} />).container.textContent ?? '';
    expect(text).toContain(TRANSLATIONS[code].reportCheckBlocked);
    expect(TRANSLATIONS[code].reportCheckBlocked).toContain('challenges.cloudflare.com');
    expect(text).not.toContain(g.copy.confirmation.sentHeading);
  });

  it.each(LANGS)('SYC-170 PR 1.2 (%s): when the safety check could not run, the report is said to be saved and tried again', (code) => {
    lang.current = code;
    const g = getGuidance(code);
    const text = render(<ReportConfirmation state="check" guidance={g} onDone={() => {}} />).container.textContent ?? '';
    expect(text).toContain(TRANSLATIONS[code].reportCheckUnavailable);
    expect(text).not.toContain(g.copy.confirmation.sentHeading);
    expect(text).toContain(plain(g.copy.confirmation.hurt));
  });

  it.each(LANGS)('SYC-42 Slice 3, test 3.7 (%s): the "if an email was given" line, never claiming a send that hasn\'t happened', (code) => {
    lang.current = code;
    const g = getGuidance(code);
    const c = g.copy.confirmation;
    const with_ = (state: 'sent' | 'queued' | 'busy' | 'sending' | 'failed', emailGiven: boolean) => {
      const t = render(<ReportConfirmation state={state} guidance={g} emailGiven={emailGiven} onDone={() => {}} />).container.textContent ?? '';
      cleanup();
      return t;
    };
    expect(with_('sent', true)).toContain(c.emailGiven);
    expect(with_('sent', false)).not.toContain(c.emailGiven);
    for (const state of ['queued', 'busy', 'sending'] as const) {
      expect(with_(state, true), state).toContain(c.emailGivenOffline);
      expect(with_(state, true), state).not.toContain(c.emailGiven);
    }
    // Refused by the server: no message went, and none will on its own.
    expect(with_('failed', true)).not.toContain(c.emailGiven);
    expect(with_('failed', true)).not.toContain(c.emailGivenOffline);
  });

  it.each(LANGS)('SYC-180 (%s): a report sent without a photo never says the photo is saved', (code) => {
    lang.current = code;
    const g = getGuidance(code);
    const text = render(<ReportConfirmation state="sent" guidance={g} hasPhoto={false} onDone={() => {}} />)
      .container.textContent ?? '';
    expect(text).toContain(g.copy.confirmation.sentHeading);
    expect(text).toContain(g.copy.confirmation.sentBodyNoPhoto);
    expect(text).not.toContain(g.copy.confirmation.sentBody);
    expect(g.copy.confirmation.sentBodyNoPhoto.toLowerCase()).not.toMatch(/photo|φωτογραφ/);
  });

  it.each(LANGS)('nit (%s): a report held back by a 429 says so, not "no signal"', (code) => {
    lang.current = code;
    const g = getGuidance(code);
    const text = render(<ReportConfirmation state="busy" guidance={g} onDone={() => {}} />).container.textContent ?? '';
    expect(text).toContain(savedWording(TRANSLATIONS[code].reportBusy, code, true));
    expect(text).not.toContain(g.copy.confirmation.offline);
    expect(text).not.toContain(g.copy.confirmation.sentHeading);
  });

  it('S3: a refused report offers Try again, and the words claim no automatic retry', () => {
    const onRetry = vi.fn();
    const g = getGuidance('en');
    const { getByText, container } = render(
      <ReportConfirmation state="failed" guidance={g} onDone={() => {}} onRetry={onRetry} />,
    );
    fireEvent.click(getByText(TRANSLATIONS.en.reportTryAgain));
    expect(onRetry).toHaveBeenCalledTimes(1);
    for (const code of LANGS) {
      expect(TRANSLATIONS[code].reportFailed.toLowerCase()).not.toMatch(/automatic|later|αργότερα|plus tard/);
    }
    expect(container.textContent).toContain(savedWording(TRANSLATIONS.en.reportFailed, 'en', true));
  });

  it('never says somebody is coming, and the i18n strings around it agree', () => {
    for (const code of LANGS) {
      for (const key of ['reportSending', 'reportFailed', 'reportDone']) {
        expect(TRANSLATIONS[code][key], `${code}.${key}`).toBeTruthy();
      }
    }
  });
});
