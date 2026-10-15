// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://unmapped.example.org/report" }
/**
 * SYC-170 PR 1.2: on a host with no sitekey mapping the website sends with no
 * token (like the native stub) instead of throwing. The client is never the
 * thing that stops a report; the server decides.
 */
import { describe, expect, it } from 'vitest';
import { getTurnstileToken } from '../turnstile.web';

describe('getTurnstileToken on an unmapped host', () => {
  it('resolves null, never throws, and adds nothing to the page', async () => {
    expect(window.location.host).toBe('unmapped.example.org');
    await expect(getTurnstileToken('welfare_report', 'r-abc')).resolves.toBeNull();
    await expect(getTurnstileToken('welfare_draft', 'r-abc')).resolves.toBeNull();
    expect(document.querySelector('[data-turnstile-sheet]')).toBeNull();
    expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).toBeNull();
  });
});
