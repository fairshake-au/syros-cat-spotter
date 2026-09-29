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
// A purely-numeric segment is the OLD id format. It is kept as a redirect
// for one release (not served directly) so a link cached on a tester's
// phone from before this change still resolves, then removed — tracked in
// a follow-up ticket. The redirect target is itself unguessable, so this
// does not reopen the enumerable-id problem; the numeric segment is only
// useful to someone who already has it cached, not to someone walking a
// range, since walking it now yields 301s to already-known-shape ids, not
// image bytes, and is behind the same rate limiter as the real route.
router.get("/photos/:id", photoLimiter, async (req, res) => {
  const id = String(req.params.id);

  if (/^\d+$/.test(id)) {
    const numericId = Number(id);
    const [photo] = await db
      .select({ publicId: photosTable.publicId })
      .from(photosTable)
      .where(eq(photosTable.id, numericId));
    if (!photo) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.redirect(301, `/api/photos/${photo.publicId}`);
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
