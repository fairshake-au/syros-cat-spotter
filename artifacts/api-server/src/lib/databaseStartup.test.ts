import { describe, expect, it, vi } from "vitest";
import { logDatabaseTarget } from "./databaseStartup";

function stubLogger() {
  const info = vi.fn();
  const warn = vi.fn();
  return { info, warn, logger: { info, warn } };
}

describe("logDatabaseTarget", () => {
  it("logs source, host and a numeric roundTripMs, with nothing that looks like a connection string", async () => {
    const pool = { query: vi.fn().mockResolvedValue(undefined) };
    const { info, warn, logger } = stubLogger();
    await logDatabaseTarget(
      pool,
      { source: "APP_DATABASE_URL", host: "ep-prod-pooler.eu-central-1.aws.neon.tech" },
      logger,
    );
    expect(warn).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    const [payload] = info.mock.calls[0]!;
    expect(payload.source).toBe("APP_DATABASE_URL");
    expect(payload.host).toBe("ep-prod-pooler.eu-central-1.aws.neon.tech");
    expect(typeof payload.roundTripMs).toBe("number");
    expect(Number.isFinite(payload.roundTripMs)).toBe(true);
    const serialized = JSON.stringify(info.mock.calls[0]);
    expect(serialized).not.toMatch(/postgres(ql)?:\/\//);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it("logs a warning and resolves, rather than throwing, when the database is unreachable", async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")) };
    const { info, warn, logger } = stubLogger();
    await expect(
      logDatabaseTarget(pool, { source: "DATABASE_URL", host: "localhost" }, logger),
    ).resolves.toBeUndefined();
    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const [payload] = warn.mock.calls[0]!;
    expect(payload.source).toBe("DATABASE_URL");
    expect(payload.host).toBe("localhost");
  });
});
