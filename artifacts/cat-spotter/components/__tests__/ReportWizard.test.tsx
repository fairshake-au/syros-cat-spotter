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
import { INITIAL_FLOW, catIdOf, type ReportFlow } from '@/lib/reportFlow';

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
  // `onError` is exposed so a test can say the picture never loaded.
  return {
    Image: ({ source, onError }: { source?: { uri?: string }; onError?: () => void }) => (
      <View testID="photo-thumb" aria-label={source?.uri} {...({ onClick: onError } as object)} />
    ),
  };
});
vi.mock('@/lib/urls', () => ({ photoSource: (p: string | null) => (p ? { uri: `https://api.test${p}` } : {}) }));
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
  const onSend = vi.fn(async (_flow: ReportFlow) => undefined);
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
  // "Next", or "Next: send your report" on Call a vet now (SYC-570).
  const next = () =>
    fireEvent.click(within(utils.getByTestId('report-footer')).getByText(new RegExp(`^(${T.reportNext}|${T.reportNextSend})$`)));
  return { ...utils, onDraft, onSend, onClose, text, next };
}

afterEach(() => {
  cleanup();
  lang.current = 'en';
});

describe('ReportWizard', () => {
  it('runs Where (1 of 3) → How bad (2 of 3) → Before you send (3 of 3) for Needs attention', () => {
    const w = setup();
    expect(w.text()).toContain(T.reportWhereTitle);
    expect(w.text()).toContain(T.reportStepOf.replace('{n}', '1').replace('{total}', '3'));
    expect(w.getByTestId('location-picker')).toBeTruthy();
    w.next();
    expect(w.text()).toContain(T.reportHowBadTitle);
    expect(w.text()).toContain(T.reportStepOf.replace('{n}', '2').replace('{total}', '3'));
    fireEvent.click(w.getByTestId('severity-attention'));
    w.next();
    expect(w.text()).toContain(T.reportBeforeSendTitle);
    expect(w.text()).toContain(T.reportStepOf.replace('{n}', '3').replace('{total}', '3'));
  });

  it('SYC-570: Urgent runs Where → How bad → Call a vet now (3 of 4) → Before you send (4 of 4)', () => {
    const w = setup();
    w.next();
    fireEvent.click(w.getByTestId('severity-urgent'));
    expect(w.text()).toContain(T.reportStepOf.replace('{n}', '2').replace('{total}', '4'));
    w.next();
    expect(w.text()).toContain(T.reportCallVetTitle);
    expect(w.text()).toContain(T.reportStepOf.replace('{n}', '3').replace('{total}', '4'));
    // Nothing between the choice and the numbers: the lead, the cage line and the three clinics.
    const scroll = w.getByTestId('report-scroll').textContent ?? '';
    expect(scroll).toContain(plain(g.copy.urgent.intro));
    expect(scroll).toContain(plain(g.copy.urgent.cage));
    for (const clinic of g.vets) for (const phone of clinic.phones) expect(scroll).toContain(phone.display);
    // Send is the second step: the pinned button here says Next, never Send.
    expect(within(w.getByTestId('report-footer')).queryByText(T.reportSendReport)).toBeNull();
    w.next();
    expect(w.text()).toContain(T.reportBeforeSendTitle);
    expect(w.text()).toContain(T.reportStepOf.replace('{n}', '4').replace('{total}', '4'));
    fireEvent.click(w.getByLabelText(T.back));
    expect(w.text()).toContain(T.reportCallVetTitle);
  });

  it('SYC-570: Needs attention never shows Call a vet now, but its last screen lists the vets', () => {
    const w = setup();
    w.next();
    fireEvent.click(w.getByTestId('severity-attention'));
    w.next();
    expect(w.text()).not.toContain(T.reportCallVetTitle);
    const scroll = w.getByTestId('report-scroll').textContent ?? '';
    for (const clinic of g.vets) for (const phone of clinic.phones) expect(scroll).toContain(phone.display);
  });

  it('SYC-570: with the phone near Cyclades Vets that clinic is first and tagged closest, on every vet list; with no fix nothing is tagged', () => {
    const cyclades = g.vets.find((v) => v.id === 'cyclades-vets')!.coordinates!;
    const near = { latitude: cyclades.lat, longitude: cyclades.lng };
    const w = setup({ gps: { coords: near, locating: false, denied: false }, initial: { ...INITIAL_FLOW, step: 2, coords: near } });
    fireEvent.click(w.getByTestId('severity-urgent'));
    w.next();
    expect(w.getAllByTestId('vet-closest')).toHaveLength(1);
    expect(w.getByTestId('vet-closest').textContent).toContain('Cyclades Vets');
    expect(w.getByTestId('vet-closest').textContent).toContain(T.reportClosestToYou);
    expect(w.text()).toContain(T.reportVetsClosest);
    w.next();
    expect(w.getByTestId('vet-closest').textContent).toContain('Cyclades Vets');
    cleanup();

    const none = setup({ gps: { coords: null, locating: false, denied: true }, initial: { ...INITIAL_FLOW, step: 2, coords: here } });
    fireEvent.click(none.getByTestId('severity-urgent'));
    none.next();
    expect(none.queryByTestId('vet-closest')).toBeNull();
    expect(none.text()).not.toContain(T.reportClosestToYou);
    expect(none.text()).not.toContain(T.reportVetsClosest);
  });

  it('screen 1: Next waits for a location', () => {
    const w = setup({ gps: { coords: null, locating: true, denied: false } });
    w.next();
    expect(w.text()).toContain(T.reportStepOf.replace('{n}', '1').replace('{total}', '3'));
  });

  it('S4: with no GPS, the pin starts in Ermoupoli and Next waits until the person moves it', () => {
    const w = setup({ gps: { coords: null, locating: false, denied: true } });
    expect(w.getByTestId('location-picker')).toBeTruthy();
    expect(w.text()).toContain(T.reportMovePin);
    w.next();
    expect(w.text()).toContain(T.reportStepOf.replace('{n}', '1').replace('{total}', '3'));
    fireEvent.click(w.getByTestId('location-picker'));
    expect(w.text()).not.toContain(T.reportMovePin);
    w.next();
    expect(w.text()).toContain(T.reportStepOf.replace('{n}', '2').replace('{total}', '3'));
  });

  it('S4: with a GPS fix, Next is available straight away (the pin is where the phone is)', () => {
    const w = setup();
    expect(w.text()).not.toContain(T.reportMovePin);
    w.next();
    expect(w.text()).toContain(T.reportStepOf.replace('{n}', '2').replace('{total}', '3'));
  });

  it('screen 2: Next waits for a severity; kittens advice shows when ticked with Needs attention', () => {
    const w = setup({ initial: { ...INITIAL_FLOW, step: 2, coords: here } });
    w.next();
    expect(w.text()).toContain(T.reportStepOf.replace('{n}', '2').replace('{total}', '3'));
    fireEvent.click(w.getByTestId('severity-attention'));
    fireEvent.click(w.getByTestId('litter-checkbox'));
    expect(w.text()).toContain(g.copy.litter.heading);
    w.next();
    expect(w.text()).toContain(g.copy.attention.heading);
    expect(w.text()).not.toContain(g.copy.litter.withUrgent);
  });

  it('kittens + Urgent (Samuel, 2 Oct 2026): the urgent advice wins; no "don\'t move them" message, one line on screen 3', () => {
    const w = setup({ initial: { ...INITIAL_FLOW, step: 2, coords: here } });
    fireEvent.click(w.getByTestId('severity-urgent'));
    fireEvent.click(w.getByTestId('litter-checkbox'));
    expect(w.text()).not.toContain(g.copy.litter.heading);
    for (const p of g.copy.litter.paragraphs) expect(w.text()).not.toContain(plain(p));
    w.next();
    w.next();
    const scroll = w.getByTestId('report-scroll').textContent ?? '';
    expect(scroll).toContain(g.copy.litter.withUrgent);
    expect(scroll).not.toContain(g.copy.litter.heading);
    // Above the urgent advice, outside the locked block.
    expect(scroll.indexOf(g.copy.litter.withUrgent)).toBeLessThan(scroll.indexOf(plain(g.copy.urgent.intro)));
    // Back to screen 2 and switch to Needs attention: the full kittens message returns.
    fireEvent.click(w.getByLabelText(T.back));
    fireEvent.click(w.getByLabelText(T.back));
    fireEvent.click(w.getByTestId('severity-attention'));
    expect(w.text()).toContain(g.copy.litter.heading);
  });

  it('kittens with no severity chosen yet: the kittens message waits for Needs attention', () => {
    const w = setup({ initial: { ...INITIAL_FLOW, step: 2, coords: here } });
    fireEvent.click(w.getByTestId('litter-checkbox'));
    expect(w.text()).not.toContain(g.copy.litter.heading);
  });

  it('screen 3 (urgent): lead first, folds closed, the capacity paragraph visible and last, Send pinned', () => {
    const w = setup({ initial: { ...INITIAL_FLOW, step: 4, coords: here, severity: 'urgent' } });
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
    expect(w.text()).toContain(T.reportStepOf.replace('{n}', '2').replace('{total}', '4'));
    expect(w.getByTestId('severity-urgent').getAttribute('aria-checked')).toBe('true');
    expect(w.getByTestId('litter-checkbox').getAttribute('aria-checked')).toBe('true');
    expect((w.getByTestId('report-note') as HTMLTextAreaElement).value).toBe('by the bakery');
    fireEvent.click(w.getByLabelText(T.back));
    expect(w.text()).toContain(T.reportStepOf.replace('{n}', '1').replace('{total}', '4'));
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

describe('SYC-42 Slice 3: "Shall we tell you what happens?" (email-capture.md §3.4; its own screen, Samuel 15 Oct 2026)', () => {
  const nextIn = (w: ReturnType<typeof setup>) =>
    fireEvent.click(
      within(w.getByTestId('report-footer')).getByText(
        new RegExp(`^(${TRANSLATIONS[lang.current].reportNext}|${TRANSLATIONS[lang.current].reportNextSend})$`),
      ),
    );
  const toEmailScreen = (w: ReturnType<typeof setup>) => {
    nextIn(w);
    fireEvent.click(w.getByTestId('severity-attention'));
    nextIn(w);
  };
  const stepOf = (n: number, total: number) =>
    TRANSLATIONS[lang.current].reportStepOf.replace('{n}', String(n)).replace('{total}', String(total));

  it('the answer arriving after the flow opens still adds the screen (before How bad is left)', () => {
    const w = setup();
    expect(w.text()).toContain(stepOf(1, 3));
    w.rerender(
      <ReportWizard
        guidance={g}
        initial={INITIAL_FLOW}
        gps={{ coords: here, locating: false, denied: false }}
        onChoosePhoto={async () => null}
        onDraft={w.onDraft}
        onSend={w.onSend}
        onClose={w.onClose}
        sending={false}
        offerEmail
      />,
    );
    expect(w.text()).toContain(stepOf(1, 4));
  });

  it('not offered: the flow is the three screens, and no screen asks', () => {
    const w = setup();
    expect(w.text()).toContain(stepOf(1, 3));
    toEmailScreen(w);
    expect(w.text()).toContain(T.reportBeforeSendTitle);
    expect(w.text()).toContain(stepOf(3, 3));
    expect(w.queryByTestId('report-email-ask')).toBeNull();
  });

  it('SYC-570: offered and Urgent, the vets come before the email question: 3 of 5, then 4 of 5, then 5 of 5', () => {
    const w = setup({ offerEmail: true });
    nextIn(w);
    fireEvent.click(w.getByTestId('severity-urgent'));
    expect(w.text()).toContain(stepOf(2, 5));
    nextIn(w);
    expect(w.text()).toContain(T.reportCallVetTitle);
    expect(w.text()).toContain(stepOf(3, 5));
    nextIn(w);
    expect(w.getByTestId('report-email-ask')).toBeTruthy();
    expect(w.text()).toContain(stepOf(4, 5));
    nextIn(w);
    expect(w.text()).toContain(T.reportBeforeSendTitle);
    expect(w.text()).toContain(stepOf(5, 5));
  });

  it('offered: Where → How bad → Shall we tell you what happens? (3 of 4) → Before you send (4 of 4); nothing on How bad', () => {
    const w = setup({ offerEmail: true });
    expect(w.text()).toContain(stepOf(1, 4));
    nextIn(w);
    fireEvent.click(w.getByTestId('severity-attention'));
    fireEvent.click(w.getByTestId('litter-checkbox'));
    expect(w.queryByTestId('report-email-ask')).toBeNull();
    nextIn(w);
    expect(w.text()).toContain(T.reportEmailScreenTitle);
    expect(w.text()).toContain(stepOf(3, 4));
    expect(w.getByTestId('report-email-ask')).toBeTruthy();
    nextIn(w);
    expect(w.text()).toContain(T.reportBeforeSendTitle);
    expect(w.text()).toContain(stepOf(4, 4));
    fireEvent.click(w.getByLabelText(T.back));
    expect(w.text()).toContain(stepOf(3, 4));
  });

  it.each(['en', 'el', 'fr'] as const)('(%s) shows the consent wording, anonymous by default; the box appears only on "Yes"', (code) => {
    lang.current = code;
    const t = TRANSLATIONS[code];
    const w = setup({ offerEmail: true });
    toEmailScreen(w);
    const ask = w.getByTestId('report-email-ask');
    // The whole question, in the screen itself, never cut off in the header.
    expect(ask.textContent).toContain(t.reportEmailTitle);
    expect(ask.textContent).toContain(t.reportEmailBody);
    expect(ask.textContent).toContain(t.reportEmailYes);
    expect(ask.textContent).toContain(t.reportEmailNo);
    expect(w.getByTestId('report-email-no').getAttribute('aria-checked')).toBe('true');
    expect(w.queryByTestId('report-email')).toBeNull();
    fireEvent.click(w.getByTestId('report-email-yes'));
    expect(w.getByTestId('report-email')).toBeTruthy();
    expect(ask.textContent).toContain(t.reportEmailCheck);
  });

  it('English is email-capture.md §3.4 word for word', () => {
    expect(T.reportEmailTitle).toBe('Shall we tell you what happens?');
    expect(T.reportEmailBody).toBe(
      "Syros Cats will see this report. If you leave an email we'll confirm we've got it, and write once more when there's an outcome. It's used for this report and nothing else.",
    );
    expect(T.reportEmailYes).toBe('Yes, keep me updated');
    expect(T.reportEmailNo).toBe('No, send it anonymously');
  });

  it('a mistyped address is pointed out but never blocks the report', () => {
    const w = setup({ offerEmail: true });
    toEmailScreen(w);
    fireEvent.click(w.getByTestId('report-email-yes'));
    fireEvent.change(w.getByTestId('report-email'), { target: { value: 'not-an-address' } });
    expect(w.getByTestId('report-email-invalid')).toBeTruthy();
    nextIn(w);
    expect(w.text()).toContain(T.reportBeforeSendTitle);
  });

  it('what they chose reaches Send', async () => {
    const w = setup({ offerEmail: true });
    toEmailScreen(w);
    fireEvent.click(w.getByTestId('report-email-yes'));
    fireEvent.change(w.getByTestId('report-email'), { target: { value: 'me@example.org' } });
    nextIn(w);
    fireEvent.click(within(w.getByTestId('report-footer')).getByText(T.reportSendReport));
    expect(w.onSend).toHaveBeenCalledWith(expect.objectContaining({ wantsUpdates: true, email: 'me@example.org' }));
  });
});

describe('SYC-504: "About {name}" on Where only', () => {
  const tigris = { id: 7, name: 'Tigris', photoUrl: '/api/photos/ph-1' };
  const withCat = { ...INITIAL_FLOW, cat: tigris };

  it('Where shows the strip: the name line, the photo through photoSource, and the link', () => {
    const w = setup({ initial: withCat });
    expect(w.getByTestId('report-cat-strip')).toBeTruthy();
    expect(w.getByTestId('report-cat-about').textContent).toBe(T.reportAboutCat.replace('{name}', 'Tigris'));
    expect(w.getByTestId('photo-thumb').getAttribute("aria-label")).toBe('https://api.test/api/photos/ph-1');
    const link = w.getByTestId('report-cat-different');
    expect(link.textContent).toBe(T.reportDifferentCat);
    expect(link.getAttribute('role')).toBe('button');
    expect(link.getAttribute('aria-label')).toBe(T.reportDifferentCat);
  });

  it('no strip without a cat', () => {
    const w = setup();
    expect(w.queryByTestId('report-cat-strip')).toBeNull();
  });

  it('How bad, Email and Before you send do not show it', () => {
    const w = setup({ initial: withCat, offerEmail: true });
    w.next();
    expect(w.text()).toContain(T.reportHowBadTitle);
    expect(w.queryByTestId('report-cat-strip')).toBeNull();
    fireEvent.click(w.getByTestId('severity-urgent'));
    w.next();
    expect(w.queryByTestId('report-cat-strip')).toBeNull();
    w.next();
    w.next();
    expect(w.text()).toContain(T.reportBeforeSendTitle);
    expect(w.queryByTestId('report-cat-strip')).toBeNull();
    expect(w.text()).not.toContain('Tigris');
  });

  it('with no photo (the report-issue sheet hands none) the paw shows and no image is requested', () => {
    const w = setup({ initial: { ...INITIAL_FLOW, cat: { ...tigris, photoUrl: null } } });
    expect(w.getByTestId('report-cat-paw')).toBeTruthy();
    expect(w.queryByTestId('photo-thumb')).toBeNull();
  });

  it('a picture that fails to load is dropped, leaving the paw; the line is already there', () => {
    const w = setup({ initial: withCat });
    expect(w.getByTestId('report-cat-paw')).toBeTruthy();
    fireEvent.click(w.getByTestId('photo-thumb'));
    expect(w.queryByTestId('photo-thumb')).toBeNull();
    expect(w.getByTestId('report-cat-paw')).toBeTruthy();
    expect(w.getByTestId('report-cat-about')).toBeTruthy();
  });

  it('"It\'s a different cat" removes the strip, and it stays gone after Next then Back', () => {
    const w = setup({ initial: withCat });
    fireEvent.click(w.getByTestId('report-cat-different'));
    expect(w.queryByTestId('report-cat-strip')).toBeNull();
    w.next();
    fireEvent.click(within(w.container).getByLabelText(T.back));
    expect(w.text()).toContain(T.reportWhereTitle);
    expect(w.queryByTestId('report-cat-strip')).toBeNull();
  });

  it('Back keeps the cat when it was not cleared', () => {
    const w = setup({ initial: withCat });
    w.next();
    fireEvent.click(within(w.container).getByLabelText(T.back));
    expect(w.getByTestId('report-cat-strip')).toBeTruthy();
  });

  it('clearing the cat after a draft was written writes a new draft with no cat', () => {
    vi.useFakeTimers();
    try {
      const w = setup({ initial: withCat });
      w.next();
      fireEvent.click(w.getByTestId('severity-urgent'));
      vi.advanceTimersByTime(2000);
      expect(w.onDraft).toHaveBeenCalledTimes(1);
      expect(catIdOf(w.onDraft.mock.calls[0]![0])).toBe(7);
      fireEvent.click(within(w.container).getByLabelText(T.back));
      fireEvent.click(w.getByTestId('report-cat-different'));
      vi.advanceTimersByTime(2000);
      expect(w.onDraft).toHaveBeenCalledTimes(2);
      expect(catIdOf(w.onDraft.mock.calls[1]![0])).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Send report hands over the cat still on the flow, or none once cleared', () => {
    const w = setup({ initial: { ...withCat, step: 3, coords: here, severity: 'attention' } });
    fireEvent.click(within(w.getByTestId('report-footer')).getByText(T.reportSendReport));
    expect(catIdOf(w.onSend.mock.calls[0]![0])).toBe(7);
  });
});
