import { Router, type IRouter, type Request } from "express";
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
  type Cat,
} from "@workspace/db";
import { and, eq, ne, desc, sql } from "drizzle-orm";
import {
  PUBLIC_VIEWER,
  deriveCatStatuses,
  fansCount,
  listCatsWithStats,
  serialiseCat,
  serialiseSighting,
  spotterCode,
  toPublicDay,
  type DerivedCatStatus,
  type Viewer,
} from "../lib/catHelpers";
import { notifyCatSpotters } from "../lib/notifications";
import { catDisplayPhoto, hiddenPhotoIds, publicPhotoUrl } from "../lib/photoVisibility";
import { suggestCatNames } from "../lib/nameSuggestions";
import { aiLimiter, checkClaimLimit } from "../middlewares/rateLimit";
import { containsOffensiveLanguage } from "../lib/moderation";
import { deviceSecretMatches, verifyDeviceSecret } from "../lib/deviceAuth";
import { writeObservation } from "../lib/observations";
import {
  claimEligibility,
  letGoWithinDays,
  pinWithinReach,
  type ClaimRefusal,
} from "../lib/claiming";
import { logRouteDuration } from "../lib/requestTiming";
import {
  BLANK_NAME_BODY,
  catNamed,
  isBlankName,
  nameTakenBody,
  nullOnUniqueViolation,
} from "../lib/catNames";

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

/**
 * The discoverer's public name, or nothing once they've deleted their data
 * (SYC-63): an unlinked cat has no discoverer to look up.
 */
async function lookupDiscoverer(
  discovererDeviceId: string | null,
): Promise<{ nickname: string | null; username: string | null } | undefined> {
  if (discovererDeviceId === null) return undefined;
  const [profile] = await db
    .select({
      nickname: profilesTable.nickname,
      username: profilesTable.username,
    })
    .from(profilesTable)
    .where(eq(profilesTable.deviceId, discovererDeviceId));
  return profile;
}

/**
 * A cat for the app, through the one serialiser (catHelpers.serialiseCat,
 * §10.6). `viewer` is public unless the route has proved the caller is this
 * cat's owner.
 */
async function catPayload(
  cat: Cat,
  sightingsCount: number,
  lastSeenAt: Date | string,
  viewer: Viewer,
  derived?: DerivedCatStatus,
) {
  const [profile, status] = await Promise.all([
    lookupDiscoverer(cat.discovererDeviceId),
    derived
      ? Promise.resolve(derived)
      : deriveCatStatuses([{ id: cat.id, ownerDeviceId: cat.ownerDeviceId }]).then(
          (m) => m.get(cat.id)!,
        ),
  ]);
  return serialiseCat(
    {
      id: cat.id,
      name: cat.name,
      description: cat.description,
      // The main photo, or the stand-in if the team hid it (PR 6, Decision 4).
      photoUrl: await catDisplayPhoto(cat),
      lat: cat.lat,
      lng: cat.lng,
      ownerDeviceId: cat.ownerDeviceId,
      sightingsCount,
      lastSeenAt,
      discovererDeviceId: cat.discovererDeviceId,
      discovererNickname: profile?.nickname ?? null,
      discovererUsername: profile?.username ?? null,
      ownerName: cat.ownerName,
      homeDescription: cat.homeDescription,
      homeLat: cat.homeLat,
      homeLng: cat.homeLng,
      derived: status,
    },
    viewer,
  );
}

/**
 * §10.6 Option B: the detail page shows an owner their own cat exactly, once
 * they've proved it. The app sends its device id in `X-Device-Id` (a header,
 * so it never lands in a logged URL) with its usual `X-Device-Secret`.
 * Anything short of a proven owner is the public view, with no error, so
 * the answer never says whether a guess at an owner's id was close.
 */
async function detailViewer(req: Request, cat: Cat): Promise<{ viewer: Viewer; canClaim: boolean }> {
  const header = req.headers["x-device-id"];
  const deviceId = typeof header === "string" ? header : "";
  const proven = deviceId !== "" && (await deviceSecretMatches(req, deviceId));
  if (!proven) return { viewer: PUBLIC_VIEWER, canClaim: false };
  if (cat.ownerDeviceId === deviceId) return { viewer: { tier: "owner", deviceId }, canClaim: false };
  // claiming-a-cat.md §4.1, §11: "may claim" comes from the same function
  // the claim uses, and only for a phone that has proved it is that device.
  // A cat someone else owns can't be claimed, so it isn't asked.
  const canClaim =
    cat.ownerDeviceId === null &&
    (await claimEligibility(db, { catId: cat.id, deviceId })).ok === true;
  return { viewer: PUBLIC_VIEWER, canClaim };
}

