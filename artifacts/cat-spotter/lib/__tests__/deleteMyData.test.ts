import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  deleteMyData,
  deleteMyDataWithReports,
  finishAfterServerDeleted,
  isIdentityDeletedError,
  type DeleteMyDataSteps,
} from '../deleteMyData';

// SYC-63 plan §6.2: the order on the phone, and what a failure leaves.

function steps(overrides: Partial<DeleteMyDataSteps> = {}) {
  const calls: string[] = [];
  const s: DeleteMyDataSteps = {
    pauseSync: vi.fn(async () => {
      calls.push('pause');
    }),
    resumeSync: vi.fn(() => {
      calls.push('resume');
    }),
    deleteOnServer: vi.fn(async () => {
      calls.push('server');
    }),
    wipePhone: vi.fn(async () => {
      calls.push('wipe');
    }),
    resetIdentity: vi.fn(async () => {
      calls.push('reset');
    }),
    ...overrides,
  };
  return { s, calls };
}

const gone = Object.assign(new Error('HTTP 410'), {
  status: 410,
  data: { code: 'IDENTITY_DELETED' },
});

describe('deleteMyData', () => {
  it('pauses, deletes on the server, then wipes and starts fresh', async () => {
    const { s, calls } = steps();
    expect(await deleteMyData(s)).toBe('done');
    expect(calls.filter((c) => c !== 'pause')).toEqual(['server', 'wipe', 'reset', 'resume']);
    expect(calls[0]).toBe('pause');
  });

  it('touches nothing on the phone when the server call fails, and resumes', async () => {
    const { s, calls } = steps({
      deleteOnServer: vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
    });
    expect(await deleteMyData(s)).toBe('failed');
    expect(s.wipePhone).not.toHaveBeenCalled();
    expect(s.resetIdentity).not.toHaveBeenCalled();
    expect(calls).toEqual(['pause', 'resume']);
  });

  it('touches nothing on a 403 either', async () => {
    const { s } = steps({
      deleteOnServer: vi.fn(async () => {
        throw Object.assign(new Error('HTTP 403'), { status: 403, data: null });
      }),
    });
    expect(await deleteMyData(s)).toBe('failed');
    expect(s.wipePhone).not.toHaveBeenCalled();
  });

  it('treats a 410 as already deleted, and finishes the wipe', async () => {
    const { s } = steps({
      deleteOnServer: vi.fn(async () => {
        throw gone;
      }),
    });
    expect(await deleteMyData(s)).toBe('done');
    expect(s.wipePhone).toHaveBeenCalled();
    expect(s.resetIdentity).toHaveBeenCalled();
  });

  it('never calls the server before the pause has finished', async () => {
    let releasePause!: () => void;
    const { s } = steps({
      pauseSync: vi
        .fn()
        .mockImplementationOnce(
          () => new Promise<void>((resolve) => (releasePause = resolve)),
        )
        .mockResolvedValue(undefined),
    });
    const run = deleteMyData(s);
    await Promise.resolve();
    expect(s.deleteOnServer).not.toHaveBeenCalled();
    releasePause();
    await run;
    expect(s.deleteOnServer).toHaveBeenCalled();
  });

  it('keeps syncing paused and the old identity in place when the wipe fails', async () => {
    const { s } = steps({
      wipePhone: vi.fn(async () => {
        throw new Error('Could not list the saved photos');
      }),
    });
    expect(await deleteMyData(s)).toBe('wipe_failed');
    expect(s.resetIdentity).not.toHaveBeenCalled();
    expect(s.resumeSync).not.toHaveBeenCalled();
  });
});

describe('finishAfterServerDeleted (the interrupted case, plan §6.4)', () => {
  it('wipes and resets without asking the server again', async () => {
    const { s, calls } = steps();
    const { deleteOnServer: _unused, ...rest } = s;
    expect(await finishAfterServerDeleted(rest)).toBe('done');
    expect(calls).toEqual(['pause', 'wipe', 'reset', 'resume']);
  });
});

describe('isIdentityDeletedError', () => {
  it('is only the server\'s 410 IDENTITY_DELETED', () => {
    expect(isIdentityDeletedError(gone)).toBe(true);
    expect(isIdentityDeletedError({ status: 410, data: {} })).toBe(false);
    expect(isIdentityDeletedError({ status: 404, data: { code: 'IDENTITY_DELETED' } })).toBe(false);
    expect(isIdentityDeletedError(null)).toBe(false);
  });
});

describe('deleteMyDataWithReports (SYC-234: the person chooses)', () => {
  function withReports(sent = true, overrides: Partial<DeleteMyDataSteps> = {}) {
    const { s, calls } = steps(overrides);
    const r = {
      ...s,
      sendReports: vi.fn(async () => {
        calls.push('send-reports');
        return sent;
      }),
      wipeReports: vi.fn(async () => {
        calls.push('wipe-reports');
      }),
    };
    return { r, calls };
  }

  it('send: sends the reports before anything else, then deletes as normal', async () => {
    const { r, calls } = withReports(true);
    expect(await deleteMyDataWithReports(r, 'send')).toBe('done');
    expect(calls[0]).toBe('send-reports');
    expect(calls).toContain('server');
    expect(r.wipeReports).not.toHaveBeenCalled();
  });

  it('send: if a report won\'t go, nothing is paused, deleted or wiped', async () => {
    const { r, calls } = withReports(false);
    expect(await deleteMyDataWithReports(r, 'send')).toBe('reports_unsent');
    expect(calls).toEqual(['send-reports']);
  });

  it('delete: wipes the reports with the phone, after the server has deleted', async () => {
    const { r, calls } = withReports();
    expect(await deleteMyDataWithReports(r, 'delete')).toBe('done');
    expect(r.sendReports).not.toHaveBeenCalled();
    expect(calls.indexOf('server')).toBeLessThan(calls.indexOf('wipe-reports'));
    expect(calls.indexOf('wipe')).toBeLessThan(calls.indexOf('wipe-reports'));
  });

  it('delete: keeps the reports when the server call fails', async () => {
    const { r } = withReports(true, {
      deleteOnServer: vi.fn(async () => {
        throw new TypeError('offline');
      }),
    });
    expect(await deleteMyDataWithReports(r, 'delete')).toBe('failed');
    expect(r.wipeReports).not.toHaveBeenCalled();
  });

  it('none: touches no report', async () => {
    const { r } = withReports();
    expect(await deleteMyDataWithReports(r, 'none')).toBe('done');
    expect(r.sendReports).not.toHaveBeenCalled();
    expect(r.wipeReports).not.toHaveBeenCalled();
  });
});

// SYC-524: "Get your spots back" moves the spotter's identity onto this phone
// but keeps the phone's own location choice. The wipe that does clear it is
// tested by value in context/__tests__/DeleteMyDataContext.test.tsx.
describe('the remembered location choice', () => {
  const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');

  it('is cleared by the phone wipe, next to the photo tips', () => {
    const src = read('context/DeleteMyDataContext.tsx');
    expect(src).toMatch(/await clearPhotoTipsSeen\(AsyncStorage\);\s*(\/\/[^\n]*\n\s*)*await clearLocationChoice\(AsyncStorage\);/);
  });

  it('is never touched by adoptRestoredIdentity', () => {
    const src = read('context/DeviceContext.tsx');
    const start = src.indexOf('const adoptRestoredIdentity = useCallback(');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('}, []);', start));
    expect(body).not.toMatch(/location|LOCATION_CHOICE_KEY|AsyncStorage\.clear/i);
  });
});
