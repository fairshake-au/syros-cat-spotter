// @vitest-environment jsdom
/**
 * The questions on the reward screen, after the points (data spine PR 7;
 * cat-record-data-spine.md §4.4, §7): the ear-tip question with its example
 * photo, the food-and-water question, and the note only Syros Cats see.
 */
import React, { useState } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('expo-image', async () => {
  const R = await import('react');
  return { Image: () => R.createElement('span', { 'data-testid': 'example-image' }) };
});
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    foreground: '#111',
    mutedForeground: '#666',
    primary: '#c50',
    primaryForeground: '#fff',
    border: '#ddd',
    card: '#fff',
    muted: '#eee',
    input: '#ddd',
    background: '#fff',
    destructive: '#c00',
  }),
}));

import { SightingQuestions } from '../SightingQuestions';
import { NO_ANSWERS, type SightingAnswers } from '@/lib/sightingAnswers';
import { TRANSLATIONS, type Language } from '@/lib/i18n';

afterEach(cleanup);

const en = TRANSLATIONS.en;
const t = (key: string) => en[key] ?? key;

function Harness({
  askEarTip = true,
  onChange,
  examplePhoto,
  ...extra
}: {
  askEarTip?: boolean;
  onChange?: (a: SightingAnswers) => void;
  examplePhoto?: { uri: string } | null;
} & Partial<Pick<React.ComponentProps<typeof SightingQuestions>, 'show' | 'earTipState' | 'currentEarTipLabel'>>) {
  const [answers, setAnswers] = useState<SightingAnswers>(NO_ANSWERS);
  return (
    <SightingQuestions
      catName="Agatha"
      askEarTip={askEarTip}
      answers={answers}
      onChange={(patch) => {
        setAnswers((prev) => {
          const next = { ...prev, ...patch };
          onChange?.(next);
          return next;
        });
      }}
      t={t}
      {...(examplePhoto !== undefined ? { examplePhoto } : {})}
      {...extra}
    />
  );
}

const button = (c: HTMLElement, label: string) => {
  const match = Array.from(c.querySelectorAll('[role="button"]')).find(
    (el) => el.textContent?.trim() === label,
  );
  if (!match) throw new Error(`No button labelled ${label}`);
  return match as HTMLElement;
};

describe('SightingQuestions', () => {
  it('asks about the ear tip by name, with the three answers and Skip', () => {
    const { container, getByText } = render(<Harness />);
    expect(getByText(en.earTipQuestion!.replace('{name}', 'Agatha'))).toBeTruthy();
    for (const label of [en.earTipYes!, en.earTipNo!, en.earTipCantTell!, en.skip!]) {
      expect(button(container, label)).toBeTruthy();
    }
  });

  it('always explains a clip versus a tear in words', () => {
    const { container, getByText } = render(<Harness />);
    expect(container.querySelector('[data-testid="ear-tip-example"]')).not.toBeNull();
    expect(getByText(en.earTipExampleCaption!)).toBeTruthy();
  });

  // SYC-79: Syros Cats' photo arrived on 5 Oct 2026 and is the default.
  it("shows Syros Cats' example photo by default", () => {
    const { container } = render(<Harness />);
    expect(container.querySelector('[data-testid="example-image"]')).not.toBeNull();
  });

  it('with no photo, shows no photo and no placeholder', () => {
    const { container } = render(<Harness examplePhoto={null} />);
    expect(container.querySelector('[data-testid="example-image"]')).toBeNull();
    expect(container.textContent).not.toMatch(/placeholder|SYC-79/i);
  });

  it('shows the example photo once there is one', () => {
    const { container } = render(<Harness examplePhoto={{ uri: 'ear.jpg' }} />);
    expect(container.querySelector('[data-testid="example-image"]')).not.toBeNull();
  });

  it('says "clipped tip", never "notched", as the thing to look for', () => {
    expect(en.earTipQuestion).toMatch(/clipped/i);
    expect(en.earTipYes).toMatch(/clipped/i);
    expect(en.earTipQuestion).not.toMatch(/notch/i);
    expect(en.earTipYes).not.toMatch(/notch/i);
    expect(en.earTipUsuallyLeft).toMatch(/left/i);
  });

  it('asks which ear only after "Yes, clipped"', () => {
    const { container, queryByText } = render(<Harness />);
    expect(queryByText(en.earTipWhichEar!)).toBeNull();
    fireEvent.click(button(container, en.earTipYes!));
    expect(queryByText(en.earTipWhichEar!)).not.toBeNull();
    fireEvent.click(button(container, en.earTipNo!));
    expect(queryByText(en.earTipWhichEar!)).toBeNull();
  });

  it('records the answers it is given', () => {
    const onChange = vi.fn();
    const { container } = render(<Harness onChange={onChange} />);
    fireEvent.click(button(container, en.earTipYes!));
    fireEvent.click(button(container, en.earLeft!));
    fireEvent.click(button(container, en.foodWaterNo!));
    expect(onChange).toHaveBeenLastCalledWith({
      ...NO_ANSWERS,
      earTip: 'clipped',
      earSide: 'left',
      foodAndWater: 'no',
    });
  });

  it('tapping a chosen answer again clears it', () => {
    const onChange = vi.fn();
    const { container } = render(<Harness onChange={onChange} />);
    fireEvent.click(button(container, en.foodWaterYes!));
    fireEvent.click(button(container, en.foodWaterYes!));
    expect(onChange).toHaveBeenLastCalledWith(NO_ANSWERS);
  });

  it('Skip hides the ear-tip question and forgets any answer to it', () => {
    const onChange = vi.fn();
    const { container, queryByText } = render(<Harness onChange={onChange} />);
    fireEvent.click(button(container, en.earTipYes!));
    fireEvent.click(button(container, en.skip!));
    expect(queryByText(en.earTipQuestion!.replace('{name}', 'Agatha'))).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith(NO_ANSWERS);
  });

  it('does not ask about the ear tip when this spotter has already answered for this cat', () => {
    const { container, queryByText } = render(<Harness askEarTip={false} />);
    expect(queryByText(en.earTipQuestion!.replace('{name}', 'Agatha'))).toBeNull();
    expect(container.querySelector('[data-testid="ear-tip-example"]')).toBeNull();
    // The other two are still there.
    expect(queryByText(en.foodWaterQuestion!)).not.toBeNull();
    expect(queryByText(en.noteLabel!)).not.toBeNull();
  });

  it('says only Syros Cats see the note', () => {
    const { getByText } = render(<Harness />);
    expect(getByText(en.noteHint!)).toBeTruthy();
    expect(en.noteHint).toMatch(/Syros Cats/);
    expect(en.noteHint).not.toMatch(/the charity/i);
  });

  it('keeps what is typed in the note', () => {
    const onChange = vi.fn();
    const { container } = render(<Harness onChange={onChange} />);
    const box = container.querySelector('[data-testid="sighting-note"]') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'hiding under the blue boat' } });
    expect(onChange).toHaveBeenLastCalledWith({
      ...NO_ANSWERS,
      note: 'hiding under the blue boat',
    });
  });
});

