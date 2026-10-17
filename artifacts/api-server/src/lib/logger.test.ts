import { describe, expect, it } from "vitest";
import { redactRequestUrl, safeError } from "./logger";

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

// SYC-396 PR 1.5 (spec §6.3; SYC-255): the island map's square addresses
// carry a token that stands for a position, so the request log never keeps
// it. app.logRedaction.test.ts checks the map-tiles twin through the real app.
describe("map square addresses in the request log", () => {
  const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdEfGhIjKlMnOpQrStU";

  it("shows /api/team/map-square/[redacted], never the token", () => {
    expect(redactRequestUrl(`/api/team/map-square/${TOKEN}`)).toBe("/api/team/map-square/[redacted]");
    expect(redactRequestUrl(`/api/team/map-square/${TOKEN}?x=1`)).toBe("/api/team/map-square/[redacted]");
  });

  it("catches hand-made spellings", () => {
    for (const url of [
      `//api/team/map-square/${TOKEN}`,
      `/api/team//map-square/${TOKEN}`,
      `/api/team/./map-square/${TOKEN}`,
      `/api/team/map%2dsquare/${TOKEN}`,
      `/api/team/map-square%2F${TOKEN}`,
      `/API/Team/Map-Square/${TOKEN}`,
      `/api/team/map-square/17/74230/50478.png`,
    ]) {
      const out = redactRequestUrl(url)!;
      expect(out, url).toMatch(/\/map-square\/\[redacted\]$/);
      expect(out, url).not.toContain(TOKEN);
      expect(out, url).not.toMatch(/74230|50478/);
    }
  });

  it("keeps the token request's own path, and the 2x2 pictures' redaction is unchanged", () => {
    expect(redactRequestUrl("/api/team/map-squares")).toBe("/api/team/map-squares");
    expect(redactRequestUrl("/api/team/map-tiles/17/74000/50000.png")).toBe("/api/team/map-tiles/:tile");
  });
});
