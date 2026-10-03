import { Router, type IRouter } from "express";
import {
  RegisterCatBody,
  ClaimCatBody,
  UpdateCatBody,
  SuggestCatNamesBody,
} from "@workspace/api-zod";
import {
  db,
  catsTable,
  sightingsTable,
  profilesTable,
  catUpdatesTable,
  photosTable,
  foldName,
  type Cat,
} from "@workspace/db";
import { and, eq, ne, desc, isNull, sql } from "drizzle-orm";
import {
  fansCount,
  listCatsWithStats,
  photoUrl,
  spotterCode,
} from "../lib/catHelpers";
import { notifyCatSpotters } from "../lib/notifications";
import { suggestCatNames } from "../lib/nameSuggestions";
import { aiLimiter } from "../middlewares/rateLimit";
import { containsOffensiveLanguage } from "../lib/moderation";
import { verifyDeviceSecret } from "../lib/deviceAuth";
import { writeObservation } from "../lib/observations";

const router: IRouter = Router();

router.post("/cats/name-suggestions", aiLimiter, async (req, res) => {
  const body = SuggestCatNamesBody.parse(req.body);
  const cats = await db.select({ name: catsTable.name }).from(catsTable);
  try {
    const suggestions = await suggestCatNames(
      body.language,
      cats.map((c) => c.name),
      body.excludeNames ?? [],
    );
    res.json({ suggestions });
  } catch (err) {
    req.log.error({ err }, "Cat name suggestion failed");
    res.status(502).json({ error: "Name generation failed" });
  }
});

async function catPayload(
  cat: Cat,
  sightingsCount: number,
  lastSeenAt: string,
) {
  const [profile] = await db
    .select({
      nickname: profilesTable.nickname,
      username: profilesTable.username,
    })
    .from(profilesTable)
    .where(eq(profilesTable.deviceId, cat.discovererDeviceId));
  return {
    id: cat.id,
    name: cat.name,
    description: cat.description,
    photoUrl: await photoUrl(cat.primaryPhotoId),
    lat: cat.lat,
    lng: cat.lng,
    sightingsCount,
    lastSeenAt,
    discovererSpotterCode: spotterCode(cat.discovererDeviceId),
    discovererNickname: profile?.nickname ?? null,
    discovererUsername: profile?.username ?? null,
    ownerName: cat.ownerName,
    homeDescription: cat.homeDescription,
    hasHome: cat.ownerDeviceId !== null,
  };
}

async function sightingsCountFor(catId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sightingsTable)
    .where(
      and(
        eq(sightingsTable.catId, catId),
        eq(sightingsTable.status, "resolved"),
      ),
    );
  return row?.n ?? 0;
}

router.get("/cats", async (req, res) => {
  const lat = req.query.lat !== undefined ? Number(req.query.lat) : undefined;
  const lng = req.query.lng !== undefined ? Number(req.query.lng) : undefined;
  const cats = await listCatsWithStats(
    Number.isFinite(lat) ? lat : undefined,
    Number.isFinite(lng) ? lng : undefined,
  );
  res.json(cats);
});

// Resident registers a brand-new owned cat (no sighting required).
router.post("/cats", async (req, res) => {
  const body = RegisterCatBody.parse(req.body);
  // SYC-107: every route that acts as a spotter proves the caller holds the
  // device's secret before anything else, so an id seen in traffic can't be
  // used to register, claim or rename cats as someone else.
  if (!(await verifyDeviceSecret(req, res, body.deviceId))) return;
  const name = body.name.trim().slice(0, 60);
  if (containsOffensiveLanguage(name)) {
    res.status(400).json({
      error: "Cat name contains offensive language",
      code: "OFFENSIVE_NAME",
    });
    return;
  }
  // Owner registration writes homed + name observations in the same
  // transaction as the cat row itself (data-spine.md PR 2: "Owner
  // registration (POST /cats) writes the same [as a claim] at creation").
  const cat = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(catsTable)
      .values({
        name,
        description: "",
        // No photo yet — 0 is a sentinel; the photos route 404s for it and
        // the owner (or a first sighting) can supply a real photo later.
        primaryPhotoId: 0,
        lat: body.lat,
        lng: body.lng,
        discovererDeviceId: body.deviceId,
        ownerDeviceId: body.deviceId,
        ownerName: body.ownerName.trim().slice(0, 60),
        homeDescription: body.homeDescription.trim().slice(0, 200),
      })
      .returning();
    await writeObservation(tx, {
      catId: row!.id,
      kind: "life_status",
      value: { status: "homed" },
      deviceId: body.deviceId,
      roleAtTime: "public",
      authorityScope: "owner_of_this_cat",
      observedAt: row!.createdAt,
    });
    await writeObservation(tx, {
      catId: row!.id,
      kind: "name",
      value: { name: row!.name, normalised: foldName(row!.name) },
      deviceId: body.deviceId,
      roleAtTime: "public",
      authorityScope: "owner_of_this_cat",
      observedAt: row!.createdAt,
    });
    return row!;
  });
  res.status(201).json(await catPayload(cat, 0, cat.createdAt.toISOString()));
});

