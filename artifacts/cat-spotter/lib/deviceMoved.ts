/**
 * SYC-3: the API's `403 {"error":"device_moved"}`: this phone's spotter was
 * moved to a new phone with "Get your spots back". Checked by shape (an
 * ApiError's name, status and body), so it needs nothing from the API client.
 */
export function isDeviceMovedError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== 'ApiError') return false;
  const e = error as Error & { status?: unknown; data?: unknown };
  return e.status === 403 && (e.data as { error?: unknown } | null)?.error === 'device_moved';
}
