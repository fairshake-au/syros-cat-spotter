import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  catsTable,
  observationsTable,
  photosTable,
  type Observation,
} from "@workspace/db";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { can, type Capability } from "../lib/capabilities";
import {
  writeObservation,
  loadCatRecords,
  ObservationRefused,
  type ObservationKind,
} from "../lib/observations";
import { resolveCat } from "../lib/resolve";
import {
  refuseNotSignedIn,
  requireOrigin,
  setTeamHeaders,
} from "../lib/teamAuth/refuse";
import { TEAM_ORIGIN } from "../lib/teamAuth/config";

/**
 * Not in lib/api-spec/openapi.yaml, by design (review of #68): every other
 * staff dashboard route (team.ts, welfare.ts, reports.ts) is left out of
 * the generated spec/client/zod packages too, because those are bundled
 * into the public mobile app — shipping staff-only request/response shapes
 * in that bundle is unnecessary attack surface for a route the app never
 * calls. These three endpoints:
 *
 *   POST   /api/team/observations
 *   POST   /api/team/observations/:id/supersede
 *   GET    /api/team/observations/review/likely
 *
 * See the module doc comment immediately below for what each does and why.
 */

/**
 * The correction path (data-spine plan, PR 8; spec §4.5, §3.5).
 *
 * The endpoints only — there is no staff screen yet (SYC-43's later parts
 * build it); until then these are reachable only by tests and by anyone who
 * can sign in through the hand-off. Behind `requireTeam(capability)`
 * (`set_life_status`, `set_sterilisation`), merged in #28.
 *
 * Mounted under `/team/observations*`, like every other dashboard route
 * (team.ts, welfare.ts, reports.ts) — NOT at `/observations`. `/api/team/`
 * is the one path prefix app.ts exempts from the app-wide `cors()` and from
 * the public generated client (see this file's doc comment at the bottom
 * for why these endpoints aren't in openapi.yaml). A dashboard mutation
 * outside that prefix gets the blanket CORS middleware and no Origin check
 * — exactly the gap an adversarial review of this PR found (review of #68).
 *
 * `POST /team/observations` is a fresh team statement, with a reason,
 * embedded in the observation's own `value` (there is no separate "reason"
 * column for a plain statement — only a supersede carries one in the
 * schema). `POST /team/observations/{id}/supersede` is the correction path:
 * it writes a NEW observation of the same kind as the one it corrects,
 * pointed at it via `supersedesId`/`supersedeReason`. This is deliberately
 * a *write*, not a delete or an update — nothing in `observations` is ever
 * changed in place (§10.1) — and it is also how a staff member fixes a
 * mistake whose true date is *earlier* than a wrong entry already on record
 * (simply adding a newer-dated correction wouldn't beat the wrong entry
 * under the resolver's newest-wins precedence, §4.6), so the correction has
 * to name exactly which observation it replaces (PR 1 review, J-series;
 * flagged in the PR body).
 */

const router: IRouter = Router();

// Every response from this router carries the dashboard's headers (CSP,
// no-store, Referrer-Policy), success or failure alike — team.ts's own
// convention (setTeamHeaders), applied once here instead of at each
// handler/return so a new branch can't forget it. Scoped to this router's
// own paths: the router is mounted on the shared /api router, so an
// unscoped use() would also stamp unmatched and later-mounted routes.
router.use("/team/observations", (_req: Request, res: Response, next) => {
  setTeamHeaders(res);
  next();
});

/** The two kinds a direct team statement may set (§4.5, §3.5). A staff
 * ear-tip correction ("that's not a clip") only ever happens through
 * supersede, never through a fresh `POST /team/observations` — see the
 * module doc comment and the plan's PR 8 section. */
const DIRECT_KINDS = ["life_status", "sterilised"] as const;
type DirectKind = (typeof DIRECT_KINDS)[number];

/** Which capability gates writing or superseding a given kind. `ear_tip` has
 * no capability of its own — a clipped-tip correction feeds sterilised, so
 * it is gated the same way sterilised itself is. Any other kind (note,
 * colony, name, …) has no team capability at all and is refused. */
