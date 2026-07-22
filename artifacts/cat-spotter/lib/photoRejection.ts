import { ApiError } from '@workspace/api-client-react';

/**
 * Returns a translation key describing why the server rejected a photo,
 * or null when the error is not a permanent photo rejection (HTTP 400).
 *
 * Permanent rejections should never be retried by the offline queue —
 * the same photo will always fail.
 */
export function photoRejectionKey(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const apiError = err as ApiError;
  if (apiError.status !== 400) return null;
  const data = apiError.data as { error?: unknown } | null;
  const serverMessage =
    (data && typeof data.error === 'string' && data.error) || apiError.message;
  const lower = serverMessage.toLowerCase();
  if (lower.includes('too large')) return 'photoTooLarge';
  if (lower.includes('format')) return 'photoUnsupported';
  return 'photoInvalid';
}
