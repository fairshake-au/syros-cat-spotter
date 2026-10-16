import { describe, expect, it } from 'vitest';
import { challengeUrl, isNavigationAllowed, parseChallengeMessage } from '../turnstileNav';

const APP = 'https://apptest.catspotters.com';

describe('SYC-170 PR 1.3: Turnstile WebView navigation allow-list', () => {
  it.each([
    'https://apptest.catspotters.com/_challenge?action=welfare_report&cdata=x',
    'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/turnstile/if/ov2/av0/rcv/x',
    'about:blank',
    'about:srcdoc',
  ])('allows %s', (url) => expect(isNavigationAllowed(url, APP)).toBe(true));

  it.each([
    'https://evil.example/',
    'https://apptest.catspotters.com.evil.example/',
    'https://catspotters.com/',
    'https://team.catspotters.com/',
    'http://apptest.catspotters.com/',
    'http://challenges.cloudflare.com/',
    'https://challenges.cloudflare.com.evil.example/',
    'javascript:alert(1)',
    'data:text/html,hi',
    'file:///etc/passwd',
    'not a url',
  ])('refuses %s', (url) => expect(isNavigationAllowed(url, APP)).toBe(false));

  it('allows a local dev server on its own host and port only', () => {
    expect(isNavigationAllowed('http://localhost:3999/_challenge', 'http://localhost:3999')).toBe(true);
    expect(isNavigationAllowed('http://localhost:4000/', 'http://localhost:3999')).toBe(false);
  });

  it('builds the challenge url', () => {
    expect(challengeUrl(`${APP}/`, 'report_issue', 'r-1')).toBe(
      `${APP}/_challenge?action=report_issue&cdata=r-1`,
    );
  });

  it('parses only well-formed messages', () => {
    expect(parseChallengeMessage('{"type":"token","token":"abc"}')).toEqual({ type: 'token', token: 'abc' });
    expect(parseChallengeMessage('{"type":"interactive"}')).toEqual({ type: 'interactive' });
    expect(parseChallengeMessage('{"type":"error","code":"600010"}')).toEqual({ type: 'error', code: '600010' });
    expect(parseChallengeMessage('{"type":"token","token":""}')).toBeNull();
    expect(parseChallengeMessage('{"type":"token","token":"' + 'a'.repeat(2049) + '"}')).toBeNull();
    expect(parseChallengeMessage('nope')).toBeNull();
  });
});
