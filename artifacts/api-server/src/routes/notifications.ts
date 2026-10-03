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
  photosTable,
  pushTokensTable,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireDeviceAuth } from "../lib/deviceAuth";
import { createUpdateAndFanOut } from "../lib/notificationFanout";
import { writeObservation } from "../lib/observations";

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

  // C13 / D7: the old shared-password admin route is kept as insurance
  // until PR 8 and a SYC-43 screen can record sterilisation and adoption
  // (production has never actually used it — no desexed/adopted rows on 2
  // Oct). `desexed` also writes `sterilised: true`, and `adopted` writes
  // `life_status: homed`, both authored `system:admin-route` with
  // `observedAt` set to the new cat_updates row's `created_at` so PR 3's
  // backfill can recognise and skip them later.
  const observedAt = new Date();
  const update = await db.transaction(async (tx) => {
    const u = await createUpdateAndFanOut({
      cat,
      updateType: body.updateType,
      message: body.message,
      tx,
    });
    if (body.updateType === "desexed") {
      await writeObservation(tx, {
        catId: cat.id,
        kind: "sterilised",
        value: { sterilised: true },
        accountId: "system:admin-route",
        roleAtTime: "staff",
        authorityScope: "none",
        provenance: "volunteered",
        observedAt: u.createdAt ?? observedAt,
      });
    } else if (body.updateType === "adopted") {
      await writeObservation(tx, {
        catId: cat.id,
        kind: "life_status",
        value: { status: "homed" },
        accountId: "system:admin-route",
        roleAtTime: "staff",
        authorityScope: "none",
        provenance: "volunteered",
        observedAt: u.createdAt ?? observedAt,
      });
    }
    return u;
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

  // SYC-98 Fable review, finding 7: photosTable is joined here rather than
  // calling photoUrl(r.catPrimaryPhotoId) per notification (an N+1).
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
      catPhotoPublicId: photosTable.publicId,
    })
    .from(notificationsTable)
    .innerJoin(
      catUpdatesTable,
      eq(notificationsTable.catUpdateId, catUpdatesTable.id),
    )
    .innerJoin(catsTable, eq(catUpdatesTable.catId, catsTable.id))
    .leftJoin(photosTable, eq(photosTable.id, catsTable.primaryPhotoId))
    .where(eq(notificationsTable.deviceId, deviceId))
    .orderBy(desc(notificationsTable.createdAt), desc(notificationsTable.id));

  res.json(
    rows.map((r) => ({
      id: r.id,
      catId: r.catId,
      catUpdateId: r.catUpdateId,
      catName: r.catName,
      catPhotoUrl: r.catPhotoPublicId ? `/api/photos/${r.catPhotoPublicId}` : null,
      updateType: r.updateType,
      message: r.message,
      read: r.read,
      createdAt: r.createdAt.toISOString(),
    })),
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
