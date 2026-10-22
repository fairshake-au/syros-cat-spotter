/**
 * SYC-42 (Samuel, 2 Oct 2026): "This cat needs help" on the review screen
 * ("Is this the same cat?") reuses the sighting's photo and place, so the
 * report opens on screen 2, like it does from Spot.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/pendingPhotos', () => ({ readPendingPhotoBase64: vi.fn() }));

import { reviewReportHandoff, setReportHandoff, takeReportHandoff } from '../reportHandoff';
import { startFlow } from '../reportFlow';

describe('reviewReportHandoff', () => {
  it("an online submission: reads the review photo by its ref, and takes the sighting's place", async () => {
    const read = vi.fn(async () => 'QUJD');
    const h = await reviewReportHandoff({ photoRef: 'idb:review-12', lat: 37.44, lng: 24.94 }, read);
    expect(read).toHaveBeenCalledWith('idb:review-12');
    expect(h.photo).toEqual({ uri: 'data:image/jpeg;base64,QUJD', base64: 'QUJD' });
    expect(h.coords).toEqual({ latitude: 37.44, longitude: 24.94 });
    expect(startFlow(h).step).toBe(2);
  });

  it('a queued sighting: uses its inline photo (a data URL is unwrapped) without reading storage', async () => {
    const read = vi.fn(async () => null);
    const h = await reviewReportHandoff(
      { photoBase64: 'data:image/jpeg;base64,WFla', photoRef: 'file:///x.jpg', lat: 37.4, lng: 24.9 },
      read,
    );
    expect(read).not.toHaveBeenCalled();
    expect(h.photo?.base64).toBe('WFla');
    expect(startFlow(h).step).toBe(2);
  });

  it('a photo that can no longer be read still hands over the place (the flow then opens on screen 1)', async () => {
    const h = await reviewReportHandoff({ photoRef: 'idb:gone', lat: 37.4, lng: 24.9 }, async () => null);
    expect(h.photo).toBeUndefined();
    expect(h.coords).toEqual({ latitude: 37.4, longitude: 24.9 });
    expect(startFlow(h).step).toBe(1);
  });

  it('no place saved: no coords', async () => {
    const h = await reviewReportHandoff({ photoRef: 'idb:x', lat: null, lng: null }, async () => 'QQ==');
    expect(h.coords).toBeUndefined();
  });
});

describe('the handoff itself', () => {
  it('is taken once', () => {
    setReportHandoff({ coords: { latitude: 1, longitude: 2 } });
    expect(takeReportHandoff()).toEqual({ coords: { latitude: 1, longitude: 2 } });
    expect(takeReportHandoff()).toBeNull();
  });
});

describe('SYC-504: the handoff carries the cat', () => {
  it('a cat left in the handoff is taken once, and opens the flow about that cat', () => {
    const cat = { id: 7, name: 'Tigris', photoUrl: null };
    setReportHandoff({ cat });
    const taken = takeReportHandoff();
    expect(taken).toEqual({ cat });
    expect(startFlow(taken).cat).toEqual(cat);
    expect(takeReportHandoff()).toBeNull();
  });
});
