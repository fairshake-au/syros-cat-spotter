export type DatabaseUrlSource =
  | "APP_DATABASE_URL"
  | "DEV_DATABASE_URL"
  | "DATABASE_URL";

// SYC-121. Production reads APP_DATABASE_URL (Neon production, pooled) and never
// falls back. A Replit workspace reads DEV_DATABASE_URL (Neon development) and
// refuses Replit's own managed database, which is frozen. CI and local
// development keep DATABASE_URL.
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv): {
  url: string;
  source: DatabaseUrlSource;
} {
  if (env.NODE_ENV === "production") {
    const url = env.APP_DATABASE_URL;
    if (!url)
      throw new Error(
        "APP_DATABASE_URL must be set in production (SYC-121). Refusing to start.",
      );
    if (!/[?&]sslmode=(require|verify-full)\b/.test(url)) {
      throw new Error(
        `APP_DATABASE_URL for ${describeHost(url)} has no sslmode=verify-full. Refusing to start.`,
      );
    }
    return { url, source: "APP_DATABASE_URL" };
  }
  if (env.DEV_DATABASE_URL)
    return { url: env.DEV_DATABASE_URL, source: "DEV_DATABASE_URL" };
  if (env.REPL_ID) {
    throw new Error(
      "DEV_DATABASE_URL is not set. In a Replit workspace the app uses the Neon development branch; " +
        "Replit's own database is frozen (SYC-121). Add DEV_DATABASE_URL to the workspace secrets.",
    );
  }
  if (!env.DATABASE_URL)
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  return { url: env.DATABASE_URL, source: "DATABASE_URL" };
}

export function describeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "(unparseable database URL)";
  }
}
