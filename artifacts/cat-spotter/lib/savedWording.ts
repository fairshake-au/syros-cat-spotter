/**
 * SYC-170 PR 1.2: on the website a waiting report is saved in the browser, not
 * on a phone, so the "saved on your phone" wording reads "saved in this
 * browser" there (spec §4.2; plan PR 1.2).
 *
 * Applied to the report confirmation's lines only (the shared welfare
 * guidance copy, which is reviewed text in three languages, is left as it is
 * and adjusted at display time). A test keeps every phrase in step with the
 * copy it rewrites.
 */
import type { Language } from './i18n';

export const SAVED_ON_PHONE: Record<Language, { from: string; to: string }> = {
  en: { from: 'on your phone', to: 'in this browser' },
  el: { from: 'στο κινητό σου', to: 'σε αυτό το πρόγραμμα περιήγησης' },
  fr: { from: 'sur ton téléphone', to: 'dans ce navigateur' },
};

/** `text` with the phone wording turned into the browser wording, when on the web. */
export function savedWording(text: string, language: Language, isWeb: boolean): string {
  if (!isWeb) return text;
  const { from, to } = SAVED_ON_PHONE[language] ?? SAVED_ON_PHONE.en;
  return text.split(from).join(to);
}