function capabilityFor(kind: string): Capability | null {
  if (kind === "life_status") return "set_life_status";
  if (kind === "sterilised" || kind === "ear_tip") return "set_sterilisation";
  return null;
}

/** Every capability a supersede could ever require, for the pre-lookup gate
 * below — see its doc comment. */
const SUPERSEDE_CAPABILITIES: readonly Capability[] = [
  "set_life_status",
  "set_sterilisation",
];

const LifeStatusValue = z.object({
  status: z.enum(["street", "homed", "in_care", "deceased"]),
});
const SterilisedValue = z.object({ sterilised: z.boolean() });

const CreateObservationBody = z.discriminatedUnion("kind", [
  z.object({
    catId: z.number().int().positive(),
    kind: z.literal("life_status"),
    value: LifeStatusValue,
    reason: z.string().trim().min(1).max(500),
    observedAt: z.string().datetime({ offset: true }).optional(),
  }),
  z.object({
    catId: z.number().int().positive(),
    kind: z.literal("sterilised"),
    value: SterilisedValue,
    reason: z.string().trim().min(1).max(500),
    observedAt: z.string().datetime({ offset: true }).optional(),
  }),
]);

const SupersedeBody = z.object({
  // Any valid value for the kind being superseded; writeObservation's own
  // validateValue is the authority on the shape (checked after the kind is
  // known, once the original row is loaded).
  value: z.record(z.string(), z.unknown()),
  reason: z.string().trim().min(1).max(500),
  observedAt: z.string().datetime({ offset: true }).optional(),
});

function badRequest(res: Response, err: z.ZodError) {
  res.status(400).json({
    error: "Invalid request",
    fields: [...new Set(err.issues.map((i) => i.path.join(".")))],
  });
}

function serialise(o: Observation) {
  return {
    id: o.id,
    catId: o.catId,
    kind: o.kind,
    value: o.value,
    accountId: o.accountId,
    deviceId: o.deviceId,
    roleAtTime: o.roleAtTime,
    authorityScope: o.authorityScope,
    provenance: o.provenance,
    observedAt: o.observedAt.toISOString(),
    createdAt: o.createdAt.toISOString(),
    supersedesId: o.supersedesId,
    supersedeReason: o.supersedeReason,
  };
}

function observedAtOrNow(input?: string): Date {
  return input ? new Date(input) : new Date();
}

/**
 * POST /team/observations — a fresh team statement of life status or
 * sterilisation, with a reason (§4.5, §3.5). `roleAtTime: "staff"`,
 * `accountId` is the signed-in person's `people.id`. Like every dashboard
 * POST, it must come from the dashboard's own origin (requireOrigin).
 */
router.post(
  "/team/observations",
  requireOrigin(TEAM_ORIGIN),
  requireTeam(),
  async (req: Request, res: Response) => {
    const parsed = CreateObservationBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const body = parsed.data;

    const person = teamPerson(res);
    const capability = capabilityFor(body.kind);
    if (!capability || !can(person, capability)) {
      req.log.info(
        { reason: "missing_capability", kind: body.kind },
        "observation refused",
      );
      refuseNotSignedIn(req, res);
      return;
    }

    const [cat] = await db
      .select({ id: catsTable.id })
      .from(catsTable)
      .where(eq(catsTable.id, body.catId));
    if (!cat) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    try {
      const row = await db.transaction(async (tx) =>
        writeObservation(tx, {
          catId: body.catId,
          kind: body.kind as DirectKind,
          // There is no dedicated "reason" column for a plain statement
          // (only a supersede carries `supersedeReason`); it travels inside
          // the kind-specific value, exactly as `sterilised`'s own example
          // in the spec already carries extra context fields (§10.1).
          value: { ...body.value, reason: body.reason },
          accountId: person.id,
          roleAtTime: "staff",
          observedAt: observedAtOrNow(body.observedAt),
        }),
      );
      res.status(201).json(serialise(row));
    } catch (err) {
      if (err instanceof ObservationRefused) {
        res.status(400).json({ error: err.code, message: err.message });
        return;
      }
      throw err;
    }
  },
);

