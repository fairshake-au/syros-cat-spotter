import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

// SYC-602 PR 4 security review, finding 3: when keeping a signed-out person's
// typing fails, the log line must not carry the database error as it is. A
// Drizzle error spells out "Failed query ... params: ..." and the params are
// the typed note. (The app's logger also runs `err` through safeError; this
// pins that the call itself no longer depends on that.)
vi.mock("./session", () => ({ readExpiredSession: () => ({ pid: "p", sv: 1 }) }));
vi.mock("./heldTyping", () => ({
  keepTyping: async () => {
    throw new Error('Failed query: insert into "held_typing" ... params: note:5,{"text":"Maria has a swollen paw"}');
  },
  keepableFor: () => null,
  typedFields: () => ({}),
}));

import { refuseSignedOutSave } from "./refuse";

describe("refuseSignedOutSave when keeping the typing fails", () => {
  it("logs the failure without the query text or its params, and still answers 401", async () => {
    const lines: unknown[][] = [];
    const req = {
      headers: {},
      log: { warn: (...a: unknown[]) => void lines.push(a), info: () => undefined },
    } as unknown as Request;
    const res = {
      setHeader: () => undefined,
      status: () => res,
      type: () => res,
      send: () => res,
    } as unknown as Response;
    const status = vi.spyOn(res, "status");
    await refuseSignedOutSave(req, res);
    expect(status).toHaveBeenCalledWith(401);
    // A raw Error would be spelled out by a logger that has no serializer for it: show its message.
    const logged = JSON.stringify(lines, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message } : v));
    expect(logged).toContain("keeping typed text failed");
    expect(logged).not.toContain("swollen paw");
    expect(logged).not.toContain("params:");
  });
});
