import { describe, expect, it } from "vitest";
import router from "./profiles";
import { badgeMomentsLimiter } from "../middlewares/rateLimit";

type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] } };

// SYC-706: the three badge routes each run badgeMomentsLimiter before their
// handler. Checked on the router itself so it costs no requests.
const ROUTES: [string, string][] = [
  ["get", "/profiles/:deviceId/moments"],
  ["post", "/profiles/:deviceId/moments/:id/celebrated"],
  ["post", "/profiles/:deviceId/badges/seen"],
];

describe("badge routes rate limit", () => {
  it.each(ROUTES)("%s %s runs badgeMomentsLimiter first", (method, path) => {
    const layer = (router as unknown as { stack: Layer[] }).stack.find(
      (l) => l.route?.path === path && l.route.methods[method],
    );
    expect(layer?.route).toBeDefined();
    const handles = layer!.route!.stack.map((s) => s.handle);
    expect(handles[0]).toBe(badgeMomentsLimiter);
    expect(handles.length).toBeGreaterThan(1);
  });
});