/**
 * POST /team/observations/{id}/supersede — the correction path (§4.5):
 * marks one observation wrong, with a reason, by writing a new one of the
 * same kind that points at it. A staff "that's not a clip" is exactly this,
 * applied to a spotter's `ear_tip { clipped: true }` with a new
 * `{ clipped: false }` (PR 1's rule 5 already handles what that does to the
 * derived status). Like every dashboard POST, it must come from the
 * dashboard's own origin (requireOrigin).
 *
 * Authorisation runs in two steps (review of #68, "authz-ordering-leak"):
 *
 * 1. Before touching the database at all: does the signed-in person hold
 *    *any* capability a supersede could ever require? Someone who holds
 *    neither `set_life_status` nor `set_sterilisation` gets the uniform
 *    401 straight away — they learn nothing about whether the target id
 *    exists or has already been corrected. (Today's role model grants
 *    staff every capability and guardian/volunteer/vet none, so this gate
 *    alone covers every reachable case; the kind-specific check below stays
 *    as defense in depth for when roles are split further, §7.2.)
 * 2. Only once that's passed does the row get locked, loaded, and checked
 *    for existence / already-superseded / the exact capability its kind
 *    needs — all inside one transaction, so a concurrent supersede against
 *    the same target can't race past the already-superseded check (see the
 *    lock below; "double-supersede-race").
 */
router.post(
  "/team/observations/:id/supersede",
  requireOrigin(TEAM_ORIGIN),
  requireTeam(),
  async (req: Request, res: Response) => {
    const id = Number(req.params["id"]);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const parsed = SupersedeBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const body = parsed.data;

    const person = teamPerson(res);
    if (!SUPERSEDE_CAPABILITIES.some((c) => can(person, c))) {
      req.log.info(
        { reason: "missing_capability" },
        "supersede refused",
      );
      refuseNotSignedIn(req, res);
      return;
    }

    try {
      const row = await db.transaction(async (tx) => {
        // Locks the target row for the rest of this transaction. A second,
        // concurrent supersede against the same id blocks here until this
        // transaction commits or rolls back, instead of both passing the
        // "already superseded?" check before either INSERT lands (the race
        // the review's probe demonstrated). No migration: this is a
        // transaction-scoped lock on an existing row, not a schema change
        // (PR 3 holds migration 0006; a partial unique index on
        // supersedes_id is a possible later belt-and-braces — filed as a
        // Low follow-up, not needed for correctness here).
        const lockedRows = await tx.execute<{ id: number }>(
          sql`select id from observations where id = ${id} for update`,
        );
        if (lockedRows.rows.length === 0) {
          throw new ObservationRefused("NOT_FOUND", "Not found");
        }

        const [original] = await tx
          .select()
          .from(observationsTable)
          .where(eq(observationsTable.id, id));
        if (!original) {
          throw new ObservationRefused("NOT_FOUND", "Not found");
        }

        const [alreadySuperseded] = await tx
          .select({ id: observationsTable.id })
          .from(observationsTable)
          .where(eq(observationsTable.supersedesId, id));
        if (alreadySuperseded) {
          throw new ObservationRefused(
            "ALREADY_SUPERSEDED",
            "Already superseded",
          );
        }

        const capability = capabilityFor(original.kind);
        if (!capability || !can(person, capability)) {
          req.log.info(
            { reason: "missing_capability", kind: original.kind },
            "supersede refused",
          );
          throw new ObservationRefused("NOT_AUTHORISED", "Not authorised");
        }

        return writeObservation(tx, {
          catId: original.catId,
          kind: original.kind as ObservationKind,
          value: body.value,
          accountId: person.id,
          roleAtTime: "staff",
          observedAt: observedAtOrNow(body.observedAt),
          supersedesId: original.id,
          supersedeReason: body.reason,
        });
      });
      res.status(201).json(serialise(row));
    } catch (err) {
      if (err instanceof ObservationRefused) {
        if (err.code === "NOT_FOUND") {
          res.status(404).json({ error: "Not found" });
          return;
        }
        if (err.code === "ALREADY_SUPERSEDED") {
          res.status(409).json({
            error: "Already superseded",
            code: "ALREADY_SUPERSEDED",
          });
          return;
        }
        if (err.code === "NOT_AUTHORISED") {
          refuseNotSignedIn(req, res);
          return;
        }
        res.status(400).json({ error: err.code, message: err.message });
        return;
      }
      throw err;
    }
  },
);

