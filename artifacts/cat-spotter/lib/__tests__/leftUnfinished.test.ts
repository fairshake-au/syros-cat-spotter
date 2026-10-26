import { describe, expect, it } from 'vitest';
import { consumeLeftUnfinished, markLeftUnfinished } from '../leftUnfinished';
import { classifyResolveError } from '../catPicker';
import { ApiError } from '@workspace/api-client-react';

describe('SYC-186 leftUnfinished', () => {
  it('reads true once per mark, then false', () => {
    expect(consumeLeftUnfinished()).toBe(false);
    markLeftUnfinished();
    expect(consumeLeftUnfinished()).toBe(true);
    expect(consumeLeftUnfinished()).toBe(false);
  });
});

function apiError(status: number, data: unknown) {
  return new ApiError(
    new Response(null, { status }),
    data,
    { method: 'POST', url: '/x' },
  );
}

describe('SYC-186 classifyResolveError: a spot that cannot be finished', () => {
  it('RESOLVED means already handled', () => {
    expect(classifyResolveError(apiError(409, { code: 'RESOLVED' }))).toEqual({
      kind: 'cant-finish',
      reason: 'handled',
    });
  });
  it('403 and 404 mean it is gone for this spotter', () => {
    expect(classifyResolveError(apiError(403, { error: 'Not your sighting' }))).toEqual({
      kind: 'cant-finish',
      reason: 'gone',
    });
    expect(classifyResolveError(apiError(404, { error: 'Sighting not found' }))).toEqual({
      kind: 'cant-finish',
      reason: 'gone',
    });
  });
  it('a name clash 409 is still a name clash', () => {
    expect(classifyResolveError(apiError(409, { code: 'NAME_TAKEN' })).kind).toBe('name-taken');
  });
  it('NOT_NEARBY is unchanged', () => {
    expect(classifyResolveError(apiError(422, { code: 'NOT_NEARBY' })).kind).toBe('not-nearby');
  });
});
