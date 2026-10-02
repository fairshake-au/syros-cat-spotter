import { describe, expect, it } from "vitest";
import { safeError } from "./logger";

// S1 (review of #55): an error object must never put query parameters in the
// logs. Drizzle's error message is "Failed query: <sql>\nparams: <values>",
// and its stack starts with that message; the values can be a reporter's
// note, exact coordinates, a device id, or a photo's bytes.

function drizzleLikeError() {
  const cause = Object.assign(new Error("invalid byte sequence for encoding \"UTF8\": 0x00"), {
    code: "22021",
  });
  const err = new Error(
    'Failed query: insert into "welfare_report_photos" ("bytes") values ($1)\nparams: /9j/4AAQSkZJRgABAQ,dev-secret-device,37.4441234,24.9412345,Limping by the bakery',
  );
  err.name = "DrizzleQueryError";
  (err as Error & { cause?: unknown }).cause = cause;
  return err;
}

describe("safeError", () => {
  it("keeps the error's name and codes, and nothing from the query or its params", () => {
    const out = safeError(drizzleLikeError());
    const text = JSON.stringify(out);
    expect(out).toMatchObject({ type: "DrizzleQueryError", causeCode: "22021" });
    for (const leak of ["Failed query", "params", "/9j/4AAQ", "dev-secret-device", "37.4441234", "Limping"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("keeps an ordinary error's message (no query in it)", () => {
    expect(safeError(new Error("boom")).message).toBe("boom");
  });

  it("copes with things that aren't errors", () => {
    expect(safeError("a string")).toEqual({ type: "string" });
    expect(safeError(undefined)).toEqual({ type: "undefined" });
  });
});
