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

export async function smoke(
  baseUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!baseUrl)
    throw new MigrationError(
      "usage: smoke <base-url>, e.g. https://api.catspotters.com",
    );
  const base = baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {};
  if (env.PRELAUNCH_KEY) headers["X-Prelaunch-Key"] = env.PRELAUNCH_KEY;
  const timeoutMs = env.SMOKE_TIMEOUT_MS
    ? Number(env.SMOKE_TIMEOUT_MS)
    : DEFAULT_SMOKE_TIMEOUT_MS;
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
  const cats = await get("/api/cats", jsonBody<{ photoUrl: string }[]>);
  // Owner-registered cats carry the photo id 0 sentinel, which 404s by design.
  const withPhoto = cats.find((c) => !c.photoUrl.endsWith("/0"));
  if (withPhoto) {
    await get(withPhoto.photoUrl, cancelBody);
  } else {
    console.log("--  no cat has a photo yet; photo route not exercised");
  }
}
