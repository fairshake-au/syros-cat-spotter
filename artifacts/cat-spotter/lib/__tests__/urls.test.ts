import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { absoluteUrl } from '../urls';

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
