import { describe, expect, it } from 'vitest';
import { EAR_TIP_EXAMPLE_PHOTO } from '../earTipExample';

describe('EAR_TIP_EXAMPLE_PHOTO', () => {
  // SYC-79: Syros Cats' photo is in the app, so the question never falls back
  // to words alone by accident (a broken import would make this undefined).
  it("is Syros Cats' bundled example photo", () => {
    expect(EAR_TIP_EXAMPLE_PHOTO).toBeTruthy();
    expect(String(EAR_TIP_EXAMPLE_PHOTO)).toMatch(/ear-tip-example\.jpg/);
  });
});
