import { createHmac } from "node:crypto";
import { CELL_LAT_DEG, CELL_LNG_DEG, haversineKm, type LatLng } from "@workspace/geo";

/**
 * Location blurring (cat-record-data-spine.md §6.2, §10.6; data spine plan
 * PR 6). Pure apart from reading BLUR_GRID_SECRET once.
 *
 * Every public cat position is the centre of the fixed 250 m cell its exact
 * position falls in. Deterministic: a thousand requests return one answer,
 * so sampling one cat repeatedly yields nothing (§6.2 Option C).
 *
 * The grid's origin is shifted by one sub-cell offset for the whole island,
 * derived by HMAC from a server-held secret ("One improvement worth taking",
 * §6.2). Without it the lattice can be read from the source and the cat's
 * exact box is known; with it, only "within 250 m of the published point".
 * If the secret leaks, the guarantee falls back to the plain grid, which is
 * no worse than having no secret.
 */

/** Side of a published cell, in metres. The one configuration value (§6.2). */
export const BLUR_CELL_METRES = 250;
// BLUR_DISPLAY_RADIUS_METRES is retired: the client draws the cell (§6.2).

/** Fewer bytes than this and the secret doesn't count as set. */
export const MIN_BLUR_SECRET_LENGTH = 32;

/**
 * Used only when NODE_ENV is exactly "development" or "test", so local runs
 * and the test suite work without a secret. Never used in production:
 * assertBlurConfigured() refuses to start the server instead.
 */
const DEV_ONLY_SECRET = "development-and-test-only-blur-grid-secret";

/** Decimal places kept in a published coordinate: about 0.1 m. */
const PUBLISHED_DECIMALS = 6;

function isDevOrTest(): boolean {
  const nodeEnv = process.env["NODE_ENV"];
  return nodeEnv === "development" || nodeEnv === "test";
}

function configuredSecret(): string | null {
  const raw = process.env["BLUR_GRID_SECRET"] ?? "";
  return raw.length >= MIN_BLUR_SECRET_LENGTH ? raw : null;
}

/**
 * Called at start-up. The same rule as the pre-launch gate (prelaunch.ts):
 * anything other than exactly "development" or "test" counts as production,
 * so an unset NODE_ENV can never publish the public grid by accident.
 */
export function assertBlurConfigured(): void {
  if (configuredSecret() || isDevOrTest()) return;
  throw new Error(
    `BLUR_GRID_SECRET is required (at least ${MIN_BLUR_SECRET_LENGTH} characters) outside development and test. ` +
      "Add it to the deployment's secrets before publishing.",
  );
}

/** One line for the start-up log: whether the secret is set, never its value. */
export function describeBlur(): string {
  return configuredSecret()
    ? "Location blurring: grid secret present"
    : "Location blurring: no grid secret (development/test grid in use)";
}

let cached: { secret: string; offset: LatLng } | null = null;

/** The grid origin's offset, in degrees, inside one cell. */
export function gridOffset(): LatLng {
  const secret = configuredSecret() ?? (isDevOrTest() ? DEV_ONLY_SECRET : null);
  if (secret === null) {
    // Belt and braces: start-up already refused. Never fall back to the
    // public grid in production.
    throw new Error("BLUR_GRID_SECRET is not configured");
  }
  if (cached?.secret === secret) return cached.offset;
  const digest = createHmac("sha256", secret).update("syc-41/blur-grid-origin/v1").digest();
  // Two independent fractions in [0, 1).
  const fLat = digest.readUInt32BE(0) / 2 ** 32;
  const fLng = digest.readUInt32BE(4) / 2 ** 32;
  const offset = { lat: fLat * CELL_LAT_DEG, lng: fLng * CELL_LNG_DEG };
  cached = { secret, offset };
  return offset;
}

function round(n: number): number {
  return Number(n.toFixed(PUBLISHED_DECIMALS));
}

/**
 * The centre of the secret-origin 250 m cell (lat, lng) falls in.
 * Idempotent: a published centre maps to itself.
 */
export function blurPosition(lat: number, lng: number): LatLng {
  const off = gridOffset();
  const row = Math.floor((lat - off.lat) / CELL_LAT_DEG);
  const col = Math.floor((lng - off.lng) / CELL_LNG_DEG);
  return {
    lat: round((row + 0.5) * CELL_LAT_DEG + off.lat),
    lng: round((col + 0.5) * CELL_LNG_DEG + off.lng),
  };
}

/**
 * Public distance from the viewer to a cat (§6.4.2): measured to the cat's
 * published cell centre, never its exact position, and rounded to 100 m, so
 * three distances can't be trilaterated back to the truth.
 */
export function publicDistanceKm(
  fromLat: number,
  fromLng: number,
  catLat: number,
  catLng: number,
): number {
  const published = blurPosition(catLat, catLng);
  const km = haversineKm({ lat: fromLat, lng: fromLng }, published);
  return Math.round(km * 10) / 10;
}
