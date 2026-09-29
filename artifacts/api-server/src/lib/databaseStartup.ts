/**
 * SYC-121. Logs which database the app is talking to, and how far away it
 * is, once the server has started listening. Never blocks start-up: if the
 * database is unreachable it logs a warning and resolves rather than
 * throwing, so a transient hiccup at boot doesn't crash the process.
 *
 * Runs `select 1` twice: the first round trip after `listen` can include a
 * Neon compute waking from suspend, so only the second is logged as the
 * round trip. C.7, D.4 and E.9 in docs/superpowers/plans/syc-121-neon-switchover.md
 * read this log line to confirm a deployment is on the Neon production host
 * with a round trip under 20 ms.
 */

export interface QueryablePool {
  query(sql: string): Promise<unknown>;
}

export interface DatabaseTarget {
  source: string;
  host: string;
}

export interface StartupLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
}

export async function logDatabaseTarget(
  pool: QueryablePool,
  target: DatabaseTarget,
  logger: StartupLogger,
): Promise<void> {
  try {
    await pool.query("select 1");
    const start = performance.now();
    await pool.query("select 1");
    const roundTripMs = performance.now() - start;
    logger.info(
      { source: target.source, host: target.host, roundTripMs },
      "database target",
    );
  } catch (err) {
    logger.warn(
      {
        source: target.source,
        host: target.host,
        err: err instanceof Error ? err.message : String(err),
      },
      "database target: could not confirm connectivity at start-up",
    );
  }
}
