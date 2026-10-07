import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { type Observation } from "@workspace/db";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { ObservationRefused } from "../lib/observations";
import {
  recordTeamStatement,
  supersedeStatement,
} from "../lib/teamCorrections";
import { listLikelyForReview } from "../lib/likelyReview";
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
 * The JSON endpoints. The dashboard's forms (routes/teamCorrections.ts,
 * SYC-43 part 2 PR 4) write through the very same functions in
 * lib/teamCorrections.ts, so a form and these routes can never write
 * different rows for the same input (test P4-6). Behind
 * `requireTeam(capability)` (`set_life_status`, `set_sterilisation`).
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
 * POST, it must come from the dashboard's own origin (requireOrigin). The
 * write itself is recordTeamStatement, shared with the dashboard's form.
 */
router.post(
  "/team/observations",
  requireOrigin(TEAM_ORIGIN),
  requireTeam(),
  async (req: Request, res: Response) => {
    const parsed = CreateObservationBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const body = parsed.data;

    try {
      const row = await recordTeamStatement(teamPerson(res), {
        catId: body.catId,
        kind: body.kind,
        value: body.value,
        reason: body.reason,
        observedAt: observedAtOrNow(body.observedAt),
      });
      res.status(201).json(serialise(row));
    } catch (err) {
      if (err instanceof ObservationRefused) {
        if (err.code === "NOT_AUTHORISED") {
          req.log.info(
            { reason: "missing_capability", kind: body.kind },
            "observation refused",
          );
          refuseNotSignedIn(req, res);
          return;
        }
        if (err.code === "NOT_FOUND") {
          res.status(404).json({ error: "Not found" });
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
 * POST /team/observations/{id}/supersede — the correction path (§4.5):
 * marks one observation wrong, with a reason, by writing a new one of the
 * same kind that points at it. A staff "that's not a clip" is exactly this,
 * applied to a spotter's `ear_tip { clipped: true }` with a new
 * `{ clipped: false }` (PR 1's rule 5 already handles what that does to the
 * derived status). Like every dashboard POST, it must come from the
 * dashboard's own origin (requireOrigin).
 *
 * The write, its two-step authorisation (review of #68,
 * "authz-ordering-leak") and its row lock ("double-supersede-race") are
 * supersedeStatement in lib/teamCorrections.ts, shared with the dashboard's
 * "Mark wrong" and "That's not a clip" forms.
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

    try {
      const { row } = await supersedeStatement(teamPerson(res), {
        id,
        value: body.value,
        reason: body.reason,
        observedAt: observedAtOrNow(body.observedAt),
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
          req.log.info({ reason: "missing_capability" }, "supersede refused");
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
 * point 3) as JSON: cats waiting for the team to look at their clipped-ear
 * evidence, with the evidence photos. The list and its rule live in
 * lib/likelyReview.ts, shared with the dashboard's page at GET
 * /api/team/likely (SYC-43 part 2, PR 4, which changed it in two ways: the
 * photos are team photo URLs, and a cat whose newest clipped answer is the
 * team's own "Looks right" is off the list).
 */
router.get(
  "/team/observations/review/likely",
  requireTeam("set_sterilisation"),
  async (_req: Request, res: Response) => {
    res.json({ cats: await listLikelyForReview() });
  },
);

export default router;