function queryNumber(raw: unknown): number | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
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
  const startedAt = performance.now();
  const lat = queryNumber(req.query.lat);
  const lng = queryNumber(req.query.lng);
  const result = await listCatsWithStats({
    from: lat !== undefined && lng !== undefined ? { lat, lng } : undefined,
    page: queryNumber(req.query.page),
    pageSize: queryNumber(req.query.pageSize),
  });
  logRouteDuration(req, "GET /cats", startedAt, {
    count: result.cats.length,
    page: result.page,
  });
  res.json(result);
});

// Resident registers a brand-new owned cat (no sighting required).
router.post("/cats", async (req, res) => {
  const body = RegisterCatBody.parse(req.body);
  // SYC-107: every route that acts as a spotter proves the caller holds the
  // device's secret before anything else, so an id seen in traffic can't be
  // used to register, claim or rename cats as someone else.
  if (!(await verifyDeviceSecret(req, res, body.deviceId))) return;
  const name = body.name.trim().slice(0, 60);
  if (isBlankName(name)) {
    res.status(400).json(BLANK_NAME_BODY);
    return;
  }
  if (containsOffensiveLanguage(name)) {
    res.status(400).json({
      error: "Cat name contains offensive language",
      code: "OFFENSIVE_NAME",
    });
    return;
  }
  // SYC-101: one cat per folded name. Checked first so the answer names
  // the cat holding it; the unique index still decides a race (below).
  const taken = await catNamed(name);
  if (taken) {
    res.status(409).json(await nameTakenBody(taken));
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
      value: { name: row!.name, normalised: row!.normalisedName },
      deviceId: body.deviceId,
      roleAtTime: "public",
      authorityScope: "owner_of_this_cat",
      observedAt: row!.createdAt,
    });
    return row!;
  }).catch(nullOnUniqueViolation);
  if (!cat) {
    // Another cat took the name between the check above and this write.
    res.status(409).json(await nameTakenBody(await catNamed(name)));
    return;
  }
  // The registering device is the owner and has just proved its secret.
  res
    .status(201)
    .json(await catPayload(cat, 0, cat.createdAt, { tier: "owner", deviceId: body.deviceId }));
});

router.get("/cats/:catId", async (req, res) => {
  const startedAt = performance.now();
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
  // looking each sighting's photo up on its own (an N+1 — one round trip to
  // Neon per row, serialised 5 at a time behind the pool's default max: 10)
  // — a cat page with 50 sightings would otherwise cost 50 extra round
  // trips to Frankfurt from Replit EU.
  const sightings = await db
    .select({
      sighting: sightingsTable,
      spotterUsername: profilesTable.username,
      spotterNickname: profilesTable.nickname,
      photoId: photosTable.id,
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
  // A sighting whose photo the team hid stays in the list, with no photo (PR 6).
  const hidden = await hiddenPhotoIds(sightings.map((r) => r.sighting.photoId));

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
    lookupDiscoverer(cat.discovererDeviceId),
  ]);

  const { viewer, canClaim } = await detailViewer(req, cat);
  const catBody = await catPayload(
    cat,
    sightings.length,
    sightings[0]?.sighting.createdAt ?? cat.createdAt,
    viewer,
  );
  logRouteDuration(req, "GET /cats/:id", startedAt, { catId });
  res.json({
    cat: catBody,
    fansCount: fans,
    careTimeline: [
      ...updates.map((u) => ({
        type: u.updateType,
        message: u.message,
        at: toPublicDay(u.createdAt),
      })),
      // The cat-alog entry itself is always the oldest event on the timeline.
      {
        type: "discovered" as const,
        message:
          discovererProfile?.username ??
          discovererProfile?.nickname ??
          // Null when the discoverer deleted their data: the app says "a
          // spotter" in the reader's language (SYC-235).
          spotterCode(cat.discovererDeviceId),
        // A date, never a time (§6.4.4): this is the first sighting's moment.
        at: toPublicDay(cat.createdAt),
      },
    ],
    // §6.4.1: no sighting carries a position in public, not even for the
    // cat's owner. Photo, spotter and date only.
    sightings: sightings.map(
      ({ sighting: s, spotterUsername, spotterNickname, photoId, photoPublicId }) =>
        serialiseSighting({
          id: s.id,
          catId: s.catId,
          deviceId: s.deviceId,
          createdAt: s.createdAt,
          spotterUsername: spotterUsername ?? null,
          spotterNickname: spotterNickname ?? null,
          photoUrl: publicPhotoUrl(
            photoId != null && photoPublicId != null ? { id: photoId, publicId: photoPublicId } : null,
            hidden,
          ),
        }),
    ),
    canClaim,
  });
});

