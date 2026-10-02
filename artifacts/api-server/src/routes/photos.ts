import { Router, type IRouter } from "express";
import { db, photosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { photoLimiter } from "../middlewares/rateLimit";
import { gateEnabled } from "../lib/prelaunch";

const router: IRouter = Router();

// hosting-and-photo-storage.md §6.2 item 1 (SYC-98): the served id is now
// the unguessable public_id, not the sequential integer primary key. A
// single route handles both forms of the path segment (rather than two
// Express routes) because Express 5 / path-to-regexp 8 dropped inline
// per-param regex constraints (`:id(\\d+)`) — this reads the same either
// way and needs no route-ordering assumptions.
//
// A purely-numeric segment is the OLD id format and 404s — it is never
// looked up or redirected (SYC-112, done in this PR; decided 1 Oct 2026,
// Fable review finding 3). An earlier version of this PR 301-redirected a
// numeric id to its public_id, reasoning that the redirect target was
// itself unguessable so nothing leaked. That reasoning was wrong: the
// Location header of that redirect *is* the public_id, so a plain
// `curl -I` loop over /api/photos/1..N inside one rate-limit window
// harvests the whole corpus's public_ids, and — because they are immutable
// and cached a year — a public_id harvested during that window stays valid
// forever, which closing the numeric route later does not undo. A 404
// here leaks nothing: same response whether the numeric id exists or not.
router.get("/photos/:id", photoLimiter, async (req, res) => {
  const id = String(req.params.id);

  // Numeric segments (the old id format) never serve or redirect — reject
  // up front, before any query. `/^\d{1,10}$/` also keeps a value outside
  // Postgres's int4 range (e.g. 99999999999999999999) from reaching the
  // `eq(photosTable.id, ...)` query below and 500ing instead of 404ing
  // (Fable review nit 9) — 10 digits is enough for any int4 (max
  // 2147483647) and short enough that nothing in range survives past it
  // undetected either.
  if (/^\d{1,10}$/.test(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const [photo] = await db
    .select()
    .from(photosTable)
    .where(eq(photosTable.publicId, id));
  if (!photo) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const buffer = Buffer.from(photo.data, "base64");
  res.setHeader("Content-Type", photo.mime);
  // SYC-113 item 4: while the pre-launch gate is on, a shared cache between
  // us and the phone must not keep a photo fetched with a pass and hand it to
  // someone without one. `private` (still a year, still immutable) plus a
  // Vary on both pass headers; back to `public` automatically at launch.
  if (gateEnabled()) {
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("Vary", "Cookie, X-Prelaunch-Key");
  } else {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
  res.send(buffer);
});

export default router;
