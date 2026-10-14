// @vitest-environment jsdom
/**
 * SYC-130 Task 8: "This is my cat" in two screens, the refusals, and letting
 * go (docs/specs/claiming-a-cat.md §4.2, §4.4, §6). English strings render as
 * themselves so these also pin the approved wording.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Cat } from '@workspace/api-client-react';

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@/lib/modalVisibility', () => ({ registerModalOpen: () => () => {} }));

const h = vi.hoisted(() => ({
  isOnline: true,
  deviceId: 'dev-1' as string | null,
  addOwnedCat: vi.fn(),
  removeOwnedCat: vi.fn(),
  claimMutate: vi.fn(),
  letGoMutate: vi.fn(),
  updateMutate: vi.fn(),
  claimOpts: undefined as any,
  letGoOpts: undefined as any,
  updateOpts: undefined as any,
  invalidate: vi.fn(),
  removeQueries: vi.fn(),
  setQueryData: vi.fn(),
  here: vi.fn(async () => null as { latitude: number; longitude: number } | null),
}));

vi.mock('@/context/DeviceContext', () => ({
  useDevice: () => ({
    deviceId: h.deviceId,
    addOwnedCat: h.addOwnedCat,
    removeOwnedCat: h.removeOwnedCat,
  }),
}));
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ isOnline: h.isOnline }) }));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS } = await import('@/lib/i18n');
  return { useLanguage: () => ({ t: (k: string) => TRANSLATIONS.en[k] ?? k }) };
});
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: h.invalidate,
    removeQueries: h.removeQueries,
    setQueryData: h.setQueryData,
    setQueriesData: h.setQueryData,
  }),
}));
vi.mock('@/lib/currentPosition', () => ({ getCurrentCoords: h.here }));
// A stand-in map: one button per thing a map can report.
vi.mock('@/components/LocationPicker', () => ({
  LocationPicker: (p: {
    latitude: number;
    longitude: number;
    onChange: (c: { latitude: number; longitude: number }) => void;
  }) => (
    <div>
      <button data-testid="map-start" onClick={() => p.onChange({ latitude: p.latitude, longitude: p.longitude })}>
        map reports its start
      </button>
      <button data-testid="map-near" onClick={() => p.onChange({ latitude: p.latitude + 0.002, longitude: p.longitude })}>
        map moved near
      </button>
      <button data-testid="map-far" onClick={() => p.onChange({ latitude: p.latitude + 0.02, longitude: p.longitude })}>
        map moved far
      </button>
    </div>
  ),
}));
vi.mock('@workspace/api-client-react', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return {
    ...real,
    useClaimCat: (o: unknown) => {
      h.claimOpts = o;
      return { mutate: h.claimMutate, isPending: false };
    },
    useLetGoCat: (o: unknown) => {
      h.letGoOpts = o;
      return { mutate: h.letGoMutate, isPending: false };
    },
    useUpdateCat: (o: unknown) => {
      h.updateOpts = o;
      return { mutate: h.updateMutate, isPending: false };
    },
    getGetCatQueryKey: (id: number) => [`/api/cats/${id}`],
  };
});

import { ClaimCatSheet } from '../ClaimCatSheet';
import { Button } from '../purropolis/Button';
import { TRANSLATIONS } from '@/lib/i18n';

const en = TRANSLATIONS.en;
const say = (key: string) => en[key]!.split('{name}').join('Agatha');

const CAT = {
  id: 7,
  name: 'Agatha',
  lat: 37.4448,
  lng: 24.9425,
  hasHome: false,
  homeDescription: null,
} as unknown as Cat;

const onClose = vi.fn();

function open(mode: 'claim' | 'edit' = 'claim', cat: Cat = CAT) {
  return render(<ClaimCatSheet visible mode={mode} cat={cat} onClose={onClose} />);
}

const button = (label: string) => {
  const el = Array.from(document.querySelectorAll('[role="button"], button')).find(
    (e) => e.textContent?.trim() === label,
  );
  if (!el) throw new Error(`No button labelled ${label}`);
  return el as HTMLElement;
};
const disabled = (el: HTMLElement) => el.getAttribute('aria-disabled') === 'true' || (el as HTMLButtonElement).disabled;

function refusal(status: number, code?: string) {
  return new ApiError(
    new Response(null, { status }),
    code ? { error: 'x', code } : { error: 'x' },
    { method: 'POST', url: '/api/cats/7/claim' },
  );
}

function stepTwo() {
  open();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(button(say('claimYes')));
}

beforeEach(() => {
  h.isOnline = true;
  h.deviceId = 'dev-1';
  h.here.mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('screen 1: is it really theirs? (§4.2)', () => {
  it('shows the approved words, name-first', () => {
    open();
    expect(screen.getByText('Is Agatha your cat?')).toBeTruthy();
    expect(screen.getByText(say('claimConfirmBody'))).toBeTruthy();
    expect(screen.getByText(say('claimGuardianLine'))).toBeTruthy();
    expect(screen.getByText(say('claimTrustLine'))).toBeTruthy();
    expect(screen.getByText('I live on Syros')).toBeTruthy();
  });

  it('"Yes" is disabled until "I live on Syros" is ticked', () => {
    open();
    const yes = button('Yes, Agatha lives with me');
    expect(disabled(yes)).toBe(true);
    fireEvent.click(yes);
    expect(screen.queryByText('Where does Agatha live?')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(disabled(button('Yes, Agatha lives with me'))).toBe(false);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(disabled(button('Yes, Agatha lives with me'))).toBe(true);
  });

  it('Cancel closes the sheet', () => {
    open();
    fireEvent.click(button('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ticking the box and saying yes moves to the pin screen without sending anything', () => {
    stepTwo();
    expect(screen.getByText('Where does Agatha live?')).toBeTruthy();
    expect(h.claimMutate).not.toHaveBeenCalled();
  });
});

describe('screen 2: where? (§4.2)', () => {
  it('shows the approved words', () => {
    stepTwo();
    expect(screen.getByText('Put the pin on your home, or')).toBeTruthy();
    expect(screen.getByText('Anything else that helps find Agatha?')).toBeTruthy();
    expect(screen.getByText('Only you and Syros Cats will see the pin and the note.')).toBeTruthy();
  });

  it('"Done" is disabled until the pin has been placed', () => {
    stepTwo();
    expect(disabled(button('Done'))).toBe(true);
    // A map that reports its own starting centre is not the person placing the pin.
    fireEvent.click(screen.getByTestId('map-start'));
    expect(disabled(button('Done'))).toBe(true);
    fireEvent.click(screen.getByTestId('map-near'));
    expect(disabled(button('Done'))).toBe(false);
  });

  it('"Use where I am now" places the pin without a map move', async () => {
    h.here.mockResolvedValue({ latitude: CAT.lat + 0.001, longitude: CAT.lng });
    stepTwo();
    await act(async () => {
      fireEvent.click(button('Use where I am now'));
    });
    await waitFor(() => expect(disabled(button('Done'))).toBe(false));
  });

  it('"Use where I am now" with no location leaves Done disabled', async () => {
    stepTwo();
    await act(async () => {
      fireEvent.click(button('Use where I am now'));
    });
    expect(disabled(button('Done'))).toBe(true);
  });

  it('sends the confirmations, the pin and the note, and nothing else', () => {
    stepTwo();
    fireEvent.click(screen.getByTestId('map-near'));
    fireEvent.change(screen.getByPlaceholderText('e.g. the blue house by the church'), {
      target: { value: '  the blue house  ' },
    });
    fireEvent.click(button('Done'));
    expect(h.claimMutate).toHaveBeenCalledTimes(1);
    const arg = h.claimMutate.mock.calls[0]![0];
    expect(arg.catId).toBe(7);
    expect(arg.data).toEqual({
      deviceId: 'dev-1',
      livesOnSyros: true,
      livesInMyHome: true,
      homePin: { lat: CAT.lat + 0.002, lng: CAT.lng },
      homeNote: 'the blue house',
    });
  });

  it('leaves the note out when it is blank', () => {
    stepTwo();
    fireEvent.click(screen.getByTestId('map-near'));
    fireEvent.click(button('Done'));
    expect(h.claimMutate.mock.calls[0]![0].data).not.toHaveProperty('homeNote');
  });

  it('a pin more than 1 km away is refused in the app, before sending, without saying how far', () => {
    stepTwo();
    fireEvent.click(screen.getByTestId('map-far'));
    fireEvent.click(button('Done'));
    expect(h.claimMutate).not.toHaveBeenCalled();
    expect(screen.getByText(say('claimRefusedTooFar'))).toBeTruthy();
  });

  it('Cancel closes the sheet', () => {
    stepTwo();
    fireEvent.click(button('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('offline, Done is disabled with the connection line, and a claim is never queued', () => {
    h.isOnline = false;
    stepTwo();
    fireEvent.click(screen.getByTestId('map-near'));
    expect(disabled(button('Done'))).toBe(true);
    expect(screen.getByText('You need a connection to do this.')).toBeTruthy();
    // And if it is sent anyway, react-query must try now and fail now, not pause it.
    expect(h.claimOpts.mutation.networkMode).toBe('always');
    expect(h.letGoOpts.mutation.networkMode).toBe('always');
  });
});

describe('what the server says no to (§4.4)', () => {
  const cases: Array<[string, number, string | undefined, string]> = [
    ['NOT_MET', 403, 'NOT_MET', say('claimRefusedNotMet')],
    ['ALREADY_HOMED', 409, 'ALREADY_HOMED', 'Agatha already has a home.'],
    ['NOT_ON_STREET', 409, 'NOT_ON_STREET', 'Agatha can’t be marked as yours right now.'],
    ['PIN_TOO_FAR', 422, 'PIN_TOO_FAR', say('claimRefusedTooFar')],
    ['NOT_CONFIRMED', 422, 'NOT_CONFIRMED', 'Only people who live on Syros can say a cat lives with them.'],
    ['CLAIM_LIMIT', 429, 'CLAIM_LIMIT', 'Please try again later.'],
    ['CLAIM_COOLDOWN', 429, 'CLAIM_COOLDOWN', 'Please try again later.'],
    ['a 429 with no code', 429, undefined, 'Please try again later.'],
    ['a plain 400', 400, undefined, 'Please try again later.'],
    ['OFFENSIVE_NOTE', 400, 'OFFENSIVE_NOTE', en.claimRefusedNote!],
  ];

  it.each(cases)('%s shows its line', (_name, status, code, text) => {
    stepTwo();
    act(() => h.claimOpts.mutation.onError(refusal(status, code)));
    expect(screen.getByText(text)).toBeTruthy();
  });

  it('reads the code, not the status: a 409 NOT_ON_STREET is not "already has a home"', () => {
    stepTwo();
    act(() => h.claimOpts.mutation.onError(refusal(409, 'NOT_ON_STREET')));
    expect(screen.queryByText('Agatha already has a home.')).toBeNull();
  });

  it('a 403 NOT_MET is not "only the owner can edit"', () => {
    stepTwo();
    act(() => h.claimOpts.mutation.onError(refusal(403, 'NOT_MET')));
    expect(screen.queryByText(en.claimNotOwner!)).toBeNull();
  });

  it('no connection says so', () => {
    stepTwo();
    act(() => h.claimOpts.mutation.onError(new TypeError('Failed to fetch')));
    expect(screen.getByText('You need a connection to do this.')).toBeTruthy();
  });

  it('a stale page (409 or NOT_MET) refreshes the cat; other refusals do not', () => {
    stepTwo();
    act(() => h.claimOpts.mutation.onError(refusal(422, 'PIN_TOO_FAR')));
    expect(h.invalidate).not.toHaveBeenCalled();
    act(() => h.claimOpts.mutation.onError(refusal(409, 'ALREADY_HOMED')));
    expect(h.invalidate).toHaveBeenCalled();
  });

  it('success makes this phone the owner, and closes', () => {
    stepTwo();
    act(() => h.claimOpts.mutation.onSuccess({ ...CAT, hasHome: true }));
    expect(h.addOwnedCat).toHaveBeenCalledWith(7);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("the owner's sheet: letting go (§6)", () => {
  const OWNED = { ...CAT, hasHome: true, homeDescription: 'the blue house' } as unknown as Cat;

  it('shows "Agatha doesn’t live with me any more" at the foot', () => {
    open('edit', OWNED);
    expect(screen.getByText('Agatha doesn’t live with me any more')).toBeTruthy();
    expect(screen.queryByText(say('claimConfirmTitle'))).toBeNull();
  });

  it('asks first, in the approved words, and sends nothing until confirmed', () => {
    open('edit', OWNED);
    fireEvent.click(screen.getByText('Agatha doesn’t live with me any more'));
    expect(
      screen.getByText(
        'Agatha will no longer show as having a home, and you won’t be Agatha’s owner in the app.',
      ),
    ).toBeTruthy();
    expect(h.letGoMutate).not.toHaveBeenCalled();
  });

  it('cancelling the confirmation goes back without sending', () => {
    open('edit', OWNED);
    fireEvent.click(screen.getByText('Agatha doesn’t live with me any more'));
    fireEvent.click(button('Cancel'));
    expect(h.letGoMutate).not.toHaveBeenCalled();
    expect(screen.getByText('Update your cat')).toBeTruthy();
  });

  it('confirming calls the let-go hook with the device id', () => {
    open('edit', OWNED);
    fireEvent.click(screen.getByText('Agatha doesn’t live with me any more'));
    fireEvent.click(button('Agatha doesn’t live with me any more'));
    expect(h.letGoMutate).toHaveBeenCalledWith({ catId: 7, data: { deviceId: 'dev-1' } });
  });

  it('the confirm button’s label is not cut off with an ellipsis, even for a long name', () => {
    const LONG = { ...OWNED, name: 'Preview Street Cat With A Long Name' } as unknown as Cat;
    open('edit', LONG);
    fireEvent.click(screen.getByText('Preview Street Cat With A Long Name doesn’t live with me any more'));
    const full = 'Preview Street Cat With A Long Name doesn’t live with me any more';
    const label = button(full).querySelector('div, span') as HTMLElement;
    expect(label.textContent).toBe(full);
    // A default button label carries react-native-web's one-line class.
    cleanup();
    render(<Button>{full}</Button>);
    const oneLine = screen.getByText(full).className.split(' ');
    cleanup();
    open('edit', LONG);
    fireEvent.click(screen.getByText(full));
    const wrapped = button(full).querySelector('div, span') as HTMLElement;
    expect(oneLine.filter((c) => !wrapped.className.split(' ').includes(c)).length).toBeGreaterThan(0);
  });

  it('an owner who claimed without a note can still rename the cat', () => {
    const NO_NOTE = { ...OWNED, homeDescription: null } as unknown as Cat;
    open('edit', NO_NOTE);
    fireEvent.change(screen.getByDisplayValue('Agatha'), { target: { value: 'Agatha B' } });
    expect(disabled(button('Save changes'))).toBe(false);
    fireEvent.click(button('Save changes'));
    expect(h.updateMutate).toHaveBeenCalledWith({
      catId: 7,
      data: { deviceId: 'dev-1', name: 'Agatha B', homeDescription: '' },
    });
  });

  it('an emptied note saves as empty; a blank name still cannot be saved', () => {
    open('edit', OWNED);
    fireEvent.change(screen.getByDisplayValue('the blue house'), { target: { value: '' } });
    expect(disabled(button('Save changes'))).toBe(false);
    fireEvent.change(screen.getByDisplayValue('Agatha'), { target: { value: '   ' } });
    expect(disabled(button('Save changes'))).toBe(true);
  });

  it('NOT_OWNER on let-go (the team removed this owner): drops the id, refreshes, closes', () => {
    open('edit', OWNED);
    act(() => h.letGoOpts.mutation.onError(refusal(403, 'NOT_OWNER')));
    expect(h.removeOwnedCat).toHaveBeenCalledWith(7);
    expect(h.invalidate).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('NOT_OWNER on a save does the same', () => {
    open('edit', OWNED);
    act(() => h.updateOpts.mutation.onError(refusal(403, 'NOT_OWNER')));
    expect(h.removeOwnedCat).toHaveBeenCalledWith(7);
    expect(h.invalidate).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('other refusals do not drop the id', () => {
    open('edit', OWNED);
    act(() => h.letGoOpts.mutation.onError(refusal(429, 'CLAIM_LIMIT')));
    expect(h.removeOwnedCat).not.toHaveBeenCalled();
  });

  it('on success the cat leaves this phone’s owned list at once', () => {
    open('edit', OWNED);
    act(() => h.letGoOpts.mutation.onSuccess(OWNED));
    expect(h.removeOwnedCat).toHaveBeenCalledWith(7);
    expect(onClose).toHaveBeenCalled();
  });

  it('offline, the confirm button is disabled with the connection line', () => {
    h.isOnline = false;
    open('edit', OWNED);
    fireEvent.click(screen.getByText('Agatha doesn’t live with me any more'));
    expect(disabled(button('Agatha doesn’t live with me any more'))).toBe(true);
    expect(screen.getByText('You need a connection to do this.')).toBeTruthy();
  });

  it('a failed let-go says why in plain words', () => {
    open('edit', OWNED);
    fireEvent.click(screen.getByText('Agatha doesn’t live with me any more'));
    act(() => h.letGoOpts.mutation.onError(new TypeError('Failed to fetch')));
    expect(screen.getByText('You need a connection to do this.')).toBeTruthy();
  });
});
