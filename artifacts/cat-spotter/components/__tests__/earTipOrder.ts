import { expect } from 'vitest';
import { TRANSLATIONS } from '@/lib/i18n';

const en = TRANSLATIONS.en;

/** The ear-tip block reads top to bottom in this order (design-review-fixes-oct22.md §1.3). */
export function expectEarTipOrder(root: HTMLElement) {
  const text = root.textContent ?? '';
  const at = (needle: string) => {
    const i = text.indexOf(needle);
    expect(i, `missing: ${needle}`).toBeGreaterThanOrEqual(0);
    return i;
  };
  const q = at(en.earTipQuestion!.replace('{name}', 'Agatha'));
  const why = at(en.earTipWhy!);
  const caption = at(en.earTipExampleCaption!);
  const yes = at(en.earTipYes!);
  const no = at(en.earTipNo!);
  const cant = at(en.earTipCantTell!);
  expect(q).toBeLessThan(why);
  expect(why).toBeLessThan(caption);
  expect(caption).toBeLessThan(yes);
  expect(yes).toBeLessThan(no);
  expect(no).toBeLessThan(cant);
  const example = root.querySelector('[data-testid="ear-tip-example"]')!;
  expect(example).not.toBeNull();
  // Photo (inside the example block) comes after the why line and before the caption.
  const whyEl = Array.from(root.querySelectorAll('*')).find(
    (e) => e.children.length === 0 && e.textContent === en.earTipWhy,
  )!;
  expect(whyEl.compareDocumentPosition(example) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const photo = example.querySelector('[data-testid="example-image"]');
  if (photo) {
    const cap = Array.from(example.querySelectorAll('*')).find(
      (e) => e.children.length === 0 && e.textContent === en.earTipExampleCaption,
    )!;
    expect(photo.compareDocumentPosition(cap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
}
