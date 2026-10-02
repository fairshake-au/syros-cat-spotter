/**
 * SYC-119: the picker's English copy is the spec's (choose-a-different-cat.md
 * §6), and every key exists in Greek and French. Greek and French are drafts
 * awaiting native review (SYC-4).
 */
import { describe, expect, it } from 'vitest';
import { TRANSLATIONS } from '../i18n';

const SPEC_COPY: Record<string, string> = {
  findCatCardTitle: 'Not one of these?',
  findCatCardAction: 'Find the cat yourself',
  findItInsteadLead: 'Seen this cat in the app before?',
  findItInsteadAction: 'Find it instead',
  pickerTitle: 'Which cat is it?',
  pickerSearchPlaceholder: 'Name or SYR number',
  pickerListHeading: 'Cats known around here',
  pickerConfirm: 'Yes, this is the cat',
  pickerAddNewLead: 'Can\'t find it?',
  pickerAddNewAction: 'Add it as a new cat',
  pickerNotNearby: 'That cat isn\'t listed near where you took this photo.',
  pickerNoSignal: 'No signal. Your sighting is saved. Finish this when you\'re back online.',
  pickerOfflineStale: 'Showing the cats saved on your phone. New ones may be missing.',
  nameTakenIsThis: 'There\'s already a cat called {name}. Is this them?',
  nameTakenYes: 'Yes, that\'s them',
  nameTakenNo: 'No, a different cat',
};

describe('picker copy', () => {
  it.each(Object.entries(SPEC_COPY))('en.%s is the spec copy', (key, copy) => {
    expect(TRANSLATIONS.en[key]).toBe(copy);
  });

  it('every picker key exists in every language', () => {
    for (const lang of ['en', 'el', 'fr'] as const) {
      for (const key of [...Object.keys(SPEC_COPY), 'pickerNoResults', 'pickerEmpty', 'pickerNoSignalStay']) {
        expect(TRANSLATIONS[lang][key], `${lang}.${key}`).toBeTruthy();
      }
    }
  });

  it('never says the app works with no signal', () => {
    for (const lang of ['en', 'el', 'fr'] as const) {
      for (const key of Object.keys(SPEC_COPY)) {
        expect(TRANSLATIONS[lang][key]).not.toMatch(/works (offline|with no signal)/i);
      }
    }
  });
});
