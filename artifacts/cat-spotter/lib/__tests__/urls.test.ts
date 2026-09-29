import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { absoluteUrl, apiOrigin, signInUrl } from '../urls';

describe('absoluteUrl', () => {
  const original = process.env.EXPO_PUBLIC_DOMAIN;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_DOMAIN = 'example.replit.dev';
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_DOMAIN = original;
  });

  it('prefixes relative paths with the public domain over https', () => {
    expect(absoluteUrl('/api/photos/1.jpg')).toBe(
      'https://example.replit.dev/api/photos/1.jpg',
    );
  });

  it('leaves absolute http(s) URLs untouched', () => {
    expect(absoluteUrl('https://cdn.example.com/x.jpg')).toBe('https://cdn.example.com/x.jpg');
    expect(absoluteUrl('http://cdn.example.com/x.jpg')).toBe('http://cdn.example.com/x.jpg');
  });
});

describe('apiOrigin', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env.EXPO_PUBLIC_API_URL = saved.EXPO_PUBLIC_API_URL;
    process.env.EXPO_PUBLIC_DOMAIN = saved.EXPO_PUBLIC_DOMAIN;
  });

  it('falls back to the https Replit domain when no override is set', () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    process.env.EXPO_PUBLIC_DOMAIN = 'example.replit.dev';
    expect(apiOrigin()).toBe('https://example.replit.dev');
  });

  // The whole point: a local API is plain http, which the old hardcoded
  // template could never express.
  it('honours a local http override', () => {
    process.env.EXPO_PUBLIC_API_URL = 'http://localhost:3001';
    expect(apiOrigin()).toBe('http://localhost:3001');
  });

  it('ignores an empty override rather than producing a bare scheme', () => {
    process.env.EXPO_PUBLIC_API_URL = '   ';
    process.env.EXPO_PUBLIC_DOMAIN = 'example.replit.dev';
    expect(apiOrigin()).toBe('https://example.replit.dev');
  });

  it('strips a trailing slash so paths never double up', () => {
    process.env.EXPO_PUBLIC_API_URL = 'http://localhost:3001/';
    expect(absoluteUrl('/api/cats')).toBe('http://localhost:3001/api/cats');
  });
});

describe('signInUrl', () => {
  const original = process.env.EXPO_PUBLIC_DOMAIN;

  beforeEach(() => {
    // A prior describe's afterEach can leave EXPO_PUBLIC_API_URL set to the
    // literal string "undefined" (process.env coerces `undefined` to that
    // string) rather than unset — delete it explicitly so apiOrigin() falls
    // through to EXPO_PUBLIC_DOMAIN as this test expects.
    delete process.env.EXPO_PUBLIC_API_URL;
    process.env.EXPO_PUBLIC_DOMAIN = 'example.replit.dev';
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_DOMAIN = original;
  });

  it('carries the given path as an encoded ?next= (SYC-121 review fix)', () => {
    expect(signInUrl('/cat/42')).toBe(
      'https://example.replit.dev/_gate/login?next=%2Fcat%2F42',
    );
  });
});
