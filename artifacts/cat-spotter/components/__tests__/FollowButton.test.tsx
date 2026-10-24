// @vitest-environment jsdom
/** SYC-624 D1: the Follow / Following button. */
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name, ...rest }: { name: string; 'aria-hidden'?: boolean }) => (
    <i data-icon={name} aria-hidden={rest['aria-hidden'] ? 'true' : undefined} />
  ),
}));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS } = await import('@/lib/i18n');
  return { useLanguage: () => ({ t: (k: string) => TRANSLATIONS.en[k] ?? k, language: 'en' }) };
});
const h = vi.hoisted(() => ({ follow: vi.fn(), unfollow: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({
  getGetCatQueryKey: (id: number) => [`/api/cats/${id}`],
  useFollowCat: () => ({ mutateAsync: h.follow }),
  useUnfollowCat: () => ({ mutateAsync: h.unfollow }),
}));

import { FollowButton } from '../catPage/FollowButton';
import { TRANSLATIONS } from '@/lib/i18n';

let qc: QueryClient;
function view(over: Partial<React.ComponentProps<typeof FollowButton>> = {}) {
  return render(
    <QueryClientProvider client={qc}>
      <FollowButton catId={7} catName="Agatha" deviceId="dev-1" isFollowing={false} isOnline {...over} />
    </QueryClientProvider>,
  );
}
const button = () => screen.getByRole('button');

beforeEach(() => {
  qc = new QueryClient();
  vi.useRealTimers();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FollowButton', () => {
  it('Follow: taps call followCat and show Following, with the server count in the cache', async () => {
    qc.setQueryData(['/api/cats/7', 'dev-1'], { cat: {}, isFollowing: false, followersCount: 9 });
    h.follow.mockResolvedValue({ isFollowing: true, followersCount: 10 });
    view();
    expect(button().textContent).toBe('Follow');
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(button().getAttribute('aria-label')).toBe('Follow Agatha');
    await act(async () => {
      fireEvent.click(button());
    });
    expect(h.follow).toHaveBeenCalledWith({ catId: 7, data: { deviceId: 'dev-1' } });
    expect(h.unfollow).not.toHaveBeenCalled();
    expect(qc.getQueryData(['/api/cats/7', 'dev-1'])).toMatchObject({ isFollowing: true, followersCount: 10 });
  });

  it('flips at once, before the server answers', async () => {
    let done: (v: unknown) => void = () => {};
    h.follow.mockReturnValue(new Promise((r) => (done = r)));
    view();
    await act(async () => {
      fireEvent.click(button());
    });
    expect(button().textContent).toBe('Following');
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-icon="heart"]')).toBeTruthy();
    await act(async () => done({ isFollowing: true, followersCount: 1 }));
  });

  it('Following: a tap calls unfollowCat', async () => {
    h.unfollow.mockResolvedValue({ isFollowing: false, followersCount: 8 });
    view({ isFollowing: true });
    expect(button().textContent).toBe('Following');
    expect(button().getAttribute('aria-pressed')).toBe('true');
    await act(async () => {
      fireEvent.click(button());
    });
    expect(h.unfollow).toHaveBeenCalledWith({ catId: 7, data: { deviceId: 'dev-1' } });
    expect(h.follow).not.toHaveBeenCalled();
  });

  it('a second tap while the first is unanswered makes one call only', async () => {
    let done: (v: unknown) => void = () => {};
    h.follow.mockReturnValue(new Promise((r) => (done = r)));
    view();
    await act(async () => {
      fireEvent.click(button());
      fireEvent.click(button());
    });
    expect(h.follow).toHaveBeenCalledTimes(1);
    expect(h.unfollow).not.toHaveBeenCalled();
    await act(async () => done({ isFollowing: true, followersCount: 1 }));
  });

  it('a refused call goes back and says so for 4 seconds', async () => {
    qc.setQueryData(['/api/cats/7', 'dev-1'], { cat: {}, isFollowing: false, followersCount: 9 });
    h.follow.mockRejectedValue(new Error('429'));
    view();
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(button());
    });
    expect(button().textContent).toBe('Follow');
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText(en('followFailed'))).toBeTruthy();
    expect(qc.getQueryData(['/api/cats/7', 'dev-1'])).toMatchObject({ isFollowing: false, followersCount: 9 });
    act(() => {
      vi.advanceTimersByTime(4100);
    });
    expect(screen.queryByText(en('followFailed'))).toBeNull();
  });

  it('offline: disabled, with the connection note, and a tap does nothing', () => {
    view({ isOnline: false });
    expect((button() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('You need a connection to follow Agatha.')).toBeTruthy();
    fireEvent.click(button());
    expect(h.follow).not.toHaveBeenCalled();
  });

  it('the heart is hidden from screen readers; the target is at least 44 px', () => {
    view();
    expect(document.querySelector('[data-icon="heart-outline"]')!.getAttribute('aria-hidden')).toBe('true');
    const s = getComputedStyle(button());
    expect(parseInt(s.minHeight, 10)).toBeGreaterThanOrEqual(44);
    expect(parseInt(s.minWidth, 10)).toBeGreaterThanOrEqual(44);
  });
});

function en(k: string): string {
  return (TRANSLATIONS.en as Record<string, string>)[k]!;
}
