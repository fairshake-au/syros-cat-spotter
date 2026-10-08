/**
 * SYC-3 plan, Slice 0.3 (and test 13): a mail link's token is a one-time
 * credential, so no request-log line may carry one. The API's log cleaner
 * already drops every query string (app.ts's pino-http `req` serialiser);
 * this pins it for the keep-safe and restore paths, through the real app,
 * whatever each route answers.
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

const TOKEN = "tok3n-QmV5LWxvZy1yZWRhY3Rpb24tcGluLTAxMjM0NTY3ODk";

const ROUTES: { method: "get" | "post"; path: string }[] = [
  { method: "get", path: "/api/mail/confirm" },
  { method: "post", path: "/api/mail/confirm" },
  { method: "get", path: "/api/mail/forget" },
  { method: "post", path: "/api/mail/forget" },
  { method: "post", path: "/api/restore/peek" },
  { method: "post", path: "/api/restore/redeem" },
  { method: "get", path: "/restore" },
];

beforeEach(() => {
  spies.logLines.length = 0;
});

afterAll(async () => {
  await pool.end();
});

describe("mail tokens never reach the request log (SYC-3 Slice 0.3)", () => {
  for (const { method, path } of ROUTES) {
    it(`${method.toUpperCase()} ${path}?t=… is logged without the token`, async () => {
      await request(app)[method](path).query({ t: TOKEN });
      const completed = spies.logLines.filter((l) => l.includes('"request completed"'));
      expect(completed).toHaveLength(1);
      for (const line of spies.logLines) expect(line).not.toContain(TOKEN);
    });
  }
});
