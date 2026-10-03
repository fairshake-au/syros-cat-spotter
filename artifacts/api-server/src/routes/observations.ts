import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import {
  db,
  catsTable,
  observationsTable,
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
import { refuseNotSignedIn } from "../lib/teamAuth/refuse";
import { photoUrl } from "../lib/catHelpers";

/**
 * The correction path (data-spine plan, PR 8; spec §4.5, §3.5).
 *
 * The endpoints only — there is no staff screen yet (SYC-43's later parts
 * build it); until then these are reachable only by tests and by anyone who
 * can sign in through the hand-off. Behind `requireTeam(capability)`
 * (`set_life_status`, `set_sterilisation`), merged in #28.
 *
 * `POST /observations` is a fresh team statement, with a reason, embedded in
 * the observation's own `value` (there is no separate "reason" column for a
 * plain statement — only a supersede carries one in the schema). `POST
 * /observations/{id}/supersede` is the correction path: it writes a NEW
 * observation of the same kind as the one it corrects, pointed at it via
 * `supersedesId`/`supersedeReason`. This is deliberately a *write*, not a
 * delete or an update — nothing in `observations` is ever changed in place
 * (§10.1) — and it is also how a staff member fixes a mistake whose true
 * date is *earlier* than a wrong entry already on record: simply adding a
 * newer-dated correction wouldn't beat the wrong entry under the resolver's
 * newest-wins precedence (§4.6), so the correction has to name exactly which
 * observation it replaces (PR 1 review, J-series; flagged in the PR body).
 */

const router: IRouter = Router();

/** The two kinds a direct team statement may set (§4.5, §3.5). A staff
 * ear-tip correction ("that's not a clip") only ever happens through
 * supersede, never through a fresh `POST /observations` — see the module
 * doc comment and the plan's PR 8 section. */
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
 * POST /observations — a fresh team statement of life status or
 * sterilisation, with a reason (§4.5, §3.5). `roleAtTime: "staff"`,
 * `accountId` is the signed-in person's `people.id`.
 */
router.post(
  "/observations",
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
 * POST /observations/{id}/supersede — the correction path (§4.5): marks one
 * observation wrong, with a reason, by writing a new one of the same kind
 * that points at it. A staff "that's not a clip" is exactly this, applied to
 * a spotter's `ear_tip { clipped: true }` with a new `{ clipped: false }`
 * (PR 1's rule 5 already handles what that does to the derived status).
 */
router.post(
  "/observations/:id/supersede",
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

    const [original] = await db
      .select()
      .from(observationsTable)
      .where(eq(observationsTable.id, id));
    if (!original) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const [alreadySuperseded] = await db
      .select({ id: observationsTable.id })
      .from(observationsTable)
      .where(eq(observationsTable.supersedesId, id));
    if (alreadySuperseded) {
      res.status(409).json({
        error: "Already superseded",
        code: "ALREADY_SUPERSEDED",
      });
      return;
    }

    const person = teamPerson(res);
    const capability = capabilityFor(original.kind);
    if (!capability || !can(person, capability)) {
      req.log.info(
        { reason: "missing_capability", kind: original.kind },
        "supersede refused",
      );
      refuseNotSignedIn(req, res);
      return;
    }

    try {
      const row = await db.transaction(async (tx) =>
        writeObservation(tx, {
          catId: original.catId,
          kind: original.kind as ObservationKind,
          value: body.value,
          accountId: person.id,
          roleAtTime: "staff",
          observedAt: observedAtOrNow(body.observedAt),
          supersedesId: original.id,
          supersedeReason: body.reason,
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
 * GET /observations/review/likely — the *Likely* review list (§4.5 point 3):
 * cats whose sterilised status is currently *Likely*, newest evidence
 * first, with the evidence photos so a team member can judge them without
 * leaving the list. SYC-119 Slice B's hand-pick marker (hand picks sorted
 * first) doesn't exist yet — this list is plain newest-first until then,
 * noted in the PR body.
 */
router.get(
  "/observations/review/likely",
  requireTeam("set_sterilisation"),
  async (_req: Request, res: Response) => {
    const cats = await db
      .select({ id: catsTable.id, name: catsTable.name })
      .from(catsTable);
    if (cats.length === 0) {
      res.json({ cats: [] });
      return;
    }

    const records = await loadCatRecords(cats.map((c) => c.id));
    const now = new Date();

    const likely: {
      catId: number;
      name: string;
      sterilisedAsOf: string;
      evidence: {
        observationId: number;
        photoId: number | null;
        photoUrl: string | null;
        observedAt: string;
        side: string | null;
      }[];
    }[] = [];

    for (const cat of cats) {
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

      const evidence = await Promise.all(
        evidenceObservations
          .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())
          .map(async (o) => ({
            observationId: o.id,
            photoId: o.photoId,
            photoUrl: o.photoId != null ? await photoUrl(o.photoId) : null,
            observedAt: o.observedAt.toISOString(),
            side:
              typeof (o.value as { side?: unknown })?.side === "string"
                ? ((o.value as { side: string }).side)
                : null,
          })),
      );

      likely.push({
        catId: cat.id,
        name: cat.name,
        sterilisedAsOf: snapshot.sterilised.asOf,
        evidence,
      });
    }

    likely.sort(
      (a, b) =>
        new Date(b.sterilisedAsOf).getTime() - new Date(a.sterilisedAsOf).getTime(),
    );

    res.json({ cats: likely });
  },
);

export default router;
