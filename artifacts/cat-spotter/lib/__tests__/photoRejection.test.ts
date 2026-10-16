import { describe, expect, it } from 'vitest';
import { ApiError } from '@workspace/api-client-react';
import { photoRejectionKey, rejectedPhotoRole } from '../photoRejection';

function makeApiError(status: number, data: unknown = null): ApiError {
  const response = new Response(null, { status, statusText: 'Err' });
  return new ApiError(response, data, { method: 'POST', url: '/api/sightings' });
}

describe('photoRejectionKey', () => {
  it('returns null for non-ApiError values', () => {
    expect(photoRejectionKey(new Error('too large'))).toBeNull();
    expect(photoRejectionKey('too large')).toBeNull();
    expect(photoRejectionKey(null)).toBeNull();
    expect(photoRejectionKey(undefined)).toBeNull();
  });

  it('returns null for other non-400 statuses (transient errors keep retrying)', () => {
    expect(photoRejectionKey(makeApiError(500, { error: 'too large' }))).toBeNull();
    expect(photoRejectionKey(makeApiError(401, { error: 'format' }))).toBeNull();
  });

  it('SYC-415: maps a 413 (the whole spot is too large) to spotTooLarge, which the spotter can fix', () => {
    expect(photoRejectionKey(makeApiError(413, { error: 'too large' }))).toBe('spotTooLarge');
    expect(photoRejectionKey(makeApiError(413, null))).toBe('spotTooLarge');
  });

  it('maps "too large" server messages to photoTooLarge', () => {
    expect(photoRejectionKey(makeApiError(400, { error: 'Photo is TOO LARGE' }))).toBe(
      'photoTooLarge',
    );
  });

  it('maps "format" server messages to photoUnsupported', () => {
    expect(photoRejectionKey(makeApiError(400, { error: 'Unsupported image format' }))).toBe(
      'photoUnsupported',
    );
  });

  it('falls back to photoInvalid for any other 400 message', () => {
    expect(photoRejectionKey(makeApiError(400, { error: 'blurry photo' }))).toBe('photoInvalid');
  });

  it('falls back to the error message when data.error is missing or not a string', () => {
    expect(photoRejectionKey(makeApiError(400, null))).toBe('photoInvalid');
    expect(photoRejectionKey(makeApiError(400, { error: 42 }))).toBe('photoInvalid');
  });
});

describe('rejectedPhotoRole (SYC-415)', () => {
  it("reads which photo failed from a 400's data.photo", () => {
    expect(rejectedPhotoRole(makeApiError(400, { error: 'x', photo: 'face' }))).toBe('face');
    expect(rejectedPhotoRole(makeApiError(400, { error: 'x', photo: 'body' }))).toBe('body');
    expect(rejectedPhotoRole(makeApiError(400, { error: 'x', photo: 'first' }))).toBe('first');
  });

  it('is null when the error does not say, or says something unknown, or is not a 400', () => {
    expect(rejectedPhotoRole(makeApiError(400, { error: 'x' }))).toBeNull();
    expect(rejectedPhotoRole(makeApiError(400, { error: 'x', photo: 'tail' }))).toBeNull();
    expect(rejectedPhotoRole(makeApiError(400, null))).toBeNull();
    expect(rejectedPhotoRole(makeApiError(413, { photo: 'face' }))).toBeNull();
    expect(rejectedPhotoRole(new Error('x'))).toBeNull();
  });
});
