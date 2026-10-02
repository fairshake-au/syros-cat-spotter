// @vitest-environment jsdom
/**
 * SYC-42 Slice 1, Samuel's 2 Oct 2026 change: three screens, no scrolling.
 * Where → How bad → Before you send, a "1 of 3" indicator, a back arrow on
 * every screen, Next pinned on screens 1–2 and "Send report" pinned on 3.
 */
import React from 'react';
import { render, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGuidance } from '@workspace/welfare-guidance';
import { TRANSLATIONS } from '@/lib/i18n';
import { INITIAL_FLOW } from '@/lib/reportFlow';

const lang = vi.hoisted(() => ({ current: 'en' as 'en' | 'el' | 'fr' }));

vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS: T } = await import('@/lib/i18n');
  return {
    useLanguage: () => ({ language: lang.current, t: (key: string) => T[lang.current][key] ?? key }),
  };
});
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('expo-image', async () => {
  const { View } = await import('react-native');
  return { Image: () => <View testID="photo-thumb" /> };
});
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#fff', foreground: '#000', mutedForeground: '#666', card: '#fff', border: '#ddd',
    primary: '#123', primaryForeground: '#fff', accent: '#a00', destructive: '#c00',
  }),
}));
vi.mock('@/components/LocationPicker', async () => {
  const { Text } = await import('react-native');
  // A stand-in the test can "drag": tapping it moves the pin 50 m north.
  return {
    LocationPicker: ({ latitude, longitude, onChange }: {
      latitude: number; longitude: number; onChange: (c: { latitude: number; longitude: number }) => void;
    }) => (
      <Text testID="location-picker" onPress={() => onChange({ latitude: latitude + 0.00045, longitude })}>
        pin
      </Text>
    ),
  };
});
vi.mock('@/components/purropolis', async () => {
  const { Text } = await import('react-native');
  const Btn = ({ children, onPress, disabled, accessibilityLabel, label }: {
    children?: React.ReactNode; onPress?: () => void; disabled?: boolean; accessibilityLabel?: string; label?: string;
  }) => (
    <Text role="button" aria-disabled={!!disabled} aria-label={label ?? accessibilityLabel}
      onPress={disabled ? undefined : onPress}>
      {children}
    </Text>
  );
  return { Button: Btn, IconButton: Btn };
});

import { ReportWizard } from '../report/ReportWizard';

const T = TRANSLATIONS.en;
const g = getGuidance('en');
const plain = (s: string) => s.replace(/\*\*/g, '');
const here = { latitude: 37.444, longitude: 24.942 };

function setup(over: Partial<React.ComponentProps<typeof ReportWizard>> = {}) {
  const onDraft = vi.fn();
  const onSend = vi.fn(async () => undefined);
  const onClose = vi.fn();
  const utils = render(
    <ReportWizard
      guidance={g}
      initial={INITIAL_FLOW}
      gps={{ coords: here, locating: false, denied: false }}
      onChoosePhoto={async () => null}
      onDraft={onDraft}
      onSend={onSend}
      onClose={onClose}
      sending={false}
      {...over}
    />,
  );
  const text = () => utils.container.textContent ?? '';
  const next = () => fireEvent.click(within(utils.getByTestId('report-footer')).getByText(T.reportNext));
  return { ...utils, onDraft, onSend, onClose, text, next };
}

afterEach(() => {
  cleanup();
  lang.current = 'en';
});

