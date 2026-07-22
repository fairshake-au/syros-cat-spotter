import { describe, expect, it } from 'vitest';
import { ApiError } from '@workspace/api-client-react';
import { photoRejectionKey } from '../photoRejection';

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

  it('returns null for non-400 statuses (transient errors keep retrying)', () => {
    expect(photoRejectionKey(makeApiError(500, { error: 'too large' }))).toBeNull();
    expect(photoRejectionKey(makeApiError(413, { error: 'too large' }))).toBeNull();
    expect(photoRejectionKey(makeApiError(401, { error: 'format' }))).toBeNull();
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
