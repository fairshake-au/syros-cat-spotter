// @vitest-environment jsdom
/**
 * SYC-44 PR 6.2: the reason sheet (plan T6-4, T6-5 and T6-6 in the app, and
 * T6-8's web wording; spec §2, §4.1, §4.2, §13 tests 6, 14, 18 and 19).
 * English strings render as themselves through the real dictionary.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IssueReason, PendingIssue } from '@/lib/issueQueue';

const h = vi.hoisted(() => ({
  os: 'web' as string,
  language: 'en' as string,
  push: vi.fn(),
  queue: {
    submitIssue: vi.fn(async (_input: unknown) => 'L1'),
    retryFailed: vi.fn(async () => undefined),
    issues: [] as PendingIssue[],
    replies: new Map<string, { hidden: boolean }>(),
    syncing: false,
  },
}));

vi.mock('react-native', async () => {
  const rn = await vi.importActual<Record<string, unknown>>('react-native-web');
  const platform = rn.Platform as Record<string, unknown>;
  return {
    ...rn,
    Platform: new Proxy(platform, { get: (target, key) => (key === 'OS' ? h.os : target[key as string]) }),
    Modal: ({ visible, children }: { visible?: boolean; children?: React.ReactNode }) =>
      visible ? <div data-testid="mock-modal">{children}</div> : null,
  };
});
vi.mock('expo-image', () => ({ Image: () => null }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@/hooks/useColors', () => ({ useColors: () => new Proxy({}, { get: () => '#123456' }) }));
vi.mock('@/lib/urls', () => ({ photoSource: (p: string) => ({ uri: p }) }));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS: T } = await import('@/lib/i18n');
  return {
    useLanguage: () => ({
      language: h.language,
      t: (key: string) => (T as Record<string, Record<string, string>>)[h.language]![key] ?? key,
    }),
  };
});
vi.mock('@/context/IssueQueueContext', () => ({ useIssueQueue: () => h.queue }));

import { ReportIssueSheet } from '../report/ReportIssueSheet';
import { TRANSLATIONS } from '@/lib/i18n';
import { newPendingIssue } from '@/lib/issueQueue';

const en = TRANSLATIONS.en;
const onClose = vi.fn();

function catSheet(initialReason?: IssueReason) {
  return render(<ReportIssueSheet catId={7} catName="Agatha" initialReason={initialReason} onClose={onClose} />);
}
function photoSheet() {
  return render(<ReportIssueSheet catId={7} catName="Agatha" photoUrl="/api/photos/ph-abc" onClose={onClose} />);
}
const text = () => document.body.textContent ?? '';
const reasonIds = () =>
  Array.from(document.querySelectorAll('[data-testid^="issue-reason-"]')).map((e) =>
    e.getAttribute('data-testid')!.replace('issue-reason-', ''),
  );

/** Choose a reason, then Send (and for a hiding reason, Report and hide). */
async function report(reason: IssueReason) {
  fireEvent.click(screen.getByTestId(`issue-reason-${reason}`));
  fireEvent.click(screen.getByTestId('issue-send'));
  if (screen.queryByTestId('issue-report-and-hide')) fireEvent.click(screen.getByTestId('issue-report-and-hide'));
  await screen.findByTestId('issue-done');
}

/** Pretend the saved list now holds this report, as the provider would. */
function savedAs(reason: IssueReason, over: Partial<PendingIssue> = {}): PendingIssue {
  const item = { ...newPendingIssue({ reason, catId: 7, note: '', language: 'en' }), localId: 'L1', ...over };
  h.queue.issues = [item];
  return item;
}

