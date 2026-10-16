/**
 * SYC-170 PR 1.3: the host keeps the WebView's own user agent. Cloudflare needs
 * it constant through a session, and a spoofed string that doesn't match the
 * real engine is what bot scoring catches. The component can't be rendered
 * under vitest (the WebView package isn't parseable), so this reads its source,
 * comments removed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('TurnstileHost user agent', () => {
  it('passes no userAgent prop to the WebView', () => {
    const src = readFileSync(path.resolve(__dirname, '../../components/TurnstileHost.tsx'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('<WebView');
    expect(code).not.toMatch(/userAgent/i);
  });
});
