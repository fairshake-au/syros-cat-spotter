/**
 * Closest vet first (SYC-570; Samuel, 24 Oct 2026: "measure from their
 * current location, and do this in every report vet list. make it clear which
 * one is closest"). Framework-free so the rules are unit-testable.
 *
 * Measured in a straight line from the phone's own fix to each clinic's
 * published pin (the petrol station opposite, good to about 100 m). Rules:
 *  - no fix, or a fix nowhere near Syros (someone setting the app up at home):
 *    the list keeps its fixed order and nothing is tagged or measured;
 *  - a clinic with no coordinates can't be measured, so it goes last and shows
 *    no distance (none today: all three clinics have a pin);
 *  - only a measured clinic is ever tagged "closest".
 */
import type { Clinic } from '@workspace/welfare-guidance';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface OrderedVet {
  clinic: Clinic;
  /** Straight-line kilometres, or null when it can't be measured. */
  km: number | null;
  /** The nearest measured clinic. At most one per list. */
  closest: boolean;
}

/** A fix further than this from every clinic isn't "here": keep the fixed order. */
export const FAR_AWAY_KM = 50;

export function distanceKm(a: LatLng, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.latitude);
  const dLng = rad(b.lng - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export function orderVets(vets: Clinic[], from: LatLng | null): OrderedVet[] {
  const fixed = vets.map((clinic) => ({ clinic, km: null, closest: false }));
  if (!from || !Number.isFinite(from.latitude) || !Number.isFinite(from.longitude)) return fixed;

  const measured = vets
    .filter((c) => c.coordinates)
    .map((clinic) => ({ clinic, km: distanceKm(from, clinic.coordinates!), closest: false }))
    .sort((a, b) => a.km - b.km);
  if (measured.length === 0 || measured[0]!.km > FAR_AWAY_KM) return fixed;
  measured[0]!.closest = true;

  const unmeasured = vets.filter((c) => !c.coordinates).map((clinic) => ({ clinic, km: null, closest: false }));
  return [...measured, ...unmeasured];
}

/** "0.8", "1.2", "12": one decimal under 10 km, whole kilometres above. */
export function formatKm(km: number): string {
  return km < 10 ? (Math.max(km, 0.1)).toFixed(1) : String(Math.round(km));
}
