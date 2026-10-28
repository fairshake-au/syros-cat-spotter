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
import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { requireDeviceAuth } from "../lib/deviceAuth";
import { insertCatUpdate, fanOutNotifications } from "../lib/notificationFanout";
import { writeObservation } from "../lib/observations";
import { catDisplayPhotos } from "../lib/photoVisibility";
import { survivorsOf } from "../lib/survivor";

const router: IRouter = Router();

/** The bell's entries with no cat: their words are in `message` (never pushed, except the week's result). */
const MESSAGE_KINDS = ["week_result", "merged", "duplicate_points"];

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
  //
  // Review of PR #66 (SYC-52/SYC-40): the cat_updates row and the
  // observation it records commit atomically in this transaction — same
  // pattern routes/cats.ts uses for claim/register/rename. Fan-out
  // (notification rows + push) runs only AFTER that commits, via
  // fanOutNotifications below; it used to run on the plain pool inside this
  // function (createUpdateAndFanOut only routed the cat_updates insert
  // through `tx`), ahead of writeObservation and the outer commit, so a
  // notification could be sent — or a push fired — for a change that then
  // rolled back.
  // Review of PR #67 (SYC-52), finding B1: this is the one Date passed to
  // BOTH the cat_updates row's created_at and the observation's observedAt,
  // so the two always carry the identical millisecond-precision instant —
  // the DB column's own `defaultNow()` would otherwise keep microsecond
  // precision while a JS Date can't, so an equality match between them
  // (PR 3's backfill match key) would never hit.
  const observedAt = new Date();
  const update = await db.transaction(async (tx) => {
    const u = await insertCatUpdate(tx, {
      cat,
      updateType: body.updateType,
      message: body.message,
      createdAt: observedAt,
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
        observedAt,
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
        observedAt,
      });
    }
    return u;
  });

  await fanOutNotifications({ cat, update });

  res.status(201).json({
    id: update.id,
    catId: update.catId,
    updateType: update.updateType,
    message: update.message,
    createdAt: update.createdAt.toISOString(),
  });
});

/** The extra fields of a merged or duplicate-points line; empty for the other kinds and for lines written before the columns existed. */
function pairFields(
  r: { survivorCatId: number | null; mergedCatId: number | null },
  survivors: Map<number, { id: number; name: string }>,
  names: Map<number, string>,
) {
  if (r.survivorCatId === null || r.mergedCatId === null) return {};
  const survivorId = survivors.get(r.survivorCatId)?.id ?? r.survivorCatId;
  return {
    survivorCatId: survivorId,
    survivorCatName: names.get(survivorId) ?? null,
    mergedCatName: names.get(r.mergedCatId) ?? null,
  };
}

