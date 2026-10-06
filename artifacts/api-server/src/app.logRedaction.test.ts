/**
 * SYC-109: a device id is a credential, so no request-log line may carry one.
 * Logs one request to every route with a device id in its path, through the
 * real app, and checks the id never reaches the output, while each request is
 * still logged (redact, never drop).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const spies = vi.hoisted(() => ({ logLines: [] as string[] }));

vi.mock("./lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/logger")>();
  const { default: pino } = await import("pino");
  const logger = pino(
    { level: "trace", redact: actual.REDACT_PATHS, serializers: actual.LOG_SERIALIZERS },
    { write: (line: string) => void spies.logLines.push(line) },
  );
  return { ...actual, logger };
});

import { pool } from "@workspace/db";
import app from "./app";
import { redactRequestUrl } from "./lib/logger";

const DEVICE = "vitest-logredact-0f3c9a7e2b";

// No device secret is sent, so every route answers 401 before touching the
// database: the request is still logged, which is all this test needs.
const ROUTES: { method: "get" | "post" | "put" | "patch"; path: string }[] = [
  { method: "get", path: `/api/notifications/${DEVICE}` },
  { method: "post", path: `/api/notifications/${DEVICE}/read-all` },
  { method: "post", path: `/api/notifications/${DEVICE}/42/read` },
  { method: "put", path: `/api/profile/${DEVICE}/push-token` },
  { method: "get", path: `/api/profiles/${DEVICE}` },
  { method: "patch", path: `/api/profiles/${DEVICE}` },
  { method: "get", path: `/api/profiles/${DEVICE}/username` },
  { method: "post", path: `/api/profiles/${DEVICE}/username` },
  { method: "get", path: `/api/profiles/${DEVICE}/cats/1/open-sightings` },
  // Express matches routes case-insensitively, so the redaction must too.
  { method: "get", path: `/api/Notifications/${DEVICE}` },
];

beforeEach(() => {
  spies.logLines.length = 0;
});

afterAll(async () => {
  await pool.end();
});

describe("request log redaction (SYC-109)", () => {
  for (const { method, path } of ROUTES) {
    it(`${method.toUpperCase()} ${path.replace(DEVICE, ":deviceId")} logs the request without the device id`, async () => {
      await request(app)[method](path).query({ deviceId: DEVICE });
      const completed = spies.logLines.filter((l) => l.includes('"request completed"'));
      expect(completed).toHaveLength(1);
      expect(completed[0]).toContain(":deviceId");
      for (const line of spies.logLines) expect(line).not.toContain(DEVICE);
    });
  }

  it("keeps the static username routes' real paths", () => {
    expect(redactRequestUrl("/api/profiles/username-availability?name=Mia")).toBe(
      "/api/profiles/username-availability",
    );
    expect(redactRequestUrl("/api/profiles/username-suggestions")).toBe(
      "/api/profiles/username-suggestions",
    );
  });

  it("leaves routes without a device id alone", () => {
    expect(redactRequestUrl("/api/cats/12/updates")).toBe("/api/cats/12/updates");
    expect(redactRequestUrl("/api/healthz")).toBe("/api/healthz");
  });
});