/**
 * GET /team/observations/review/likely — the *Likely* review list (§4.5
 * point 3): cats whose sterilised status is currently *Likely*, newest
 * evidence first, with the evidence photos so a team member can judge them
 * without leaving the list. SYC-119 Slice B's hand-pick marker (hand picks
 * sorted first) doesn't exist yet — this list is plain newest-first until
 * then, noted in the PR body.
 *
 * Only loads cats that actually have an `ear_tip` observation (review of
 * #68, "n-plus-one": the previous version loaded every cat in the corpus to
 * find the handful at Likely) and batches the evidence photo lookups into
 * one query, the same join `listCatsWithStats` uses, instead of one
 * `photoUrl()` round trip per photo.
 */
router.get(
  "/team/observations/review/likely",
  requireTeam("set_sterilisation"),
  async (_req: Request, res: Response) => {
    const earTipCats = await db
      .selectDistinct({
        id: catsTable.id,
        name: catsTable.name,
      })
      .from(observationsTable)
      .innerJoin(catsTable, eq(catsTable.id, observationsTable.catId))
      .where(eq(observationsTable.kind, "ear_tip"));
    if (earTipCats.length === 0) {
      res.json({ cats: [] });
      return;
    }

    const records = await loadCatRecords(earTipCats.map((c) => c.id));
    const now = new Date();

    type EvidenceDraft = {
      observationId: number;
      photoId: number | null;
      observedAt: string;
      side: string | null;
    };

    const likelyDraft: {
      catId: number;
      name: string;
      sterilisedAsOf: string;
      evidence: EvidenceDraft[];
    }[] = [];

    for (const cat of earTipCats) {
      const record = records.get(cat.id);
      if (!record) continue;
      const snapshot = resolveCat(record.observations, record.evidenceOfLife, now);
      if (snapshot.sterilised.confidence !== "likely") continue;

      const activeIds = new Set(
        record.observations
          .filter((o) => !record.observations.some((other) => other.supersedesId === o.id))
          .map((o) => o.id),
      );
      const evidenceObservations = record.observations.filter((o) => {
        if (o.kind !== "ear_tip" || !activeIds.has(o.id)) return false;
        const v = o.value as { clipped?: unknown; side?: unknown };
        return v?.clipped === true && o.photoId != null;
      });

      const evidence: EvidenceDraft[] = evidenceObservations
        .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())
        .map((o) => ({
          observationId: o.id,
          photoId: o.photoId,
          observedAt: o.observedAt.toISOString(),
          side:
            typeof (o.value as { side?: unknown })?.side === "string"
              ? ((o.value as { side: string }).side)
              : null,
        }));

      likelyDraft.push({
        catId: cat.id,
        name: cat.name,
        sterilisedAsOf: snapshot.sterilised.asOf,
        evidence,
      });
    }

    // One batched photo-id -> public-id lookup for every evidence photo
    // across every cat, instead of one query per photo (listCatsWithStats's
    // own pattern for exactly this join).
    const photoIds = [
      ...new Set(
        likelyDraft.flatMap((c) =>
          c.evidence.map((e) => e.photoId).filter((id): id is number => id != null),
        ),
      ),
    ];
    const photoRows =
      photoIds.length === 0
        ? []
        : await db
            .select({ id: photosTable.id, publicId: photosTable.publicId })
            .from(photosTable)
            .where(inArray(photosTable.id, photoIds));
    const publicIdByPhotoId = new Map(photoRows.map((p) => [p.id, p.publicId]));

    const likely = likelyDraft.map((c) => ({
      ...c,
      evidence: c.evidence.map((e) => ({
        ...e,
        photoUrl:
          e.photoId != null && publicIdByPhotoId.has(e.photoId)
            ? `/api/photos/${publicIdByPhotoId.get(e.photoId)}`
            : null,
      })),
    }));

    likely.sort(
      (a, b) =>
        new Date(b.sterilisedAsOf).getTime() - new Date(a.sterilisedAsOf).getTime(),
    );

    res.json({ cats: likely });
  },
);

export default router;