router.get("/notifications/:deviceId", async (req, res) => {
  const deviceId = await requireDeviceAuth(req, res);
  if (!deviceId) return;

  // SYC-706: a weekly result (kind 'week_result') has no cat, so the cat
  // joins are left joins. A cat entry whose update or cat is gone is still
  // left out, as the inner joins did.
  const rows = await db
    .select({
      id: notificationsTable.id,
      kind: notificationsTable.kind,
      catUpdateId: notificationsTable.catUpdateId,
      read: notificationsTable.read,
      createdAt: notificationsTable.createdAt,
      updateType: catUpdatesTable.updateType,
      updateMessage: catUpdatesTable.message,
      ownMessage: notificationsTable.message,
      place: notificationsTable.place,
      weekPoints: notificationsTable.weekPoints,
      survivorCatId: notificationsTable.survivorCatId,
      mergedCatId: notificationsTable.mergedCatId,
      catId: catsTable.id,
      catName: catsTable.name,
      catPrimaryPhotoId: catsTable.primaryPhotoId,
    })
    .from(notificationsTable)
    .leftJoin(
      catUpdatesTable,
      eq(notificationsTable.catUpdateId, catUpdatesTable.id),
    )
    .leftJoin(catsTable, eq(catUpdatesTable.catId, catsTable.id))
    .where(
      and(
        eq(notificationsTable.deviceId, deviceId),
        or(
          and(eq(notificationsTable.kind, "cat"), isNotNull(catsTable.id)),
          // which-cat-is-which.md D4, D10 (plan C5): a followed cat merged
          // into another, and points for finding a duplicate, are shaped
          // like a weekly result: no cat, their words in the message.
          inArray(notificationsTable.kind, MESSAGE_KINDS),
        ),
      ),
    )
    .orderBy(desc(notificationsTable.createdAt), desc(notificationsTable.id));

  // News about a cat since merged into another shows under the cat it is
  // part of now (which-cat-is-which.md §9.3): its name, photo and page.
  // One lookup for all of them.
  const survivors = await survivorsOf(rows.flatMap((r) => (r.kind === "cat" && r.catId !== null ? [r.catId] : [])));
  for (const r of rows) {
    const s = r.catId === null ? undefined : survivors.get(r.catId);
    if (s) {
      r.catId = s.id;
      r.catName = s.name;
      r.catPrimaryPhotoId = s.primaryPhotoId;
    }
  }

  // A merged or duplicate-points line names its two cats so the app can word
  // it in the spotter's language and open the survivor (SYC-59 PR 4.3). The
  // survivor is the cat it is part of now, should it have been merged on.
  const pairIds = rows.flatMap((r) => (r.survivorCatId !== null && r.mergedCatId !== null ? [r.survivorCatId, r.mergedCatId] : []));
  const pairSurvivors = await survivorsOf(pairIds);
  const pairNames = new Map(
    pairIds.length === 0
      ? []
      : (
          await db
            .select({ id: catsTable.id, name: catsTable.name })
            .from(catsTable)
            .where(inArray(catsTable.id, [...new Set([...pairIds, ...[...pairSurvivors.values()].map((v) => v.id)])]))
        ).map((c) => [c.id, c.name] as const),
  );

  // Each cat's photo as the catalogue shows it, in one batch (SYC-98 Fable
  // review, finding 7: never one lookup per notification). A main photo the
  // team hid is replaced by the newest visible one, or none (PR 6).
  const photos = await catDisplayPhotos([
    ...new Map(
      rows.flatMap((r) =>
        r.catId === null || r.catPrimaryPhotoId === null
          ? []
          : [[r.catId, { id: r.catId, primaryPhotoId: r.catPrimaryPhotoId }] as const],
      ),
    ).values(),
  ]);
  res.json(
    rows.map((r) =>
      r.kind !== "cat"
        ? {
            // No cat: the app opens the celebration, not a cat page.
            id: r.id,
            catId: null,
            catUpdateId: null,
            catName: null,
            catPhotoUrl: null,
            updateType: "general" as const,
            message: r.ownMessage ?? "",
            place: r.place,
            weekPoints: r.weekPoints,
            kind: r.kind,
            ...pairFields(r, pairSurvivors, pairNames),
            read: r.read,
            createdAt: r.createdAt.toISOString(),
          }
        : {
            id: r.id,
            catId: r.catId,
            catUpdateId: r.catUpdateId,
            catName: r.catName,
            catPhotoUrl: r.catId === null ? null : (photos.get(r.catId) ?? null),
            updateType: r.updateType,
            message: r.updateMessage,
            kind: "cat" as const,
            read: r.read,
            createdAt: r.createdAt.toISOString(),
          },
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
    .values({ deviceId, token: body.token, language: body.language ?? null })
    .onConflictDoUpdate({
      target: pushTokensTable.deviceId,
      // A build that sends no language leaves the stored one alone.
      set: {
        token: body.token,
        ...(body.language ? { language: body.language } : {}),
        updatedAt: sql`now()`,
      },
    });

  res.json({ ok: true });
});

export default router;
