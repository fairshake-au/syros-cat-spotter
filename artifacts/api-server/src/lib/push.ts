import { logger } from "./logger";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Fire-and-forget Expo push notification. Errors are logged, never thrown —
 * push delivery must not break the request that triggered the fan-out.
 */
export async function sendPushNotification(
  token: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: token, title, body, data, sound: "default" }),
      // Review of #89, finding 6: a hung Expo call must not hold up the
      // mail drain (or anything else that awaits a push).
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn(
        { status: res.status, body: await res.text().catch(() => "") },
        "Expo push send failed",
      );
    }
  } catch (err) {
    logger.warn({ err }, "Expo push send failed");
  }
}