/**
 * English fallbacks for the claim refusals (claiming-a-cat.md §4.4). The app
 * shows its own translated line, chosen by `code`. None carries a distance,
 * a direction or a position (§3, §11; review 2, HIGH-1).
 */
const REFUSAL_TEXT = {
  NOT_MET: "Spot this cat with the camera first, then you can say it lives with you.",
  ALREADY_HOMED: "This cat already has a home.",
  NOT_ON_STREET: "This cat can't be marked as yours right now.",
  NOT_CONFIRMED: "Only people who live on Syros can say a cat lives with them.",
  PIN_TOO_FAR:
    "That's a long way from where this cat is usually seen. Move the pin to where the cat lives. If it really lives there, write to Syros Cats.",
} as const;
const TOO_MANY = "Too many requests. Please try again later.";
/** §11: a phone that let a cat go can't claim that same cat again for this long. */
const CLAIM_COOLDOWN_DAYS = 7;

function refusalStatus(code: ClaimRefusal): number {
  return code === "NOT_MET" ? 403 : 409;
}

/**
 * "This is my cat" (claiming-a-cat.md §3–§5, §8, §11). In this order, and
 * refused at the first that fails:
 * 1. the body: a pin that isn't a position is a plain 400;
 * 2. the device secret (SYC-107), so every answer below goes only to the
 *    phone itself, and only the proven id is ever checked;
 * 3. the claim limit, counting every attempt, refusals included;
 * 4. rules 1 and 2 (claimEligibility): street, no owner, met it. The same
 *    owner again is 200 with nothing written (rule 4);
 * 5. the two confirmations, then the pin's reach from the cat's PUBLIC
 *    position, then the note's moderation, then the let-go cooldown;
 * 6. in one transaction that locks the cat row, rules 1 and 2 again,
 *    read through that transaction (§5), then the owner link, note, pin
 *    and `homed`.
 * Nothing here logs the body: the request logger writes the method and URL
 * only (app.ts), and errors go through safeError.
 */
