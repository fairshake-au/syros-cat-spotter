import { describe, expect, it } from 'vitest';
import { CONTACT_EMAIL, contactMailto } from '../contactMail';
import { TRANSLATIONS } from '../i18n';

function parts(url: string) {
  const [head, query] = url.split('?');
  const params = Object.fromEntries(query.split('&').map((p) => p.split('=') as [string, string]));
  return { head, subject: decodeURIComponent(params.subject), body: decodeURIComponent(params.body), raw: params };
}

describe('contactMailto (spec §3.4)', () => {
  it('goes to hello@catspotters.com', () => {
    expect(CONTACT_EMAIL).toBe('hello@catspotters.com');
    expect(parts(contactMailto('en', '1.0.0', 'ios')).head).toBe('mailto:hello@catspotters.com');
  });

  it('subject is the app name in the app language, percent-encoded (no + signs)', () => {
    for (const lang of ['en', 'el', 'fr'] as const) {
      const url = contactMailto(lang, '1.0.0', 'ios');
      const p = parts(url);
      expect(p.subject).toBe(TRANSLATIONS[lang].helpContactSubject);
      expect(p.raw.subject).toBe(encodeURIComponent(TRANSLATIONS[lang].helpContactSubject));
      expect(url).not.toContain('+');
    }
    expect(parts(contactMailto('en', '1.0.0', 'ios')).raw.subject).toBe('Cat%20Spotters%20app');
  });

  it('body is two blank lines then "App {version} · {platform}"', () => {
    expect(parts(contactMailto('en', '1.0.0', 'ios')).body).toBe('\n\nApp 1.0.0 · iOS');
    expect(parts(contactMailto('en', '2.3.4', 'android')).body).toBe('\n\nApp 2.3.4 · Android');
  });

  it('platform "web" stays "web"', () => {
    expect(parts(contactMailto('fr', '1.0.0', 'web')).body).toBe('\n\nApp 1.0.0 · web');
  });

  it('carries nothing else: no device id, no location, no spotter name', () => {
    const p = parts(contactMailto('en', '1.0.0', 'ios'));
    expect(Object.keys(p.raw).sort()).toEqual(['body', 'subject']);
    expect(p.body.replace(/\n/g, '').trim()).toBe('App 1.0.0 · iOS');
  });
});
