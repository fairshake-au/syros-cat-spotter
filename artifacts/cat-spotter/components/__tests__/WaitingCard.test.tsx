// @vitest-environment jsdom
/**
 * SYC-48 / SYC-36 (match-wait plan PR 1): the waiting card. A fact under
 * "While we look…", the ear-tip fact with its photo, the nudge's words with no
 * buttons, and one short screen-reader line when it appears.
 */
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const announce = vi.hoisted(() => vi.fn());
vi.mock('react-native', async () => {
  const actual = await vi.importActual<typeof import('react-native')>('react-native');
  return {
    ...actual,
    AccessibilityInfo: { ...actual.AccessibilityInfo, announceForAccessibility: announce },
  };
});
vi.mock('expo-image', async () => {
  const R = await import('react');
  return { Image: (p: { testID?: string }) => R.createElement('span', { 'data-testid': p.testID }) };
});
vi.mock('react-native-svg', async () => (await import('./helpers/waitingCatsMocks')).svgMock());
vi.mock('react-native-reanimated', async () => (await import('./helpers/waitingCatsMocks')).reanimatedMock());
// The error boundary's default fallback pulls in icons and expo; the card
// always passes its own empty fallback, so stub the module out.
vi.mock('@/components/ErrorFallback', () => ({ ErrorFallback: () => null }));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ foreground: '#111', mutedForeground: '#666', border: '#ddd', card: '#fff' }),
}));

const topicCatBoom = vi.hoisted(() => ({ on: false }));
vi.mock('@/components/waitingCats/TopicCat', async () => {
  const actual: any = await vi.importActual('@/components/waitingCats/TopicCat');
  return {
    ...actual,
    TopicCat: (p: { strand: 1 | 2 | 3 | 4 | 5 | 6; size?: number }) => {
      if (topicCatBoom.on) throw new Error('cannot draw');
      return actual.TopicCat(p);
    },
  };
});

import { WaitingCard } from '../WaitingCard';
import { TRANSLATIONS } from '@/lib/i18n';

afterEach(() => {
  cleanup();
  announce.mockClear();
});

const t = (key: string) => TRANSLATIONS.en[key] ?? key;
const photo = { uri: 'ear-tip.jpg' };

