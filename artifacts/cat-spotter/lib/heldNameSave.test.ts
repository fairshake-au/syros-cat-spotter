import { describe, expect, it, vi } from 'vitest';
import { saveHeldName, type HeldNameDeps } from './heldNameSave';

const err = (status?: number, code?: string) =>
  Object.assign(new Error('request failed'), status ? { status, data: code ? { code } : null } : {});

/** A fake server: names already taken by others, names refused, and this phone's saved name. */
function server(opts: {
  taken?: string[];
  refused?: string[];
  saved?: string | null;
  claimFails?: Error;
  readFails?: boolean;
  /** The claim lands on the server but the answer is lost. */
  answerLost?: boolean;
}) {
  const taken = new Set((opts.taken ?? []).map((n) => n.toLowerCase()));
  const refused = new Set((opts.refused ?? []).map((n) => n.toLowerCase()));
  let saved = opts.saved ?? null;
  const claims: string[] = [];
  let numberedCount = 0;
  let suggestCount = 0;
  const deps: HeldNameDeps = {
    read: vi.fn(async () => {
      if (opts.readFails) throw err();
      return { username: saved };
    }),
    claim: vi.fn(async (_id: string, { username }: { username: string }) => {
      claims.push(username);
      if (opts.claimFails) throw opts.claimFails;
      if (refused.has(username.toLowerCase())) throw err(400, 'offensive_username');
      if (taken.has(username.toLowerCase())) throw err(409);
      saved = username;
      if (opts.answerLost) throw err();
      return { username };
    }),
    numbered: (name) => `${name}${10 + numberedCount++}`,
    suggest: () => `Suggested${suggestCount++}`,
  };
  return { deps, claims, saved: () => saved };
}

