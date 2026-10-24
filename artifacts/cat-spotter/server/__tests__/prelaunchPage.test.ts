/**
 * SYC-664 T9: the password page on /restore points icon users back to the app
 * to type their code. The line is static text, chosen on the server from the
 * requested path, so the page for any other path is unchanged.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { passwordPage } = require('../prelaunch-page.js') as {
  passwordPage: (opts: { action: string; next: string; error?: 'wrong' | 'tooMany' }) => string;
};

const HINT_ID = 'id="restore-code-hint"';
const HINT_TEXT =
  'Use Cat Spotters from an icon on your home screen? Go back to it and type the 8-digit code from the email.';

const HINT_EL =
  'Χρησιμοποιείς το Cat Spotters από εικονίδιο στην αρχική οθόνη; Γύρνα εκεί και πληκτρολόγησε τον κωδικό 8 ψηφίων από το email.';

const pageFor = (next: string) => passwordPage({ action: '/_gate/login', next });

describe('password page: the restore code hint', () => {
  it.each(['/restore', '/restore/', '/restore?x=1', '/app/restore'])('shows the hint for %s, above the password box', (next) => {
    const html = pageFor(next);
    expect(html).toContain(HINT_ID);
    expect(html).toContain(HINT_TEXT);
    expect(html).toContain(HINT_EL);
    expect(html.indexOf(HINT_ID)).toBeLessThan(html.indexOf('<form'));
  });

  it.each(['/', '/cats', '/restore-me', '/restores'])('does not show the hint for %s', (next) => {
    const html = pageFor(next);
    expect(html).not.toContain(HINT_ID);
    expect(html).not.toContain('8-digit code');
    expect(html).not.toContain(HINT_EL);
  });
});
