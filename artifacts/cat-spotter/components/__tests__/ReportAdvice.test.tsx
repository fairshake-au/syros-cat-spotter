// @vitest-environment jsdom
/**
 * SYC-42 plan, Slice 1 items 1.9, 1.10 and 1.12; tests 20–23.
 * The advice renders from the real guidance file in all three languages.
 */
import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGuidance, type GuidanceLanguage } from '@workspace/welfare-guidance';
import { TRANSLATIONS } from '@/lib/i18n';

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

describe('UrgentAdvice (§5.3(b))', () => {
  it.each(LANGS)('test 21 (%s): leads with "send this", the how-to open on first use', (code) => {
    lang.current = code;
    const g = getGuidance(code);
    const { container } = render(<UrgentAdvice guidance={g} firstUse />);
    const text = container.textContent ?? '';
    // The lead is the first thing said.
    expect(text.trim().startsWith(plain(g.copy.urgent.send))).toBe(true);
    for (const step of g.copy.urgent.steps) expect(text).toContain(plain(step));
    expect(text).toContain(plain(g.copy.urgent.municipality));
  });

  it('test 21: collapsed after first use, and opens on tap', () => {
    const g = getGuidance('en');
    const { container, getByText } = render(<UrgentAdvice guidance={g} firstUse={false} />);
    expect(container.textContent).not.toContain(plain(g.copy.urgent.steps[1]!));
    fireEvent.click(getByText(g.copy.urgent.howToHeading));
    expect(container.textContent).toContain(plain(g.copy.urgent.steps[1]!));
  });

  it.each(LANGS)('test 22 (%s): the cage appears before any handling line', (code) => {
    lang.current = code;
    const g = getGuidance(code);
    const text = render(<UrgentAdvice guidance={g} firstUse />).container.textContent ?? '';
    const cage = text.indexOf(plain(g.copy.urgent.cage));
    const handling = text.indexOf(plain(g.copy.urgent.wontGoIn));
    expect(cage).toBeGreaterThan(-1);
    expect(handling).toBeGreaterThan(cage);
  });

  it('shows the vet list inside the urgent block, with no after-hours line in the block itself', () => {
    const g = getGuidance('en');
    const text = render(<UrgentAdvice guidance={g} firstUse />).container.textContent ?? '';
    expect(text).toContain('Cyclades Vets (George Maragkos)');
  });
});

describe('VetList (§5.7, item 1.10)', () => {
  it('tap-to-call for every number, after-hours labelled, map buttons, pin accuracy', () => {
    const g = getGuidance('en');
    const { container } = render(<VetList guidance={g} />);
    const links = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    for (const v of g.vets) {
      for (const p of v.phones) expect(links).toContain(`tel:${p.tel}`);
      expect(links).toContain(v.googleMapsUrl);
      expect(links).toContain(v.appleMapsUrl);
    }
    const text = container.textContent ?? '';
    expect(text).toContain(g.copy.vetList.phoneKinds.after_hours);
    expect(text).toContain(g.copy.vetList.pinLandmark);
    expect(text).toContain(g.copy.vetList.pinSearch);
    expect(links).toContain('tel:+302281361000');
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
    expect(queued).toContain(g.copy.confirmation.offline);
  });

  it('never says somebody is coming, and the i18n strings around it agree', () => {
    for (const code of LANGS) {
      for (const key of ['reportSending', 'reportFailed', 'reportDone']) {
        expect(TRANSLATIONS[code][key], `${code}.${key}`).toBeTruthy();
      }
    }
  });
});
