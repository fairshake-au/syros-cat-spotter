import { Router, type IRouter } from "express";
import { db, photosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { photoLimiter } from "../middlewares/rateLimit";

const router: IRouter = Router();

router.get("/photos/:photoId", photoLimiter, async (req, res) => {
  const photoId = Number(req.params.photoId);
  if (!Number.isInteger(photoId)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [photo] = await db
    .select()
    .from(photosTable)
    .where(eq(photosTable.id, photoId));
  if (!photo) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const buffer = Buffer.from(photo.data, "base64");
  res.setHeader("Content-Type", photo.mime);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(buffer);
});

export default router;