describe('SightingQuestions on the cat page (SYC-117 part 2)', () => {
  it('shows only the questions still open', () => {
    const { queryByText } = render(<Harness show={{ foodAndWater: false, note: true }} />);
    expect(queryByText(en.foodWaterQuestion!)).toBeNull();
    expect(queryByText(en.noteLabel!)).not.toBeNull();
  });

  it('shows an earlier ear-tip answer, and offers to change it', () => {
    const onChange = vi.fn();
    const { container, getByText, queryByText } = render(
      <Harness earTipState="answered" currentEarTipLabel="No, looks whole" onChange={onChange} />,
    );
    expect(getByText(en.earTipYouSaid!.replace('{answer}', 'No, looks whole'))).toBeTruthy();
    // The answers aren't offered until the spotter chooses to change it.
    expect(queryByText(en.earTipYes!)).toBeNull();
    fireEvent.click(button(container, en.earTipChange!));
    fireEvent.click(button(container, en.earTipYes!));
    expect(onChange).toHaveBeenLastCalledWith({ ...NO_ANSWERS, earTip: 'clipped' });
  });

  it('once Syros Cats have checked it, says so and offers no change', () => {
    const { container, getByText } = render(<Harness earTipState="checked" />);
    expect(getByText(en.earTipChecked!)).toBeTruthy();
    expect(() => button(container, en.earTipChange!)).toThrow();
    expect(() => button(container, en.earTipYes!)).toThrow();
  });
});

describe('Question copy in every language', () => {
  const langs = Object.keys(TRANSLATIONS) as Language[];
  const keys = [
    'earTipQuestion',
    'earTipUsuallyLeft',
    'earTipExampleCaption',
    'earTipYes',
    'earTipNo',
    'earTipCantTell',
    'earTipWhichEar',
    'earLeft',
    'earRight',
    'earNotSure',
    'skip',
    'foodWaterQuestion',
    'foodWaterYes',
    'foodWaterNo',
    'foodWaterCantTell',
    'noteLabel',
    'notePlaceholder',
    'noteHint',
    'answersSend',
    'answersFailed',
    'answersContinueWithout',
    'moreToAddOne',
    'moreToAddMany',
    'moreToAddAsk',
    'moreToAddButton',
    'moreToAddSheetTitle',
    'earTipYouSaid',
    'earTipChange',
    'earTipChecked',
  ];

  it.each(langs)('has every question string (%s)', (lang) => {
    for (const key of keys) {
      expect(TRANSLATIONS[lang][key]?.trim(), `${lang}.${key}`).toBeTruthy();
    }
  });
});