router.get("/cats/:catId", async (req, res) => {
  const catId = Number(req.params.catId);
  if (!Number.isInteger(catId)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [cat] = await db
    .select()
    .from(catsTable)
    .where(eq(catsTable.id, catId));
  if (!cat) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // SYC-98 Fable review, finding 7: photosTable is joined here rather than
  // calling photoUrl(s.photoId) per sighting (an N+1 — one round trip to
  // Neon per row, serialised 5 at a time behind the pool's default max: 10)
  // — a cat page with 50 sightings would otherwise cost 50 extra round
  // trips to Frankfurt from Replit EU.
  const sightings = await db
    .select({
      sighting: sightingsTable,
      spotterUsername: profilesTable.username,
      spotterNickname: profilesTable.nickname,
      photoPublicId: photosTable.publicId,
    })
    .from(sightingsTable)
    .leftJoin(
      profilesTable,
      eq(profilesTable.deviceId, sightingsTable.deviceId),
    )
    .leftJoin(photosTable, eq(photosTable.id, sightingsTable.photoId))
    .where(
      and(
        eq(sightingsTable.catId, catId),
        eq(sightingsTable.status, "resolved"),
      ),
    )
    .orderBy(desc(sightingsTable.createdAt));

  // Care timeline: the cat's own update history, newest first. Sighting-type
  // updates are excluded — the sightings list below already covers those, and
  // repeating them would drown the care events the timeline exists to show.
  const updates = await db
    .select()
    .from(catUpdatesTable)
    .where(
      and(
        eq(catUpdatesTable.catId, catId),
        ne(catUpdatesTable.updateType, "sighting"),
      ),
    )
    .orderBy(desc(catUpdatesTable.createdAt));

  const [fans, discovererProfile] = await Promise.all([
    fansCount(catId),
    db
      .select({
        username: profilesTable.username,
        nickname: profilesTable.nickname,
      })
      .from(profilesTable)
      .where(eq(profilesTable.deviceId, cat.discovererDeviceId))
      .then((r) => r[0]),
  ]);

  res.json({
    cat: await catPayload(
      cat,
      sightings.length,
      sightings[0]?.sighting.createdAt.toISOString() ??
        cat.createdAt.toISOString(),
    ),
    fansCount: fans,
    careTimeline: [
      ...updates.map((u) => ({
        type: u.updateType,
        message: u.message,
        at: u.createdAt.toISOString(),
      })),
      // The cat-alog entry itself is always the oldest event on the timeline.
      {
        type: "discovered" as const,
        message:
          discovererProfile?.username ??
          discovererProfile?.nickname ??
          spotterCode(cat.discovererDeviceId),
        at: cat.createdAt.toISOString(),
      },
    ],
    sightings: sightings.map(
      ({ sighting: s, spotterUsername, spotterNickname, photoPublicId }) => ({
        id: s.id,
        catId: s.catId,
        spotterCode: spotterCode(s.deviceId),
        spotterUsername: spotterUsername ?? null,
        spotterNickname: spotterNickname ?? null,
        photoUrl: photoPublicId ? `/api/photos/${photoPublicId}` : null,
        lat: s.lat,
        lng: s.lng,
        createdAt: s.createdAt.toISOString(),
      }),
    ),
  });
});

// Claim an unclaimed cat. Idempotent for the same device; 409 for others.
router.post("/cats/:catId/claim", async (req, res) => {
  const catId = Number(req.params.catId);
  if (!Number.isInteger(catId)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const body = ClaimCatBody.parse(req.body);
  // SYC-107: before the cat lookup, so the ownership answers (idempotent 200,
  // 409) are only ever given to the device itself.
  if (!(await verifyDeviceSecret(req, res, body.deviceId))) return;

  const [cat] = await db
    .select()
    .from(catsTable)
    .where(eq(catsTable.id, catId));
  if (!cat) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (cat.ownerDeviceId && cat.ownerDeviceId !== body.deviceId) {
    res.status(409).json({ error: "Cat already claimed by another resident" });
    return;
  }

  let updated = cat;
  if (!cat.ownerDeviceId) {
    const claimedAt = new Date();
    // Guard against a concurrent claim: only set ownership if still
    // unclaimed. The homed observation is written in the same transaction
    // (data-spine.md PR 2: "A claim writes life_status: homed ... in the
    // same transaction as the change it records").
    const row = await db.transaction(async (tx) => {
      const [updatedRow] = await tx
        .update(catsTable)
        .set({
          ownerDeviceId: body.deviceId,
          homeDescription: body.homeDescription.trim().slice(0, 200),
        })
        .where(and(eq(catsTable.id, catId), isNull(catsTable.ownerDeviceId)))
        .returning();
      if (!updatedRow) return null;
      await writeObservation(tx, {
        catId,
        kind: "life_status",
        value: { status: "homed" },
        deviceId: body.deviceId,
        roleAtTime: "public",
        authorityScope: "owner_of_this_cat",
        observedAt: claimedAt,
      });
      return updatedRow;
    });
    if (!row) {
      res
        .status(409)
        .json({ error: "Cat already claimed by another resident" });
      return;
    }
    updated = row;

    // Fire-and-forget: never blocks or fails the response.
    void notifyCatSpotters(catId, body.deviceId, {
      title: `${updated.name} has a home!`,
      body: `${updated.name} has been claimed by a resident. ${updated.homeDescription ?? ""}`.trim(),
      data: { type: "cat_claimed", catId },
    });
  }

  const count = await sightingsCountFor(catId);
  res.json(await catPayload(updated, count, new Date().toISOString()));
});

// Owner renames the cat or updates its home description.
router.patch("/cats/:catId", async (req, res) => {
  const catId = Number(req.params.catId);
  if (!Number.isInteger(catId)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const body = UpdateCatBody.parse(req.body);
  // SYC-107: the owner check below compares a body value against the stored
  // owner, which proves nothing on its own; the secret is what proves it.
  if (!(await verifyDeviceSecret(req, res, body.deviceId))) return;

  const [cat] = await db
    .select()
    .from(catsTable)
    .where(eq(catsTable.id, catId));
  if (!cat) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!cat.ownerDeviceId || cat.ownerDeviceId !== body.deviceId) {
    res.status(403).json({ error: "Only the cat's owner can update it" });
    return;
  }

  const changes: Partial<typeof catsTable.$inferInsert> = {};
  if (body.name !== undefined) {
    const newName = body.name.trim().slice(0, 60);
    if (containsOffensiveLanguage(newName)) {
      res.status(400).json({
        error: "Cat name contains offensive language",
        code: "OFFENSIVE_NAME",
      });
      return;
    }
    changes.name = newName;
  }
  if (body.homeDescription !== undefined)
    changes.homeDescription = body.homeDescription.trim().slice(0, 200);

  let updated = cat;
  if (Object.keys(changes).length > 0) {
    const changedAt = new Date();
    const renamed = changes.name !== undefined && changes.name !== cat.name;
    updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(catsTable)
        .set(changes)
        .where(eq(catsTable.id, catId))
        .returning();
      if (renamed) {
        // §5, §10.3: a rename never destroys an earlier name — it appends
        // a new name observation rather than editing the cat row's only
        // name in place.
        await writeObservation(tx, {
          catId,
          kind: "name",
          value: { name: row!.name, normalised: foldName(row!.name) },
          deviceId: body.deviceId,
          roleAtTime: "public",
          authorityScope: "owner_of_this_cat",
          observedAt: changedAt,
        });
      }
      return row!;
    });
    void notifyCatSpotters(catId, body.deviceId, {
      title: renamed
        ? `${cat.name} is now ${updated.name}!`
        : `${updated.name} has an update`,
      body: renamed
        ? `${updated.name}'s owner renamed their cat.`
        : `${updated.name}'s home details were updated by their owner.`,
      data: { type: "cat_updated", catId },
    });
  }

  const count = await sightingsCountFor(catId);
  res.json(await catPayload(updated, count, new Date().toISOString()));
});

export default router;