describe('WaitingCard', () => {
  it('a fact: the eyebrow and the fact\'s words, no photo, no buttons', () => {
    const { getByText, queryByTestId, container } = render(
      <WaitingCard choice={{ kind: 'fact', id: 'fact.milk' }} t={t} examplePhoto={photo} />,
    );
    expect(getByText('WHILE WE LOOK…')).toBeTruthy();
    expect(getByText(TRANSLATIONS.en['fact.milk']!)).toBeTruthy();
    expect(queryByTestId('waiting-card-photo')).toBeNull();
    expect(container.querySelectorAll('button, [role="button"]')).toHaveLength(0);
  });

  it('the ear-tip fact shows the example photo', () => {
    const { getByTestId } = render(
      <WaitingCard choice={{ kind: 'fact', id: 'fact.earTip' }} t={t} examplePhoto={photo} />,
    );
    expect(getByTestId('waiting-card-photo')).toBeTruthy();
  });

  it('announces one short line, once', () => {
    const { rerender } = render(<WaitingCard choice={{ kind: 'fact', id: 'fact.milk' }} t={t} />);
    rerender(<WaitingCard choice={{ kind: 'fact', id: 'fact.milk' }} t={t} />);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('While we look, a cat fact');
  });

  it('the Greek eyebrow drops its accents in capitals (SYC-159)', () => {
    const el = (key: string) => TRANSLATIONS.el[key] ?? key;
    const { getByText } = render(<WaitingCard choice={{ kind: 'fact', id: 'fact.milk' }} t={el} />);
    expect(getByText('ΟΣΟ ΨΑΧΝΟΥΜΕ…')).toBeTruthy();
  });

  it('every fact switched off: only the eyebrow', () => {
    const { getByText, queryByTestId } = render(<WaitingCard choice={{ kind: 'empty' }} t={t} />);
    expect(getByText('WHILE WE LOOK…')).toBeTruthy();
    expect(queryByTestId('waiting-card-fact')).toBeNull();
  });

  it('the nudge in the wait: words only, with the figures when the link is on (nudge spec test 1)', () => {
    const { getByText, container } = render(
      <WaitingCard choice={{ kind: 'nudge', form: 'link', countable: true }} t={t} />,
    );
    expect(getByText('Thinking of sharing your lunch?')).toBeTruthy();
    expect(getByText(TRANSLATIONS.en.feedNudgeEuro!)).toBeTruthy();
    expect(container.querySelectorAll('button, [role="button"]')).toHaveLength(0);
    expect(announce).toHaveBeenCalledWith('Why not to feed the cats');
  });

  it('the no-link nudge has no figures and no pointer to another tab (nudge spec test 16)', () => {
    const { queryByText, getByText } = render(
      <WaitingCard choice={{ kind: 'nudge', form: 'noLink', countable: false }} t={t} />,
    );
    expect(queryByText(TRANSLATIONS.en.feedNudgeEuro!)).toBeNull();
    expect(getByText(TRANSLATIONS.en.feedNudgeInsteadNoLink!)).toBeTruthy();
    expect(TRANSLATIONS.en.feedNudgeInsteadNoLink).not.toMatch(/tab/i);
  });

  // SYC-772 (spec §3.1)
  it.each([
    ['fact.tortie', 'Reading a cat'],
    ['fact.colonyFemales', 'Life in a colony'],
    ['fact.litters', 'Why sterilisation works'],
    ['fact.milk', 'Being around a street cat'],
    ['fact.kittensAlone', 'When a cat needs help'],
    ['fact.cantTell', "You're doing science"],
  ])('%s shows its topic: %s', (id, name) => {
    const { getByText, getByTestId } = render(<WaitingCard choice={{ kind: 'fact', id }} t={t} />);
    expect(getByText(name)).toBeTruthy();
    expect(getByTestId('waiting-card-topic')).toBeTruthy();
    expect(getByText(TRANSLATIONS.en[id]!)).toBeTruthy();
  });

  it('a fact with no topic shows no topic row', () => {
    const { queryByTestId, getByText } = render(
      <WaitingCard choice={{ kind: 'fact', id: 'fact.new.bcdfghjk' }} t={t} />,
    );
    expect(queryByTestId('waiting-card-topic')).toBeNull();
    expect(getByText('WHILE WE LOOK…')).toBeTruthy();
  });

  it('shows the progress words when progress is passed', () => {
    const { getByText } = render(
      <WaitingCard
        choice={{ kind: 'fact', id: 'fact.milk' }}
        progress={{ kind: 'count', n: 3, total: 11, walkFrom: 2 }}
        t={t}
      />,
    );
    expect(getByText(/3/)).toBeTruthy();
    expect(getByText(/11/)).toBeTruthy();
  });

  it('shows no progress words without progress', () => {
    const { queryByText } = render(<WaitingCard choice={{ kind: 'fact', id: 'fact.milk' }} t={t} />);
    expect(queryByText(/ of 11/)).toBeNull();
  });

  it('the nudge and the empty card get no topic and no progress', () => {
    const progress = { kind: 'count', n: 3, total: 11, walkFrom: 2 } as const;
    const a = render(<WaitingCard choice={{ kind: 'nudge', form: 'link', countable: true }} progress={progress} t={t} />);
    expect(a.queryByTestId('waiting-card-topic')).toBeNull();
    expect(a.queryByText(/of 11/)).toBeNull();
    a.unmount();
    const b = render(<WaitingCard choice={{ kind: 'empty' }} progress={progress} t={t} />);
    expect(b.queryByTestId('waiting-card-topic')).toBeNull();
    expect(b.queryByText(/of 11/)).toBeNull();
  });

  it('the announcement is unchanged by the topic and progress', () => {
    render(
      <WaitingCard
        choice={{ kind: 'fact', id: 'fact.milk' }}
        progress={{ kind: 'count', n: 3, total: 11, walkFrom: 2 }}
        t={t}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('While we look, a cat fact');
  });

  it('Greek strand 4 name renders', () => {
    const el = (key: string) => TRANSLATIONS.el[key] ?? key;
    const { getByText } = render(<WaitingCard choice={{ kind: 'fact', id: 'fact.milk' }} t={el} />);
    expect(getByText(TRANSLATIONS.el.factTopic4!)).toBeTruthy();
  });

  it('a picture that throws still leaves the topic name and the fact', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    topicCatBoom.on = true;
    try {
      const { getByText } = render(<WaitingCard choice={{ kind: 'fact', id: 'fact.milk' }} t={t} />);
      expect(getByText('Being around a street cat')).toBeTruthy();
      expect(getByText(TRANSLATIONS.en['fact.milk']!)).toBeTruthy();
    } finally {
      topicCatBoom.on = false;
      spy.mockRestore();
    }
  });
});
