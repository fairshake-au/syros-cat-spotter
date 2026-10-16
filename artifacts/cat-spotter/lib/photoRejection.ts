import { ApiError } from '@workspace/api-client-react';

/**
 * Returns a translation key describing why the server rejected a photo,
 * or null when the error is not a permanent photo rejection (HTTP 400).
 *
 * Permanent rejections should never be retried by the offline queue —
 * the same photo will always fail. The spotter fixes them instead.
 *
 * SYC-415: a 413 (the whole spot is too large) is one of these too: it is
 * fixable by removing a photo (spec §6.4), so it is not left as an
 * unfixable error.
 */
export function photoRejectionKey(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const apiError = err as ApiError;
  if (apiError.status === 413) return 'spotTooLarge';
  if (apiError.status !== 400) return null;
  const data = apiError.data as { error?: unknown } | null;
  const serverMessage =
    (data && typeof data.error === 'string' && data.error) || apiError.message;
  const lower = serverMessage.toLowerCase();
  if (lower.includes('too large')) return 'photoTooLarge';
  if (lower.includes('format')) return 'photoUnsupported';
  return 'photoInvalid';
}

/**
 * SYC-415: which of the spot's photos the server refused, read from a 400's
 * `data.photo`. Null when it doesn't say (the caller treats that as the first
 * photo, as for any spot before extras).
 */
export function rejectedPhotoRole(err: unknown): 'first' | 'face' | 'body' | null {
  if (!(err instanceof ApiError)) return null;
  const apiError = err as ApiError;
  if (apiError.status !== 400) return null;
  const data = apiError.data as { photo?: unknown } | null;
  const photo = data && typeof data === 'object' ? data.photo : undefined;
  return photo === 'first' || photo === 'face' || photo === 'body' ? photo : null;
}
