/**
 * MERGE GATE for data spine PR 7. Fails on purpose until SYC-79 is done.
 *
 * The ear-tip question must ship with Syros Cats' real example photo (a clean
 * clipped tip beside a torn ear): cat-record-data-spine.md §4.4 calls it
 * "required, not decorative", and the plan says PR 7 "can't merge without"
 * it. Until the photos arrive the question shows a marked placeholder, and
 * this test keeps CI red so the PR can't be merged by accident.
 *
 * To clear it: add the photos under assets/images/ and point
 * EAR_TIP_EXAMPLE_PHOTO at them (lib/earTipExample.ts). Never use a stock or
 * generated stand-in, and never skip this test to get CI green.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({}));

import { EAR_TIP_EXAMPLE_PHOTO } from '../earTipExample';

describe('the ear-tip example photo (SYC-79)', () => {
  it('is Syros Cats\' real photo, not the placeholder', () => {
    expect(
      EAR_TIP_EXAMPLE_PHOTO,
      'BLOCKED ON SYC-79: the ear-tip example photos from Syros Cats have not been added yet (lib/earTipExample.ts).',
    ).not.toBeNull();
  });
});
