/**
 * SYC-170 PR 1.2: which Turnstile sitekey the website uses, by host.
 */
import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_SITEKEY,
  TEST_SITEKEY_FAILS,
  TEST_SITEKEY_INTERACTIVE,
  TEST_SITEKEY_PASSES,
  isDevHost,
  sitekeyForHost,
} from '../turnstileConfig';

describe('sitekeyForHost', () => {
  it('the production app host gets the production key', () => {
    expect(sitekeyForHost('apptest.catspotters.com')).toBe('0x4AAAAAAFXDA4oOu3qZurFj');
    expect(sitekeyForHost('apptest.catspotters.com')).toBe(PRODUCTION_SITEKEY);
    expect(sitekeyForHost('APPTEST.catspotters.com:443')).toBe(PRODUCTION_SITEKEY);
  });

  it.each(['localhost', 'localhost:3999', '127.0.0.1', '127.0.0.1:8081', '[::1]:3000', 'abc-123.picard.replit.dev', 'x.id.repl.co'])(
    'development host %s gets the always-passes test key',
    (host) => {
      expect(isDevHost(host)).toBe(true);
      expect(sitekeyForHost(host)).toBe(TEST_SITEKEY_PASSES);
      expect(TEST_SITEKEY_PASSES).toBe('1x00000000000000000000AA');
    },
  );

  it.each([
    'example.com',
    'apptest.catspotters.com.evil.example',
    'catspotters.com',
    'evil-apptest.catspotters.com',
    'localhost.evil.com',
    'replit.dev.evil.com',
  ])('any other host (%s) gets no key at all, never the production one', (host) => {
    expect(sitekeyForHost(host)).toBeNull();
  });

  it('the failure and tap test keys can be picked on a development host only', () => {
    expect(sitekeyForHost('localhost:3999', TEST_SITEKEY_FAILS)).toBe('2x00000000000000000000AB');
    expect(sitekeyForHost('localhost:3999', TEST_SITEKEY_INTERACTIVE)).toBe('3x00000000000000000000FF');
    // production and unknown hosts ignore the override
    expect(sitekeyForHost('apptest.catspotters.com', TEST_SITEKEY_PASSES)).toBe(PRODUCTION_SITEKEY);
    expect(sitekeyForHost('example.com', TEST_SITEKEY_PASSES)).toBeNull();
    // and an override that is not one of the three published test keys is ignored
    expect(sitekeyForHost('localhost', '0xSOMETHINGELSE')).toBe(TEST_SITEKEY_PASSES);
    expect(sitekeyForHost('localhost', null)).toBe(TEST_SITEKEY_PASSES);
  });
});