router.post("/cats/:catId/claim", async (req, res) => {
  const catId = Number(req.params.catId);
  if (!Number.isInteger(catId)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = ClaimCatBody.safeParse(req.body);
  if (!parsed.success) {
    // Plain: no issues echoed back, so nothing of the body is repeated.
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const body = parsed.data;
  // SYC-107: before anything about the cat, so the answers below are only
  // ever given to the device itself.
  const deviceId = await verifyDeviceSecret(req, res, body.deviceId);
  if (!deviceId) return;
  if (!checkClaimLimit(deviceId)) {
    res.status(429).json({ error: TOO_MANY, code: "CLAIM_LIMIT" });
    return;
  }

  const [cat] = await db.select().from(catsTable).where(eq(catsTable.id, catId));
  if (!cat) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const pre = await claimEligibility(db, { catId, deviceId });
  if (pre.ok === "owner") {
    res.json(await catPayload(cat, await sightingsCountFor(catId), new Date(), { tier: "owner", deviceId }));
    return;
  }
  if (pre.ok === false) {
    res.status(refusalStatus(pre.code)).json({ error: REFUSAL_TEXT[pre.code], code: pre.code });
    return;
  }
  if (body.livesOnSyros !== true || body.livesInMyHome !== true) {
    res.status(422).json({ error: REFUSAL_TEXT.NOT_CONFIRMED, code: "NOT_CONFIRMED" });
    return;
  }
  if (!pinWithinReach(cat, body.homePin)) {
    res.status(422).json({ error: REFUSAL_TEXT.PIN_TOO_FAR, code: "PIN_TOO_FAR" });
    return;
  }
  const note = (body.homeNote ?? "").trim().slice(0, 200) || null;
  if (note !== null && containsOffensiveLanguage(note)) {
    res.status(400).json({ error: "Home note contains offensive language", code: "OFFENSIVE_NOTE" });
    return;
  }
  if (await letGoWithinDays(db, catId, deviceId, CLAIM_COOLDOWN_DAYS)) {
    res.status(429).json({ error: TOO_MANY, code: "CLAIM_COOLDOWN" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    // §5: lock the row, then re-check through this transaction, so two
    // phones can't both win and a claim can't race a team statement.
    await tx.execute(sql`select id from cats where id = ${catId} for update`);
    const again = await claimEligibility(tx, { catId, deviceId });
    if (again.ok !== true) return again;
    // §8: the "has a home" message goes out on a cat's first claim only.
    const prior = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from observations
       where cat_id = ${catId}
         and kind = 'life_status'
         and authority_scope = 'owner_of_this_cat'
         and value->>'status' = 'homed'`);
    const firstEver = prior.rows[0]!.n === 0;
    const [row] = await tx
      .update(catsTable)
      .set({
        ownerDeviceId: deviceId,
        homeDescription: note,
        // §5: stored to about a metre.
        homeLat: Number(body.homePin.lat.toFixed(5)),
        homeLng: Number(body.homePin.lng.toFixed(5)),
      })
      .where(eq(catsTable.id, catId))
      .returning();
    await writeObservation(tx, {
      catId,
      kind: "life_status",
      value: { status: "homed" },
      deviceId,
      roleAtTime: "public",
      authorityScope: "owner_of_this_cat",
      observedAt: new Date(),
    });
    return { ok: true as const, row: row!, firstEver };
  });

  if (result.ok === false) {
    res.status(refusalStatus(result.code)).json({ error: REFUSAL_TEXT[result.code], code: result.code });
    return;
  }
  if (result.ok === "owner") {
    // The same phone's other request won the lock a moment earlier.
    const [now] = await db.select().from(catsTable).where(eq(catsTable.id, catId));
    res.json(await catPayload(now!, await sightingsCountFor(catId), new Date(), { tier: "owner", deviceId }));
    return;
  }
  if (result.firstEver) {
    // Fire-and-forget. Never the note or the pin (§8, SYC-232).
    void notifyCatSpotters(catId, deviceId, {
      title: `${result.row.name} has a home!`,
      body: `${result.row.name} now has a home.`,
      data: { type: "cat_claimed", catId },
    });
  }
  res.json(
    await catPayload(result.row, await sightingsCountFor(catId), new Date(), { tier: "owner", deviceId }),
  );
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
    if (isBlankName(newName)) {
      res.status(400).json(BLANK_NAME_BODY);
      return;
    }
    if (containsOffensiveLanguage(newName)) {
      res.status(400).json({
        error: "Cat name contains offensive language",
        code: "OFFENSIVE_NAME",
      });
      return;
    }
    // SYC-101: one cat per folded name. Another cat holding it is refused,
    // naming that cat; the owner re-spelling their own cat's name (Mimi to
    // MIMI, say) is fine.
    const holder = await catNamed(newName);
    if (holder && holder.id !== catId) {
      res.status(409).json(await nameTakenBody(holder));
      return;
    }
    changes.name = newName;
  }
  if (body.homeDescription !== undefined) {
    // claiming-a-cat.md §11: the note is moderated at every edit, as at the
    // claim.
    const note = body.homeDescription.trim().slice(0, 200);
    if (note && containsOffensiveLanguage(note)) {
      res.status(400).json({ error: "Home note contains offensive language", code: "OFFENSIVE_NOTE" });
      return;
    }
    changes.homeDescription = note;
  }

  let updated = cat;
  if (Object.keys(changes).length > 0) {
    const changedAt = new Date();
    const renamed = changes.name !== undefined && changes.name !== cat.name;
    const written = await db.transaction(async (tx) => {
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
          value: { name: row!.name, normalised: row!.normalisedName },
          deviceId: body.deviceId,
          roleAtTime: "public",
          authorityScope: "owner_of_this_cat",
          observedAt: changedAt,
        });
      }
      return row!;
    }).catch(nullOnUniqueViolation);
    if (!written) {
      // Another cat took the name between the check above and this write.
      res.status(409).json(await nameTakenBody(await catNamed(changes.name!)));
      return;
    }
    updated = written;
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
  // The caller proved the device secret above and is (now) the owner.
  res.json(
    await catPayload(updated, count, new Date(), { tier: "owner", deviceId: body.deviceId }),
  );
});

export default router;
