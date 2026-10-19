import { Router, type IRouter } from "express";
import { db, photosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { photoLimiter } from "../middlewares/rateLimit";
import { gateEnabled } from "../lib/prelaunch";
import { hiddenPhotoIds } from "../lib/photoVisibility";

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
    // A "not found" is never cached either, so a restore shows again at once.
    res.setHeader("Cache-Control", "no-store");
    res.status(404).json({ error: "Not found" });
    return;
  }

  const [photo] = await db
    .select()
    .from(photosTable)
    .where(eq(photosTable.publicId, id));
  // A photo the team hid answers exactly as an unknown id does (SYC-43 part
  // 2, PR 6): the same 404, so the answer never says a photo exists. Staff
  // see hidden photos through the team photo route instead.
  if (!photo || (await hiddenPhotoIds([photo.id])).has(photo.id)) {
    // A "not found" is never cached either, so a restore shows again at once.
    res.setHeader("Cache-Control", "no-store");
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (photo.data === null) {
    // Removed for good (SYC-462). hiddenPhotoIds already counts it as hidden;
    // this is the route's own guard (spec §6 item 1), answering exactly as an
    // unknown id does.
    res.setHeader("Cache-Control", "no-store");
    res.status(404).json({ error: "Not found" });
    return;
  }
  const buffer = Buffer.from(photo.data, "base64");
  res.setHeader("Content-Type", photo.mime);
  // Decision 1 (SYC-279): shared caches must never store photos. Public photos
  // are marked "this browser only" (private, immutable) whether the pre-launch
  // gate is on or off. SYC-114's clean-up keeps `private` when it removes the
  // pass's switch. The new address on hide (D14) is not built.
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  if (gateEnabled()) {
    res.setHeader("Vary", "Cookie, X-Prelaunch-Key");
  }
  res.send(buffer);
});

export default router;
