// @vitest-environment jsdom
/**
 * SYC-574 (design-review-fixes-oct22.md §2.2): the Spot screen reads `for`,
 * copies it into state and clears the param at once, so the hint never comes
 * back through the tab bar; leaving the tab drops it unless a photo is staged.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  params: {} as { for?: string },
  setParams: vi.fn(),
  focus: null as null | (() => void | (() => void)),
  cats: {} as Record<number, unknown>,
  useGetCat: vi.fn(),
  device: { deviceId: 'dev-1' as string | null, isReady: true, startupError: null as Error | null },
}));

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => m.params,
  useRouter: () => router,
  // The latest focus callback; the test plays focus and blur by hand.
  useFocusEffect: (cb: () => void | (() => void)) => {
    m.focus = cb;
  },
}));
const router = { setParams: (p: { for?: string }) => m.setParams(p) };
vi.mock('@workspace/api-client-react', () => ({
  getGetCatQueryKey: (id: number) => [`/api/cats/${id}`],
  useGetCat: (id: number, opts: { query: { enabled: boolean } }) => {
    m.useGetCat(id, opts);
    return { data: opts.query.enabled ? m.cats[id] : undefined };
  },
}));
vi.mock('@/context/DeviceContext', () => ({ useDevice: () => m.device }));

import { useSpotHint } from '../useSpotHint';

function cat(id: number, lifeStatus = 'street') {
  return { cat: { id, name: `Cat ${id}`, photoUrl: `/api/photos/${id}`, lifeStatus } };
}

beforeEach(() => {
  m.params = {};
  m.cats = { 7: cat(7), 8: cat(8, 'deceased'), 9: cat(9, 'in_care') };
  // The real setParams clears the param from the route.
  m.setParams.mockImplementation((p: { for?: string }) => {
    m.params = { ...m.params, ...p };
  });
});
afterEach(() => vi.clearAllMocks());

function mount(hasPhoto = false) {
  return renderHook(({ photo }) => useSpotHint(photo), { initialProps: { photo: hasPhoto } });
}

/** Leave the tab: the focus effect's cleanup runs. */
function blur(cleanup: void | (() => void)) {
  act(() => {
    if (typeof cleanup === 'function') cleanup();
  });
}

describe('useSpotHint', () => {
  it('reads `for`, keeps it, and clears the param with setParams({ for: undefined })', () => {
    m.params = { for: '7' };
    const h = mount();
    expect(h.result.current.hintCatId).toBe(7);
    expect(m.setParams).toHaveBeenCalledWith({ for: undefined });
    expect(h.result.current.hintCat).toMatchObject({ id: 7, name: 'Cat 7' });
  });

  it('asks for the cat with the cat page\'s own query key, so its answer is reused', () => {
    m.params = { for: '7' };
    mount();
    const last = m.useGetCat.mock.calls.at(-1)!;
    expect(last[0]).toBe(7);
    expect(last[1].query.queryKey).toEqual(['/api/cats/7', 'dev-1']);
  });

  it('clears a param that is not a cat id, and keeps no hint', () => {
    m.params = { for: 'abc' };
    const h = mount();
    expect(h.result.current.hintCatId).toBeNull();
    expect(m.setParams).toHaveBeenCalledWith({ for: undefined });
  });

  it('does not come back through the tab bar once dropped', () => {
    m.params = { for: '7' };
    const h = mount();
    const cleanup = m.focus!();
    blur(cleanup); // leave the tab with no photo: dropped
    expect(h.result.current.hintCatId).toBeNull();
    // Back through the tab bar: the route has no `for` any more.
    m.focus!();
    h.rerender({ photo: false });
    expect(m.params.for).toBeUndefined();
    expect(h.result.current.hintCatId).toBeNull();
    expect(h.result.current.hintCat).toBeNull();
  });

  it('leaving the tab with a photo staged keeps the hint', () => {
    m.params = { for: '7' };
    const h = mount(false);
    h.rerender({ photo: true });
    const cleanup = m.focus!();
    blur(cleanup);
    expect(h.result.current.hintCatId).toBe(7);
  });

  it('arriving with a hint when a photo is already staged applies it to that photo', () => {
    const h = mount(true);
    expect(h.result.current.hintCatId).toBeNull();
    m.params = { for: '7' };
    h.rerender({ photo: true });
    expect(h.result.current.hintCatId).toBe(7);
  });

  it.each([8, 9])('drops the hint for a cat that has died or is in care (%i)', (id) => {
    m.params = { for: String(id) };
    const h = mount();
    expect(h.result.current.hintCatId).toBeNull();
    expect(h.result.current.hintCat).toBeNull();
  });

  it('dispatch stop (the ✕) drops it', () => {
    m.params = { for: '7' };
    const h = mount();
    act(() => h.result.current.dispatch({ kind: 'stop' }));
    expect(h.result.current.hintCatId).toBeNull();
  });

  it('keeps the hint while the cat is still loading, with no banner yet', () => {
    m.cats = {};
    m.params = { for: '7' };
    const h = mount();
    expect(h.result.current.hintCatId).toBe(7);
    expect(h.result.current.hintCat).toBeNull();
  });
});
