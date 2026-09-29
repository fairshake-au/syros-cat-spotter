/**
 * SYC-113 test 18: with setPrelaunchKey('k'), every generated API call sends
 * X-Prelaunch-Key: k; an explicit header wins; null sends none.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '@workspace/api-client-react';
import { setBaseUrl, setPrelaunchKey } from '@workspace/api-client-react';

const here = path.dirname(fileURLToPath(import.meta.url));
const generatedSource = readFileSync(
  path.join(here, '../../../../lib/api-client-react/src/generated/api.ts'),
  'utf8',
);

/** Every generated fetcher: `export const name = async (` followed by `return customFetch`. */
function generatedFetchers(): string[] {
  const names: string[] = [];
  const re = /export const (\w+) = async \(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(generatedSource))) {
    const body = generatedSource.slice(m.index, m.index + 1200);
    if (/return customFetch</.test(body)) names.push(m[1]!);
  }
  return names;
}

let seen: Headers[] = [];

beforeEach(() => {
  seen = [];
  setBaseUrl('https://apptest.example');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: unknown, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
});

afterEach(() => {
  setPrelaunchKey(null);
  setBaseUrl(null);
  vi.unstubAllGlobals();
});

async function callEvery(): Promise<string[]> {
  const names = generatedFetchers();
  for (const name of names) {
    const fn = (api as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[name];
    expect(typeof fn, name).toBe('function');
    await fn!('1', '1', '1');
  }
  return names;
}

describe('customFetch and the tester key', () => {
  it('every generated call sends X-Prelaunch-Key when a key is set', async () => {
    setPrelaunchKey('k');
    const names = await callEvery();
    // Guard against a scan that silently finds nothing.
    expect(names.length).toBeGreaterThanOrEqual(20);
    expect(names).toContain('listCats');
    expect(names).toContain('createSighting');
    expect(names).toContain('registerPushToken');
    expect(seen).toHaveLength(names.length);
    for (const headers of seen) expect(headers.get('x-prelaunch-key')).toBe('k');
  });

  it('an explicit header wins', async () => {
    setPrelaunchKey('k');
    await api.listCats(undefined, { headers: { 'X-Prelaunch-Key': 'explicit' } });
    expect(seen[0]!.get('x-prelaunch-key')).toBe('explicit');
  });

  it('null (and empty) sends none', async () => {
    setPrelaunchKey(null);
    await callEvery();
    for (const headers of seen) expect(headers.has('x-prelaunch-key')).toBe(false);
    seen = [];
    setPrelaunchKey('');
    await api.listCats();
    expect(seen[0]!.has('x-prelaunch-key')).toBe(false);
  });

  it("a refusal reads \"Cat Spotters isn't open yet.\"", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: 'prelaunch_pass_required', message: "Cat Spotters isn't open yet." }),
          { status: 401, statusText: 'Unauthorized', headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    await expect(api.listCats()).rejects.toThrow("Cat Spotters isn't open yet.");
  });
});