describe('ReportWizard', () => {
  it('runs Where (1 of 3) → How bad (2 of 3) → Before you send (3 of 3)', () => {
    const w = setup();
    expect(w.text()).toContain(T.reportWhereTitle);
    expect(w.text()).toContain(T.reportStepOf.replace('{n}', '1'));
    expect(w.getByTestId('location-picker')).toBeTruthy();
    w.next();
    expect(w.text()).toContain(T.reportHowBadTitle);
    expect(w.text()).toContain(T.reportStepOf.replace('{n}', '2'));
    fireEvent.click(w.getByTestId('severity-urgent'));
    w.next();
    expect(w.text()).toContain(T.reportBeforeSendTitle);
    expect(w.text()).toContain(T.reportStepOf.replace('{n}', '3'));
  });

  it('screen 1: Next waits for a location', () => {
    const w = setup({ gps: { coords: null, locating: true, denied: false } });
    w.next();
    expect(w.text()).toContain(T.reportStepOf.replace('{n}', '1'));
  });

  it('S4: with no GPS, the pin starts in Ermoupoli and Next waits until the person moves it', () => {
    const w = setup({ gps: { coords: null, locating: false, denied: true } });
    expect(w.getByTestId('location-picker')).toBeTruthy();
    expect(w.text()).toContain(T.reportMovePin);
    w.next();
    expect(w.text()).toContain(T.reportStepOf.replace('{n}', '1'));
    fireEvent.click(w.getByTestId('location-picker'));
    expect(w.text()).not.toContain(T.reportMovePin);
    w.next();
    expect(w.text()).toContain(T.reportStepOf.replace('{n}', '2'));
  });

  it('S4: with a GPS fix, Next is available straight away (the pin is where the phone is)', () => {
    const w = setup();
    expect(w.text()).not.toContain(T.reportMovePin);
    w.next();
    expect(w.text()).toContain(T.reportStepOf.replace('{n}', '2'));
  });

  it('screen 2: Next waits for a severity; kittens advice shows when ticked', () => {
    const w = setup({ initial: { ...INITIAL_FLOW, step: 2, coords: here } });
    w.next();
    expect(w.text()).toContain(T.reportStepOf.replace('{n}', '2'));
    fireEvent.click(w.getByTestId('litter-checkbox'));
    expect(w.text()).toContain(g.copy.litter.heading);
    fireEvent.click(w.getByTestId('severity-attention'));
    w.next();
    expect(w.text()).toContain(g.copy.attention.heading);
  });

  it('screen 3 (urgent): lead first, folds closed, the capacity paragraph visible and last, Send pinned', () => {
    const w = setup({ initial: { ...INITIAL_FLOW, step: 3, coords: here, severity: 'urgent' } });
    const scroll = w.getByTestId('report-scroll').textContent ?? '';
    expect(scroll).toContain(plain(g.copy.urgent.intro));
    expect(scroll).not.toContain(plain(g.copy.urgent.steps[0]!));
    expect(scroll.trim().endsWith(plain(g.copy.urgent.capacity))).toBe(true);
    // "Send report" is in the pinned footer, never in the scrolling content.
    expect(within(w.getByTestId('report-footer')).getByText(T.reportSendReport)).toBeTruthy();
    expect(scroll).not.toContain(T.reportSendReport);
  });

  it('screens 1 and 2: Next is pinned, never in the scrolling content', () => {
    const w = setup();
    expect(within(w.getByTestId('report-footer')).getByText(T.reportNext)).toBeTruthy();
    expect(w.getByTestId('report-scroll').textContent).not.toContain(T.reportNext);
  });

  it('back keeps everything entered, and the arrow on screen 1 closes the flow', () => {
    const w = setup({ initial: { ...INITIAL_FLOW, step: 2, coords: here } });
    fireEvent.click(w.getByTestId('severity-urgent'));
    fireEvent.click(w.getByTestId('litter-checkbox'));
    fireEvent.change(w.getByTestId('report-note'), { target: { value: 'by the bakery' } });
    w.next();
    fireEvent.click(w.getByLabelText(T.back));
    expect(w.text()).toContain(T.reportStepOf.replace('{n}', '2'));
    expect(w.getByTestId('severity-urgent').getAttribute('aria-checked')).toBe('true');
    expect(w.getByTestId('litter-checkbox').getAttribute('aria-checked')).toBe('true');
    expect((w.getByTestId('report-note') as HTMLTextAreaElement).value).toBe('by the bakery');
    fireEvent.click(w.getByLabelText(T.back));
    expect(w.text()).toContain(T.reportStepOf.replace('{n}', '1'));
    fireEvent.click(w.getByLabelText(T.back));
    expect(w.onClose).toHaveBeenCalledTimes(1);
  });

  it('S3: the note box stops at 4000 characters, the server\'s cap', () => {
    const w = setup({ initial: { ...INITIAL_FLOW, step: 2, coords: here } });
    expect(w.getByTestId('report-note').getAttribute('maxlength')).toBe('4000');
  });

  it('writes the draft once location and severity are both set (spec §4.2)', () => {
    vi.useFakeTimers();
    try {
      const w = setup({ initial: { ...INITIAL_FLOW, step: 2, coords: here } });
      vi.advanceTimersByTime(2000);
      expect(w.onDraft).not.toHaveBeenCalled();
      fireEvent.click(w.getByTestId('severity-urgent'));
      vi.advanceTimersByTime(2000);
      expect(w.onDraft).toHaveBeenCalledTimes(1);
      expect(w.onDraft.mock.calls[0]![0]).toMatchObject({ severity: 'urgent', coords: here });
    } finally {
      vi.useRealTimers();
    }
  });

  it('Send report hands over everything entered', () => {
    const w = setup({ initial: { ...INITIAL_FLOW, step: 3, coords: here, severity: 'attention', isLitter: true, note: 'x' } });
    fireEvent.click(within(w.getByTestId('report-footer')).getByText(T.reportSendReport));
    expect(w.onSend).toHaveBeenCalledWith(expect.objectContaining({ severity: 'attention', isLitter: true, note: 'x', coords: here }));
  });

  it.each(['el', 'fr'] as const)('every label is translated (%s)', (code) => {
    lang.current = code;
    const w = setup();
    expect(w.text()).toContain(TRANSLATIONS[code].reportWhereTitle);
    expect(w.text()).not.toMatch(/report[A-Z]\w+/);
  });
});
