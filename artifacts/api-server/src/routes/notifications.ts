import { Router, type IRouter } from "express";
import {
  CreateCatUpdateBody,
  RegisterPushTokenBody,
} from "@workspace/api-zod";
import {
  db,
  catsTable,
  catUpdatesTable,
  notificationsTable,
  pushTokensTable,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { photoUrl } from "../lib/catHelpers";
import { requireDeviceAuth } from "../lib/deviceAuth";
import { createUpdateAndFanOut } from "../lib/notificationFanout";

const router: IRouter = Router();

router.post("/cats/:catId/updates", async (req, res) => {
  const ownerSecret = process.env["OWNER_SECRET"];
  if (!ownerSecret) {
    res.status(503).json({ error: "Owner updates are not configured" });
    return;
  }
  const auth = req.headers.authorization ?? "";
  if (auth !== `Bearer ${ownerSecret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const catId = Number(req.params.catId);
  const body = CreateCatUpdateBody.parse(req.body);

  const [cat] = await db.select().from(catsTable).where(eq(catsTable.id, catId));
  if (!cat) {
    res.status(404).json({ error: "Cat not found" });
    return;
  }

  const update = await createUpdateAndFanOut({
    cat,
    updateType: body.updateType,
    message: body.message,
  });

  res.status(201).json({
    id: update.id,
    catId: update.catId,
    updateType: update.updateType,
    message: update.message,
    createdAt: update.createdAt.toISOString(),
  });
});

router.get("/notifications/:deviceId", async (req, res) => {
  const deviceId = await requireDeviceAuth(req, res);
  if (!deviceId) return;

  const rows = await db
    .select({
      id: notificationsTable.id,
      catUpdateId: notificationsTable.catUpdateId,
      read: notificationsTable.read,
      createdAt: notificationsTable.createdAt,
      updateType: catUpdatesTable.updateType,
      message: catUpdatesTable.message,
      catId: catsTable.id,
      catName: catsTable.name,
      catPrimaryPhotoId: catsTable.primaryPhotoId,
    })
    .from(notificationsTable)
    .innerJoin(
      catUpdatesTable,
      eq(notificationsTable.catUpdateId, catUpdatesTable.id),
    )
    .innerJoin(catsTable, eq(catUpdatesTable.catId, catsTable.id))
    .where(eq(notificationsTable.deviceId, deviceId))
    .orderBy(desc(notificationsTable.createdAt), desc(notificationsTable.id));

  res.json(
    await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        catId: r.catId,
        catUpdateId: r.catUpdateId,
        catName: r.catName,
        catPhotoUrl: await photoUrl(r.catPrimaryPhotoId),
        updateType: r.updateType,
        message: r.message,
        read: r.read,
        createdAt: r.createdAt.toISOString(),
      })),
    ),
  );
});

router.post("/notifications/:deviceId/read-all", async (req, res) => {
  const deviceId = await requireDeviceAuth(req, res);
  if (!deviceId) return;

  const updated = await db
    .update(notificationsTable)
    .set({ read: true })
    .where(
      and(
        eq(notificationsTable.deviceId, deviceId),
        eq(notificationsTable.read, false),
      ),
    )
    .returning({ id: notificationsTable.id });

  res.json({ updated: updated.length });
});

router.post("/notifications/:deviceId/:notificationId/read", async (req, res) => {
  const deviceId = await requireDeviceAuth(req, res);
  if (!deviceId) return;
  const notificationId = Number(req.params.notificationId);
  if (!Number.isInteger(notificationId)) {
    res.status(400).json({ error: "Invalid notification id" });
    return;
  }

  const updated = await db
    .update(notificationsTable)
    .set({ read: true })
    .where(
      and(
        eq(notificationsTable.deviceId, deviceId),
        eq(notificationsTable.id, notificationId),
        eq(notificationsTable.read, false),
      ),
    )
    .returning({ id: notificationsTable.id });

  res.json({ updated: updated.length });
});

router.put("/profile/:deviceId/push-token", async (req, res) => {
  const deviceId = await requireDeviceAuth(req, res);
  if (!deviceId) return;
  const body = RegisterPushTokenBody.parse(req.body);

  await db
    .insert(pushTokensTable)
    .values({ deviceId, token: body.token })
    .onConflictDoUpdate({
      target: pushTokensTable.deviceId,
      set: { token: body.token, updatedAt: sql`now()` },
    });

  res.json({ ok: true });
});

export default router;