beforeEach(() => {
  h.os = 'web';
  h.language = 'en';
  h.queue.issues = [];
  h.queue.replies = new Map();
  h.queue.syncing = false;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('T6-4: the reasons and the first line', () => {
  it('from the cat page: the cat reasons, in the spec\'s order (§3.1)', () => {
    catSheet();
    expect(reasonIds()).toEqual(['wrong_name', 'wrong_info', 'location_revealing', 'cat_died', 'wrong_cat', 'other']);
  });

  it('from a photo: the photo reasons first, then other (§3.2), and the narrow photo_private hint (D2)', () => {
    photoSheet();
    expect(reasonIds()).toEqual(['photo_private', 'photo_inappropriate', 'photo_not_cat', 'wrong_cat', 'other']);
    expect(screen.getByTestId('issue-hint-photo_private').textContent).toBe(
      'faces, house numbers, number plates, inside a home or garden',
    );
    expect(text()).not.toMatch(/doorway/i);
  });

  it('the first line links to "This cat needs help": it closes the sheet and opens the cat-in-trouble form', () => {
    catSheet();
    const first = screen.getByTestId('issue-hurt-first');
    expect(first.textContent).toBe(en.issueHurtFirst);
    expect(first.textContent).toContain(en.reportNeedsHelp);
    fireEvent.click(first);
    expect(onClose).toHaveBeenCalled();
    expect(h.push).toHaveBeenCalledWith('/report');
  });

  it('opened with wrong_info chosen, it skips the list and the box asks "What do you know?"', () => {
    catSheet('wrong_info');
    expect(screen.queryByTestId('issue-reason-wrong_name')).toBeNull();
    expect(screen.getByTestId('issue-chosen-reason').textContent).toBe(en.issueReason_wrong_info);
    expect(text()).toContain(en.issueNoteLabelWrongInfo);
  });

  it('chosen from the list, the box asks "Anything we should know?"', () => {
    catSheet();
    fireEvent.click(screen.getByTestId('issue-reason-wrong_info'));
    expect(text()).toContain(en.issueNoteLabel);
  });

  it('Greek capitals in the heading drop their accents (displayUpperCase, SYC-159)', () => {
    h.language = 'el';
    catSheet();
    expect(screen.getByTestId('issue-eyebrow').textContent).toBe('ΑΝΑΦΕΡΕ ΕΝΑ ΠΡΟΒΛΗΜΑ');
  });
});

describe('the confirm step (spec §4.1 step 3)', () => {
  it.each(['photo_private', 'photo_inappropriate'] as const)(
    '%s: Send shows the approved words first; nothing is saved until Report and hide',
    async (reason) => {
      photoSheet();
      fireEvent.click(screen.getByTestId(`issue-reason-${reason}`));
      fireEvent.change(screen.getByTestId('issue-note'), { target: { value: 'a child at the window' } });
      fireEvent.click(screen.getByTestId('issue-send'));
      expect(screen.getByTestId('issue-confirm-text').textContent).toBe(en.issueConfirm);
      expect(h.queue.submitIssue).not.toHaveBeenCalled();
      // Cancel goes back, still nothing sent.
      fireEvent.click(screen.getByTestId('issue-confirm-cancel'));
      expect(h.queue.submitIssue).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('issue-send'));
      fireEvent.click(screen.getByTestId('issue-report-and-hide'));
      await screen.findByTestId('issue-done');
      expect(h.queue.submitIssue).toHaveBeenCalledWith({
        reason,
        catId: 7,
        photoPublicId: 'ph-abc',
        note: 'a child at the window',
        language: 'en',
      });
    },
  );

  it('a reason that never hides sends straight away, with no confirm step', async () => {
    catSheet();
    fireEvent.click(screen.getByTestId('issue-reason-wrong_name'));
    fireEvent.click(screen.getByTestId('issue-send'));
    expect(screen.queryByTestId('issue-confirm-text')).toBeNull();
    await screen.findByTestId('issue-done');
    expect(h.queue.submitIssue).toHaveBeenCalledWith(expect.objectContaining({ reason: 'wrong_name', photoPublicId: null }));
  });
});

describe('T6-5: the confirmation comes from the server\'s `hidden`', () => {
  it('hidden: false on photo_private shows "not hidden yet", never the hidden text', async () => {
    photoSheet();
    h.queue.replies = new Map([['L1', { hidden: false }]]);
    await report('photo_private');
    expect(screen.getByTestId('issue-done-not-hidden').textContent).toBe(en.issueDoneNotHidden);
    expect(text()).not.toContain(en.issueDoneHidden);
  });

  it('hidden: true shows the hidden text', async () => {
    photoSheet();
    h.queue.replies = new Map([['L1', { hidden: true }]]);
    await report('photo_inappropriate');
    expect(screen.getByTestId('issue-done-hidden').textContent).toBe(en.issueDoneHidden);
  });

  it('any other reason gets the plain thank-you; "This cat has died" the gentle line', async () => {
    catSheet();
    h.queue.replies = new Map([['L1', { hidden: false }]]);
    await report('wrong_name');
    expect(screen.getByTestId('issue-done-thanks').textContent).toBe(en.issueDoneThanks);
    cleanup();
    catSheet();
    await report('cat_died');
    expect(screen.getByTestId('issue-done-died').textContent).toBe(en.issueDoneDied);
  });
});

describe('T6-6: offline it says saved, never hidden', () => {
  it('on the web: "Saved in this browser…", that a browser can clear it, and never "hidden"', async () => {
    photoSheet();
    savedAs('photo_private');
    await report('photo_private');
    const saved = screen.getByTestId('issue-done-saved').textContent;
    expect(saved).toBe('Saved in this browser. It will be sent when you have a connection.');
    expect(screen.getByTestId('issue-done-browser-note').textContent).toBe(en.issueSavedBrowserNote);
    expect(text()).not.toMatch(/hidden/i);
  });

  it('in the phone apps: "Saved on your phone…", with no browser line', async () => {
    h.os = 'ios';
    photoSheet();
    savedAs('photo_private');
    await report('photo_private');
    expect(screen.getByTestId('issue-done-saved').textContent).toBe(en.issueSaved);
    expect(screen.queryByTestId('issue-done-browser-note')).toBeNull();
    expect(text()).not.toMatch(/hidden/i);
  });

  it('in Greek and French on the web, too', async () => {
    for (const lang of ['el', 'fr'] as const) {
      h.language = lang;
      photoSheet();
      savedAs('photo_private');
      await report('photo_private');
      expect(screen.getByTestId('issue-done-saved').textContent).not.toContain(
        lang === 'el' ? 'στο κινητό σου' : 'sur ton téléphone',
      );
      expect(screen.getByTestId('issue-done-saved').textContent).toContain(
        lang === 'el' ? 'σε αυτό το πρόγραμμα περιήγησης' : 'dans ce navigateur',
      );
      cleanup();
    }
  });

  it('while it is sending it says so; a check that could not run says the safety-check line; neither says hidden', async () => {
    photoSheet();
    savedAs('photo_private');
    h.queue.syncing = true;
    await report('photo_private');
    expect(screen.getByTestId('issue-done-sending').textContent).toContain(en.reportSending);
    cleanup();
    h.queue.syncing = false;
    photoSheet();
    savedAs('photo_private', { checkUnavailable: true });
    await report('photo_private');
    expect(screen.getByTestId('issue-done-check').textContent).toBe(en.reportCheckUnavailable);
    expect(text()).not.toMatch(/hidden/i);
  });

  it('a refused report says so, and Try again retries it', async () => {
    catSheet();
    savedAs('wrong_name', { status: 'failed', serverFailures: 3 });
    await report('wrong_name');
    expect(screen.getByTestId('issue-done-failed')).toBeTruthy();
    fireEvent.click(screen.getByTestId('issue-try-again'));
    expect(h.queue.retryFailed).toHaveBeenCalled();
  });
});
