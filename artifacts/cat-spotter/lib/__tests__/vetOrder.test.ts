/**
 * SYC-570 (Samuel, 24 Oct 2026): every report vet list shows the clinic
 * nearest the phone first and says which one it is.
 */
import { describe, expect, it } from 'vitest';
import { getGuidance } from '@workspace/welfare-guidance';
import { distanceKm, formatKm, orderVets } from '../vetOrder';

const vets = getGuidance('en').vets;
const ids = (list: ReturnType<typeof orderVets>) => list.map((o) => o.clinic.id);
const clinic = (id: string) => vets.find((v) => v.id === id)!;
const at = (id: string, dLat = 0) => ({
  latitude: clinic(id).coordinates!.lat + dLat,
  longitude: clinic(id).coordinates!.lng,
});

describe('orderVets', () => {
  it('has the fixed order and no tags when there is no fix', () => {
    const list = orderVets(vets, null);
    expect(ids(list)).toEqual(vets.map((v) => v.id));
    expect(list.every((o) => o.km === null && !o.closest)).toBe(true);
  });

  it('puts the nearest measured clinic first and tags only it', () => {
    const near = orderVets(vets, at('symviosis'));
    expect(near[0]!.clinic.id).toBe('symviosis');
    expect(near[0]!.closest).toBe(true);
    expect(near[0]!.km!).toBeLessThan(0.01);
    expect(near.filter((o) => o.closest)).toHaveLength(1);

    const other = orderVets(vets, at('cyclades-vets'));
    expect(other[0]!.clinic.id).toBe('cyclades-vets');
  });

  it('lists every clinic exactly once, in distance order for the measured ones', () => {
    const list = orderVets(vets, at('symviosis'));
    expect([...ids(list)].sort()).toEqual(vets.map((v) => v.id).sort());
    const kms = list.filter((o) => o.km !== null).map((o) => o.km!);
    expect(kms).toEqual([...kms].sort((a, b) => a - b));
  });

  it('measures all three clinics now that Dr Dermitzaki has a pin, and puts one with no pin last', () => {
    const list = orderVets(vets, at('cyclades-vets'));
    expect(list.every((o) => o.km !== null)).toBe(true);
    const noPin = { ...clinic('dermitzaki'), id: 'nopin', coordinates: null };
    const withNoPin = orderVets([noPin, ...vets.filter((v) => v.id !== 'dermitzaki')], at('symviosis'));
    expect(withNoPin[withNoPin.length - 1]).toMatchObject({ km: null, closest: false });
    expect(withNoPin[withNoPin.length - 1]!.clinic.id).toBe('nopin');
    expect(withNoPin[0]!.closest).toBe(true);
  });

  it('keeps the fixed order when the fix is nowhere near Syros', () => {
    const melbourne = { latitude: -37.81, longitude: 144.96 };
    const list = orderVets(vets, melbourne);
    expect(ids(list)).toEqual(vets.map((v) => v.id));
    expect(list.some((o) => o.closest)).toBe(false);
  });
});

describe('distanceKm / formatKm', () => {
  it('measures a straight line', () => {
    expect(distanceKm({ latitude: 37, longitude: 25 }, { lat: 37.1, lng: 25 })).toBeCloseTo(11.12, 1);
  });
  it('shows one decimal under 10 km and whole kilometres above, never "0.0"', () => {
    expect(formatKm(1.24)).toBe('1.2');
    expect(formatKm(0.004)).toBe('0.1');
    expect(formatKm(12.6)).toBe('13');
  });
});