describe('saveHeldName (SYC-506)', () => {
  it('saves a free name with no note', async () => {
    const s = server({});
    await expect(saveHeldName('dev-1', 'SunnyTabby', s.deps)).resolves.toEqual({
      kind: 'saved',
      username: 'SunnyTabby',
      note: null,
    });
    expect(s.claims).toEqual(['SunnyTabby']);
  });

  it('reads first: adopts a name an earlier try already saved, and sends nothing', async () => {
    const s = server({ saved: 'sunnytabby' });
    const result = await saveHeldName('dev-1', 'SunnyTabby', s.deps);
    expect(result).toEqual({ kind: 'saved', username: 'sunnytabby', note: null });
    expect(s.deps.claim).not.toHaveBeenCalled();
  });

  it('adopts a different name the server already has for this phone, without blaming anyone (review F4)', async () => {
    const s = server({ saved: 'Alice' });
    const result = await saveHeldName('dev-1', 'Bob', s.deps);
    expect(result).toEqual({ kind: 'saved', username: 'Alice', note: null });
    expect(s.deps.claim).not.toHaveBeenCalled();
  });

  it('keeps the held name when the first read fails (offline again)', async () => {
    const s = server({ readFails: true });
    await expect(saveHeldName('dev-1', 'SunnyTabby', s.deps)).resolves.toEqual({ kind: 'retryLater' });
    expect(s.deps.claim).not.toHaveBeenCalled();
  });

  it('a taken name gets a number, with a note', async () => {
    const s = server({ taken: ['SunnyTabby'] });
    const result = await saveHeldName('dev-1', 'SunnyTabby', s.deps);
    expect(result).toEqual({
      kind: 'saved',
      username: 'SunnyTabby10',
      note: { from: 'SunnyTabby', to: 'SunnyTabby10', reason: 'taken' },
    });
    expect(s.claims).toEqual(['SunnyTabby', 'SunnyTabby10']);
  });

  it('after three taken numbered tries, a suggestion', async () => {
    const s = server({ taken: ['Alex', 'Alex10', 'Alex11', 'Alex12'] });
    const result = await saveHeldName('dev-1', 'Alex', s.deps);
    expect(s.claims).toEqual(['Alex', 'Alex10', 'Alex11', 'Alex12', 'Suggested0']);
    expect(result).toEqual({
      kind: 'saved',
      username: 'Suggested0',
      note: { from: 'Alex', to: 'Suggested0', reason: 'taken' },
    });
  });

  it('a refused name goes straight to a suggestion (a number would not help)', async () => {
    const s = server({ refused: ['Rude'] });
    const result = await saveHeldName('dev-1', 'Rude', s.deps);
    expect(s.claims).toEqual(['Rude', 'Suggested0']);
    expect(result).toEqual({
      kind: 'saved',
      username: 'Suggested0',
      note: { from: 'Rude', to: 'Suggested0', reason: 'refused' },
    });
  });

  it('gives up for now when every try is used, keeping the held name', async () => {
    const s = server({
      taken: ['Alex', 'Alex10', 'Alex11', 'Alex12', 'Suggested0', 'Suggested1'],
    });
    await expect(saveHeldName('dev-1', 'Alex', s.deps)).resolves.toEqual({ kind: 'retryLater' });
    expect(s.claims).toHaveLength(6);
  });

  it('a lost answer is checked with the server: saved if it landed', async () => {
    const s = server({ answerLost: true });
    await expect(saveHeldName('dev-1', 'SunnyTabby', s.deps)).resolves.toEqual({
      kind: 'saved',
      username: 'SunnyTabby',
      note: null,
    });
  });

  it('a server error with nothing saved stops without trying another name', async () => {
    const s = server({ claimFails: err(503) });
    await expect(saveHeldName('dev-1', 'SunnyTabby', s.deps)).resolves.toEqual({ kind: 'retryLater' });
    expect(s.claims).toEqual(['SunnyTabby']);
  });

  it("this phone's credential refused (403): no other name is tried", async () => {
    const s = server({ claimFails: err(403) });
    await expect(saveHeldName('dev-1', 'SunnyTabby', s.deps)).resolves.toEqual({ kind: 'retryLater' });
    expect(s.claims).toEqual(['SunnyTabby']);
  });

  it('a refused name is never numbered, even when a suggestion is taken (review F3)', async () => {
    const s = server({ refused: ['Badname'], taken: ['Suggested0'] });
    const result = await saveHeldName('dev-1', 'Badname', s.deps);
    expect(s.claims).toEqual(['Badname', 'Suggested0', 'Suggested1']);
    expect(s.claims.some((c) => c.startsWith('Badname') && c !== 'Badname')).toBe(false);
    expect(result).toEqual({
      kind: 'saved',
      username: 'Suggested1',
      note: { from: 'Badname', to: 'Suggested1', reason: 'refused' },
    });
  });

  it('a taken suggestion gets another suggestion, not a numbered held name (review F3)', async () => {
    const s = server({ taken: ['Alex', 'Alex10', 'Alex11', 'Alex12', 'Suggested0'] });
    await saveHeldName('dev-1', 'Alex', s.deps);
    expect(s.claims).toEqual(['Alex', 'Alex10', 'Alex11', 'Alex12', 'Suggested0', 'Suggested1']);
  });

  it('does not send the same numbered name twice (review F6)', async () => {
    const s = server({ taken: ['Alex', 'Alex47', 'Alex48'] });
    const numbers = [47, 47, 48, 48, 49];
    s.deps.numbered = (name) => `${name}${numbers.shift() ?? 50}`;
    await saveHeldName('dev-1', 'Alex', s.deps);
    expect(s.claims).toEqual(['Alex', 'Alex47', 'Alex48', 'Alex49']);
  });

  it('stops before the next request once the phone is another spotter (review F1/F2)', async () => {
    const s = server({ taken: ['Alex'] });
    let current = true;
    s.deps.stillCurrent = () => current;
    const claim = s.deps.claim;
    s.deps.claim = vi.fn(async (id, body) => {
      current = false; // "Delete my data" while this request is open
      return claim(id, body);
    });
    await expect(saveHeldName('dev-1', 'Alex', s.deps)).resolves.toEqual({ kind: 'abandoned' });
    expect(s.claims).toEqual(['Alex']);
  });

  it('after a taken name and a refused number, a taken suggestion is not followed by another number (ship review F2)', async () => {
    const s = server({ taken: ['Alex', 'Suggested0'], refused: ['Alex10'] });
    const result = await saveHeldName('dev-1', 'Alex', s.deps);
    expect(s.claims).toEqual(['Alex', 'Alex10', 'Suggested0', 'Suggested1']);
    expect(result).toEqual({
      kind: 'saved',
      username: 'Suggested1',
      note: { from: 'Alex', to: 'Suggested1', reason: 'taken' },
    });
  });
});
