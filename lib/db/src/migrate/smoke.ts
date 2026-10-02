import { MigrationError } from "./runner";

// SYC-121, task B.5. With the SYC-113 pre-launch gate on, an unauthenticated
// GET gets a 401 (artifacts/api-server/src/middlewares/prelaunchGate.ts), so
// smoke needs a pass too. Sends X-Prelaunch-Key on every request when
// PRELAUNCH_KEY is set in the environment; when it isn't (CI, or a
// deployment with the gate off), behaviour is unchanged.
// A hanging endpoint must not hang the whole job — fail fast with a clear
// message instead. Overridable via SMOKE_TIMEOUT_MS so tests can use a short
// timeout without waiting 30s for the real one to fire.
const DEFAULT_SMOKE_TIMEOUT_MS = 30_000;

// A typo here (SMOKE_TIMEOUT_MS=abc, =1.5, =-5, =0) must not read as either
// "the endpoint is broken" (a same-shaped "timed out"/"Roll back now"
// message) or a silent no-op — it must say plainly what's wrong, and it must
// say so before any request goes out.
function parseSmokeTimeoutMs(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_SMOKE_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new MigrationError(
      "SMOKE_TIMEOUT_MS must be a positive integer (ms)",
    );
  }
  return n;
}

export async function smoke(
  baseUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!baseUrl)
    throw new MigrationError(
      "usage: smoke <base-url>, e.g. https://api.catspotters.com",
    );
  const timeoutMs = parseSmokeTimeoutMs(env.SMOKE_TIMEOUT_MS);
  const base = baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {};
  if (env.PRELAUNCH_KEY) headers["X-Prelaunch-Key"] = env.PRELAUNCH_KEY;
  // A stalled body must fail the same way a stalled connect does. The
  // request's AbortSignal keeps applying while a body is being read, so
  // reading it here (under the same try/catch as the fetch itself) is what
  // makes that true — reading it later, after get() returns, would not be
  // covered and would surface as a raw, uncaught DOMException instead of the
  // "Roll back now" message (and would have already printed `ok`).
  const asSmokeError = (err: unknown, p: string): Error =>
    err instanceof Error && err.name === "TimeoutError"
      ? new MigrationError(
          `smoke: GET ${p} timed out after ${timeoutMs / 1000} s. Roll back now.`,
        )
      : err instanceof Error
        ? err
        : new Error(String(err));
  const cancelBody = async (res: Response): Promise<void> => {
    await res.body?.cancel();
  };
  const jsonBody = async <T>(res: Response): Promise<T> =>
    res.json() as Promise<T>;
  const get = async <T>(
    p: string,
    readBody: (res: Response) => Promise<T>,
  ): Promise<T> => {
    let res: Response;
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      res = await fetch(`${base}${p}`, { headers, signal });
    } catch (err) {
      throw asSmokeError(err, p);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new MigrationError(
        `smoke: GET ${p} returned ${res.status}. Roll back now.`,
      );
    }
    let body: T;
    try {
      body = await readBody(res);
    } catch (err) {
      throw asSmokeError(err, p);
    }
    console.log(`ok  GET ${p} ${res.status}`);
    return body;
  };
  await get("/api/healthz", cancelBody);
  const cats = await get("/api/cats", jsonBody<{ photoUrl: string | null }[]>);
  // SYC-98: photoUrl is null for a cat with no real photo yet (the
  // primaryPhotoId: 0 sentinel, or a missing photo row) — it is never a
  // string to compare against, so this must not call a string method on it.
  const withPhoto = cats.find(
    (c): c is { photoUrl: string } => c.photoUrl !== null,
  );
  if (withPhoto) {
    await get(withPhoto.photoUrl, cancelBody);
  } else if (cats.length === 0) {
    // A genuinely empty catalogue (a fresh development branch, say) — not a
    // failure, nothing to exercise.
    console.log("--  no cat has a photo yet; photo route not exercised");
  } else {
    // SYC-98 Fable re-review, should-fix 1: production has 52 photos and
    // cats that use them, so this is never legitimately true there. Every
    // cat coming back with a null photoUrl is exactly the symptom of a
    // broken photos join (0002 / the LEFT JOIN in listCatsWithStats) — the
    // one failure mode this step of the deploy order exists to catch. A
    // quiet pass here would mean smoke prints "ok" and exits 0 while photos
    // are actually broken, and the first signal would be a tester seeing
    // blank photos instead of the runbook's "if smoke fails, roll back".
    throw new MigrationError(
      `smoke: /api/cats returned ${cats.length} cats and none has a photoUrl — photo serving looks broken. Roll back now.`,
    );
  }
}
