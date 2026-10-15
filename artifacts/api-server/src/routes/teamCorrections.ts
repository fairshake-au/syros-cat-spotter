import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { ObservationRefused } from "../lib/observations";
import {
  agreeWithClip,
  catIdOfStatement,
  NAME_MAX,
  recordTeamStatement,
  catOwnerState,
  removeOwnerAndSay,
  renameCat,
  SUPERSEDE_CAPABILITIES,
  supersedeStatement,
} from "../lib/teamCorrections";
import { placeCats } from "../lib/colonyCats";
import { listLikelyForReview } from "../lib/likelyReview";
import { syrNumber } from "../lib/teamCatView";
import { TEAM_ORIGIN } from "../lib/teamAuth/config";
import {
  requireOrigin,
  setTeamHeaders,
} from "../lib/teamAuth/refuse";
import {
  refuseSignedIn,
  requireTeam,
  teamPerson,
  type RequireTeamOptions,
} from "../middlewares/requireTeam";
import { renderPage, type NavKey } from "../lib/teamPages/layout";
import { escapeHtml as esc } from "../lib/teamPages/escape";
import { renderLikelyPage } from "../lib/teamPages/likelyPage";
import { renderConfirmPage } from "../lib/teamPages/confirm";
import { LIFE } from "../lib/teamPages/catPages";
import { can, type Capability } from "../lib/capabilities";

// The corrections (SYC-43 part 2 plan, PR 4): forms on the team cat page and
// the Probably sterilised list. Every POST checks Origin first, then the
// session and capability (requireTeam), then the body; each appends a signed
// observation through lib/teamCorrections.ts, the same functions the JSON
// routes in routes/observations.ts call. Nothing is updated or deleted,
// except `cats.name` on a rename (Decision 5).
//
// A browser form post gets a 303 back to the page it came from; anything else
// gets JSON. A bad form gets a 400 naming the fields only, never echoing what
// was typed (the routes/teamReports.ts convention).

const router: IRouter = Router();

const CAT_ID_RE = /^\d{1,9}$/;
const REASON_MAX = 500;

const isFormPost = (req: Request) =>
  Boolean(req.is("application/x-www-form-urlencoded"));

/** A browser sends a text box's line breaks as CRLF; store them as LF. */
const lf = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n") : v);

/** Postgres refuses a NUL character in text, so a form carrying one is a bad form. */
const noNul = (s: string) => !s.includes(String.fromCharCode(0));

const reasonField = z.preprocess(lf, z.string().trim().min(1).max(REASON_MAX).refine(noNul));

/** An optional date from <input type="date">: "" means none. */
const dateField = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    // A real calendar day: 2026-02-31 would otherwise roll on to 3 March.
    .refine((s) => {
      const d = new Date(`${s}T12:00:00Z`);
      // From 2000: Postgres has no year 0, and no cat here predates the charity.
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && s >= "2000-01-01";
    })
    .optional(),
);

/**
 * Back to the cat page after a form. `statement`: the history row the page
 * should land on (and show its message beside), after a correction.
 */
const catPage = (catId: number, done?: string, statement?: number) =>
  `/api/team/cats/${catId}${done ? `?done=${encodeURIComponent(done)}` : ""}` +
  `${statement != null ? `${done ? "&" : "?"}s=${statement}` : ""}` +
  `#${statement != null ? `s-${statement}` : "corrections"}`;

const fieldsOf = (err: z.ZodError) => [...new Set(err.issues.map((i) => i.path.join(".")))];

/** Today's date on Syros, as YYYY-MM-DD. */
export function athensToday(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Europe/Athens" });
}

/**
 * When a statement dated `date` was true. Midday UTC of that day (afternoon
 * on Syros), or now if that is still to come today. A date after today on
 * Syros is refused before this is called.
 */
export function observedAtFor(date: string | undefined, now = new Date()): Date {
  if (!date) return now;
  const midday = new Date(`${date}T12:00:00Z`);
  return midday.getTime() > now.getTime() ? now : midday;
}

/** A short page saying what was wrong, by field name only, with a way back. */
function formProblem(
  req: Request,
  res: Response,
  status: number,
  opts: { fields?: string[]; message: string; back: string; backLabel: string; active?: NavKey },
) {
  if (!isFormPost(req)) {
    res.status(status).json(
      opts.fields ? { error: "Invalid request", fields: opts.fields } : { error: opts.message },
    );
    return;
  }
  res
    .status(status)
    .type("html")
    .send(
      renderPage({
        title: "That didn't save",
        active: opts.active ?? "cats",
        personName: teamPerson(res).name,
        body:
          `<p>${esc(opts.message)} Nothing was changed.</p>` +
          `<p><a class="tap" href="${esc(opts.back)}">${esc(opts.backLabel)}</a></p>`,
      }),
    );
}

const FIELD_WORDS: Record<string, string> = {
  status: "Choose one of the four",
  sterilised: "Choose yes or no",
  reason: `Say why, in up to ${REASON_MAX} characters`,
  date: "The date wasn't a real date",
  clinic: "The clinic name is too long",
  choice: "Choose what it should say",
  name: `A name can be up to ${NAME_MAX} characters`,
};

const problemFor = (fields: string[]) =>
  fields.map((f) => FIELD_WORDS[f] ?? "Something in the form wasn't right").join(". ") + ".";

function refusalFor(req: Request, res: Response, err: unknown, back: string, active?: NavKey) {
  if (!(err instanceof ObservationRefused)) throw err;
  if (err.code === "NOT_AUTHORISED") {
    req.log.info({ reason: "missing_capability" }, "correction refused");
    return refuseSignedIn(req, res);
  }
  if (err.code === "NOT_FOUND") {
    return formProblem(req, res, 404, {
      message: "That cat or change doesn't exist.",
      back: "/api/team/cats",
      backLabel: "Find a cat",
      active,
    });
  }
  if (err.code === "FUTURE_OBSERVED_AT") {
    return formProblem(req, res, 400, {
      fields: ["date"],
      message: "The date can't be in the future.",
      back,
      backLabel: "Back",
      active,
    });
  }
  return formProblem(req, res, 400, {
    fields: [err.code],
    message: "That answer doesn't fit this kind of change.",
    back,
    backLabel: "Back",
    active,
  });
}

function catIdOf(req: Request): number | null {
  const raw = String(req.params["id"]);
  return CAT_ID_RE.test(raw) ? Number(raw) : null;
}

function notFound(req: Request, res: Response) {
  formProblem(req, res, 404, {
    message: "That cat or change doesn't exist.",
    back: "/api/team/cats",
    backLabel: "Find a cat",
  });
}

/** POSTs that run the same Origin and session checks, with their capability. */
export const formRoute = (capability?: Capability, options?: RequireTeamOptions) => [
  requireOrigin(TEAM_ORIGIN),
  requireTeam(capability, options),
  (_req: Request, res: Response, next: () => void) => {
    setTeamHeaders(res);
    next();
  },
];

// ── Update where the cat lives ────────────────────────────────────────────────────

const LifeStatusForm = z.object({
  status: z.enum(["street", "homed", "in_care", "deceased"]),
  reason: reasonField,
  date: dateField,
  /**
   * JSON only: also remove the owner (claiming-a-cat.md §7). The form has no
   * box any more (SYC-362 D2); a form post asks on a confirm page instead.
   */
  removeOwner: z.union([z.literal("1"), z.literal(true)]).optional(),
  /** "Yes" on the "Are you sure?" page (SYC-362 D1). */
  confirm: z.literal("1").optional(),
});

/**
 * POST /api/team/cats/:id/life-status. "Deceased" needs the date the team
 * knows of; a date after today is refused.
 *
 * An owned cat set to anything but "has a home" (SYC-362 D2):
 * - a form post from someone who may remove owners gets an "Are you sure?"
 *   page first (decided under the lock, in removeOwnerAndSay); Yes removes
 *   the owner and records the status in one transaction;
 * - a form post from someone who may not records the status, keeps the owner,
 *   and says so. That is for cat guardians once the team cat page opens to
 *   them; today the door (set_life_status with no target) refuses them first
 *   (team.guardianLifeStatus.test.ts);
 * - JSON is unchanged: removeOwner=1 removes the owner (needs `remove_owner`),
 *   without it the owner stays.
 */
router.post(
  "/team/cats/:id/life-status",
  ...formRoute("set_life_status"),
  async (req: Request, res: Response) => {
    const catId = catIdOf(req);
    if (catId === null) return notFound(req, res);
    const back = catPage(catId);
    const parsed = LifeStatusForm.safeParse(req.body ?? {});
    if (!parsed.success) {
      const fields = fieldsOf(parsed.error);
      return formProblem(req, res, 400, { fields, message: problemFor(fields), back, backLabel: "Back to the cat" });
    }
    const { status, reason, date, removeOwner, confirm } = parsed.data;
    if (status === "deceased" && !date) {
      return formProblem(req, res, 400, {
        fields: ["date"],
        message: "For “No longer with us”, give the date it happened.",
        back,
        backLabel: "Back to the cat",
      });
    }
    if (date && date > athensToday()) {
      return formProblem(req, res, 400, {
        fields: ["date"],
        message: "The date can't be in the future.",
        back,
        backLabel: "Back to the cat",
      });
    }
    const person = teamPerson(res);
    const form = isFormPost(req);
    const mayRemove = can(person, "remove_owner");
    const observedAt = observedAtFor(date);
    try {
      let ownerRemoved = false;
      let row;
      if (status !== "homed" && form && mayRemove) {
        const out = await removeOwnerAndSay(
          person,
          { catId, status, reason, observedAt },
          confirm ? "if_owner" : "confirm_if_owner",
        );
        if (out.owner === "needs_confirm") {
          const name = out.catName!;
          return void res.status(200).type("html").send(
            renderConfirmPage({
              title: `Remove ${name}'s owner too?`,
              lines: [
                `${name} has an owner. Saving “${LIFE[status]}” also removes the owner.`,
                "The owner stops seeing the exact spot and getting alerts. The owner is not told.",
                "To keep the owner, go back and choose “Has a home”.",
              ],
              action: `/api/team/cats/${catId}/life-status`,
              fields: { status, reason, date },
              yes: "Yes, save and remove the owner",
              cancelHref: catPage(catId),
              cancelLabel: "Back to the cat (nothing changed)",
              personName: person.name,
              active: "cats",
            }),
          );
        }
        ownerRemoved = out.owner === "removed";
        row = out.row!;
      } else if (status !== "homed" && !form && removeOwner) {
        row = (await removeOwnerAndSay(person, { catId, status, reason, observedAt }, "if_owner")).row!;
      } else {
        row = await recordTeamStatement(person, { catId, kind: "life_status", value: { status }, reason, observedAt });
      }
      if (form) {
        // Someone who can't remove owners saved over an owned cat: say the
        // owner is still there (SYC-362 D2).
        const kept =
          !ownerRemoved && !mayRemove && status !== "homed" && (await catOwnerState(catId))?.hasOwner;
        return void res.redirect(
          303,
          catPage(catId, ownerRemoved ? "ownerRemoved" : kept ? "lifeOwnerKept" : "life"),
        );
      }
      res.status(201).json({ id: row.id });
    } catch (err) {
      refusalFor(req, res, err, back);
    }
  },
);

// ── Remove the owner ───────────────────────────────────────────────────────

const RemoveOwnerForm = z.object({
  /** "Yes" on the "Are you sure?" page (SYC-362 D1). */
  confirm: z.literal("1").optional(),
  status: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["street", "in_care", "deceased"]).default("street"),
  ),
  reason: reasonField,
  date: dateField,
});

/**
 * POST /api/team/cats/:id/remove-owner (claiming-a-cat.md §7, D6). Needs
 * `remove_owner` AND `set_life_status`, because it records a status: without
 * either, the same uniform 401 and nothing changes. The work is one
 * transaction (lib/teamCorrections.ts removeOwnerAndSay). Tells nobody.
 */
router.post(
  "/team/cats/:id/remove-owner",
  ...formRoute("remove_owner"),
  async (req: Request, res: Response) => {
    const person = teamPerson(res);
    if (!can(person, "set_life_status")) {
      req.log.info({ reason: "missing_capability" }, "correction refused");
      return refuseSignedIn(req, res);
    }
    const catId = catIdOf(req);
    if (catId === null) return notFound(req, res);
    const back = catPage(catId);
    const parsed = RemoveOwnerForm.safeParse(req.body ?? {});
    if (!parsed.success) {
      const fields = fieldsOf(parsed.error);
      return formProblem(req, res, 400, { fields, message: problemFor(fields), back, backLabel: "Back to the cat" });
    }
    const { status, reason, date, confirm } = parsed.data;
    if (status === "deceased" && !date) {
      return formProblem(req, res, 400, {
        fields: ["date"],
        message: "For “No longer with us”, give the date it happened.",
        back,
        backLabel: "Back to the cat",
      });
    }
    if (date && date > athensToday()) {
      return formProblem(req, res, 400, {
        fields: ["date"],
        message: "The date can't be in the future.",
        back,
        backLabel: "Back to the cat",
      });
    }
    // A form post asks first (SYC-362 D1). The owner is checked again under
    // the lock when Yes comes back, so a second Yes or a refresh finds the
    // owner gone and writes nothing.
    if (isFormPost(req) && !confirm) {
      const state = await catOwnerState(catId);
      if (!state) return notFound(req, res);
      if (!state.hasOwner) return void res.redirect(303, catPage(catId, "ownerGone"));
      return void res.status(200).type("html").send(
        renderConfirmPage({
          title: `Remove ${state.name}'s owner?`,
          lines: [
            "The owner stops seeing the exact spot and getting alerts.",
            "The owner is not told.",
            `${state.name} will be saved as “${LIFE[status]}”.`,
          ],
          action: `/api/team/cats/${catId}/remove-owner`,
          fields: { status, reason, date },
          yes: "Yes, remove the owner",
          cancelHref: back,
          cancelLabel: "Back to the cat (nothing changed)",
          personName: person.name,
          active: "cats",
        }),
      );
    }
    try {
      const out = await removeOwnerAndSay(
        person,
        { catId, status, reason, observedAt: observedAtFor(date) },
        "require_owner",
      );
      if (out.owner === "none") {
        // Someone removed the owner first (or the owner let go): nothing written.
        if (isFormPost(req)) return void res.redirect(303, catPage(catId, "ownerGone"));
        return void res.status(409).json({ error: "No owner", code: "NO_OWNER" });
      }
      if (isFormPost(req)) return void res.redirect(303, catPage(catId, "ownerRemoved", out.row!.id));
      res.status(201).json({ id: out.row!.id });
    } catch (err) {
      refusalFor(req, res, err, back);
    }
  },
);

// ── Update whether sterilised ─────────────────────────────────────────────────

const SterilisationForm = z.object({
  sterilised: z.enum(["yes", "no"]),
  reason: reasonField,
  date: dateField,
  clinic: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(100).optional(),
  ),
});

/**
 * POST /api/team/cats/:id/sterilisation. Yes or no, with an optional date
 * and clinic. Only when Syros Cats or a vet knows: a clipped ear seen in a
 * photo is never proof (the form says so).
 */
router.post(
  "/team/cats/:id/sterilisation",
  ...formRoute("set_sterilisation"),
  async (req: Request, res: Response) => {
    const catId = catIdOf(req);
    if (catId === null) return notFound(req, res);
    const back = catPage(catId);
    const parsed = SterilisationForm.safeParse(req.body ?? {});
    if (!parsed.success) {
      const fields = fieldsOf(parsed.error);
      return formProblem(req, res, 400, { fields, message: problemFor(fields), back, backLabel: "Back to the cat" });
    }
    const { sterilised, reason, date, clinic } = parsed.data;
    if (date && date > athensToday()) {
      return formProblem(req, res, 400, {
        fields: ["date"],
        message: "The date can't be in the future.",
        back,
        backLabel: "Back to the cat",
      });
    }
    try {
      const row = await recordTeamStatement(teamPerson(res), {
        catId,
        kind: "sterilised",
        // The date is when it was true (observedAt), not a second copy in
        // the value: the form and the JSON route then write identical rows
        // for the same input (P4-6).
        value: { sterilised: sterilised === "yes", ...(clinic ? { clinic } : {}) },
        reason,
        observedAt: observedAtFor(date),
      });
      if (isFormPost(req)) return void res.redirect(303, catPage(catId, "sterilised"));
      res.status(201).json({ id: row.id });
    } catch (err) {
      refusalFor(req, res, err, back);
    }
  },
);

// ── Mark a statement wrong ─────────────────────────────────────────────────

/** What the correction should say instead, by the form's `choice`. */
const CHOICES: Record<string, Record<string, unknown>> = {
  street: { status: "street" },
  homed: { status: "homed" },
  in_care: { status: "in_care" },
  deceased: { status: "deceased" },
  sterilised_yes: { sterilised: true },
  sterilised_no: { sterilised: false },
  not_clipped: { clipped: false },
  // A colony statement: the server works out the replacement (spec §2.8), so
  // this carries no value. supersedeStatement ignores it for a colony.
  colony_previous: {},
};

const WrongForm = z.object({
  choice: z.enum(Object.keys(CHOICES) as [string, ...string[]]),
  reason: reasonField,
  date: dateField,
  /** Which page to go back to: the cat's page, or the Probably sterilised list. */
  back: z.enum(["cat", "likely"]).optional(),
});

/**
 * POST /api/team/statements/:id/wrong. Marks one statement wrong, with a
 * reason, through PR 8's supersede (its capability pre-gate, row lock and
 * "already corrected" check). The capability is the one the statement's kind
 * needs, so requireTeam takes none here; supersedeStatement decides.
 */
router.post(
  "/team/statements/:id/wrong",
  ...formRoute(),
  async (req: Request, res: Response) => {
    // Who may, before what was sent (SYC-53 PR 0.5, T2): someone holding
    // none of the correction capabilities gets the 403 whatever the form
    // says, never a 400 about the form. supersedeStatement checks the exact
    // capability again once it knows the statement's kind.
    if (!SUPERSEDE_CAPABILITIES.some((c) => can(teamPerson(res), c))) {
      req.log.info({ reason: "missing_capability" }, "correction refused");
      return refuseSignedIn(req, res);
    }
    const id = catIdOf(req);
    if (id === null) return notFound(req, res);
    const parsed = WrongForm.safeParse(req.body ?? {});
    const toLikely = (req.body as Record<string, unknown> | undefined)?.["back"] === "likely";
    const active: NavKey = toLikely ? "likely" : "cats";
    if (!parsed.success) {
      const fields = fieldsOf(parsed.error);
      return formProblem(req, res, 400, {
        fields,
        message: problemFor(fields),
        back: toLikely ? "/api/team/likely" : "/api/team/cats",
        backLabel: "Back",
        active,
      });
    }
    const { choice, reason, date } = parsed.data;
    const back = toLikely ? "/api/team/likely" : "/api/team/cats";
    if (choice === "deceased" && !date) {
      return formProblem(req, res, 400, {
        fields: ["date"],
        message: "For “No longer with us”, give the date it happened.",
        back,
        backLabel: "Back",
        active,
      });
    }
    if (date && date > athensToday()) {
      return formProblem(req, res, 400, {
        fields: ["date"],
        message: "The date can't be in the future.",
        back,
        backLabel: "Back",
        active,
      });
    }
    try {
      const { row } = await supersedeStatement(teamPerson(res), {
        id,
        value: CHOICES[choice]!,
        reason,
        observedAt: observedAtFor(date),
      });
      if (isFormPost(req)) {
        return void res.redirect(
          303,
          toLikely ? "/api/team/likely?done=not_clipped" : catPage(row.catId, "wrong", row.id),
        );
      }
      res.status(201).json({ id: row.id });
    } catch (err) {
      if (err instanceof ObservationRefused && err.code === "ALREADY_SUPERSEDED") {
        if (!isFormPost(req)) {
          return void res.status(409).json({ error: "Already superseded", code: "ALREADY_SUPERSEDED" });
        }
        // The page says "Someone already corrected this.", with the
        // statement in view and what replaced it underneath.
        if (toLikely) return void res.redirect(303, "/api/team/likely?done=already");
        const catId = await catIdOfStatement(id);
        return void res.redirect(
          303,
          catId === null ? "/api/team/cats" : catPage(catId, "already", id),
        );
      }
      refusalFor(req, res, err, back, active);
    }
  },
);

// ── Rename the cat ─────────────────────────────────────────────────────────

const RenameForm = z.object({
  name: z.preprocess(lf, z.string().max(NAME_MAX * 4)),
  reason: reasonField,
});

/**
 * POST /api/team/cats/:id/name. `cats.name` and a `name` observation in one
 * transaction (Decision 5). A name another cat has is refused, naming it.
 */
router.post(
  "/team/cats/:id/name",
  ...formRoute("rename_cat"),
  async (req: Request, res: Response) => {
    const catId = catIdOf(req);
    if (catId === null) return notFound(req, res);
    const back = catPage(catId);
    const parsed = RenameForm.safeParse(req.body ?? {});
    if (!parsed.success) {
      const fields = fieldsOf(parsed.error);
      return formProblem(req, res, 400, { fields, message: problemFor(fields), back, backLabel: "Back to the cat" });
    }
    try {
      const outcome = await renameCat(teamPerson(res), { catId, ...parsed.data });
      switch (outcome.kind) {
        case "renamed":
          if (isFormPost(req)) return void res.redirect(303, catPage(catId, "renamed"));
          return void res.json({ name: outcome.name });
        case "unchanged":
          if (isFormPost(req)) return void res.redirect(303, catPage(catId, "unchanged"));
          return void res.json({ name: null });
        case "blank":
          return formProblem(req, res, 400, {
            fields: ["name"],
            message: "The new name is empty.",
            back,
            backLabel: "Back to the cat",
          });
        case "offensive":
          return formProblem(req, res, 400, {
            fields: ["name"],
            message: "That name isn't allowed: the app's word filter refuses it.",
            back,
            backLabel: "Back to the cat",
          });
        case "taken": {
          const { holder } = outcome;
          if (!isFormPost(req)) {
            return void res.status(409).json({
              error: "Cat name already taken",
              code: "NAME_TAKEN",
              ...(holder ? { cat: { id: holder.id, name: holder.name } } : {}),
            });
          }
          return void res
            .status(409)
            .type("html")
            .send(
              renderPage({
                title: "That name is taken",
                active: "cats",
                personName: teamPerson(res).name,
                body:
                  (holder
                    ? `<p>Another cat is already called <strong>${esc(holder.name)}</strong>` +
                      ` (<a href="/api/team/cats/${holder.id}">${esc(syrNumber(holder.id))}</a>)`
                    : "<p>Another cat already has that name") +
                  ". Names count as the same whatever the accents or capitals. Nothing was changed.</p>" +
                  `<p><a class="tap" href="${esc(back)}">Back to the cat</a></p>`,
              }),
            );
        }
      }
    } catch (err) {
      refusalFor(req, res, err, back);
    }
  },
);

// ── Colony ─────────────────────────────────────────────────────────────────

/** Digits only, or the word "none" ("take out"); JSON may send a number or null. */
const ColonyForm = z.object({
  colonyId: z.preprocess(
    (v) => (v === null ? "none" : typeof v === "number" ? String(v) : v),
    z.union([z.literal("none"), z.string().regex(CAT_ID_RE)]),
  ),
  /**
   * Set by "Take out of this colony" on a colony page: the colony the cat is
   * being taken out of. A cat that has been moved since the page was drawn
   * is left alone.
   */
  from: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(CAT_ID_RE).optional()),
});

/**
 * POST /api/team/cats/:id/colony. Puts the cat in the colony picked
 * (`colonyId`), or takes it out of its colony (`colonyId=none`), by writing
 * one signed `colony` statement. Needs `assign_cat_to_colony`, with no
 * colony target (plan Decision 1A).
 */
router.post(
  "/team/cats/:id/colony",
  ...formRoute("assign_cat_to_colony"),
  async (req: Request, res: Response) => {
    const catId = catIdOf(req);
    if (catId === null) return notFound(req, res);
    const back = catPage(catId);
    const parsed = ColonyForm.safeParse(req.body ?? {});
    if (!parsed.success) {
      const fields = fieldsOf(parsed.error);
      return formProblem(req, res, 400, {
        fields,
        message: "Pick a colony, or take the cat out of its colony.",
        back,
        backLabel: "Back to the cat",
      });
    }
    const colonyId = parsed.data.colonyId === "none" ? null : Number(parsed.data.colonyId);
    const from = parsed.data.from === undefined ? undefined : Number(parsed.data.from);
    try {
      const out = await placeCats(
        teamPerson(res),
        colonyId,
        [catId],
        from === undefined ? {} : { onlyFrom: from },
      );
      switch (out.kind) {
        case "no_cat":
          return notFound(req, res);
        case "no_colony":
          return formProblem(req, res, 404, {
            fields: ["colonyId"],
            message: "That colony doesn't exist.",
            back,
            backLabel: "Back to the cat",
          });
        case "done": {
          const wrote = out.written[0];
          if (isFormPost(req)) {
            if (from !== undefined) {
              return void res.redirect(
                303,
                `/api/team/colonies/${from}?done=${wrote === undefined ? "notThere" : "takenOut"}`,
              );
            }
            return void res.redirect(
              303,
              wrote === undefined
                ? catPage(catId, "colonyAlready")
                : catPage(catId, colonyId === null ? "colonyOut" : "colony", wrote),
            );
          }
          return void res.status(wrote === undefined ? 200 : 201).json({ id: wrote ?? null });
        }
      }
    } catch (err) {
      refusalFor(req, res, err, back);
    }
  },
);

// ── The Probably sterilised list ───────────────────────────────────────────

const wantsJson = (req: Request) => req.accepts(["html", "json"]) === "json";

const LIKELY_DONE = new Set(["looks_right", "not_clipped", "already"]);

/** GET /api/team/likely: the review list (HTML, or JSON on request). */
router.get(
  "/team/likely",
  requireTeam("set_sterilisation"),
  async (req: Request, res: Response) => {
    const person = teamPerson(res);
    setTeamHeaders(res);
    const cats = await listLikelyForReview();
    if (wantsJson(req)) return void res.json({ cats });
    const done = typeof req.query["done"] === "string" && LIKELY_DONE.has(req.query["done"])
      ? (req.query["done"] as string)
      : undefined;
    res.type("html").send(renderLikelyPage(cats, person.name, done));
  },
);

/**
 * POST /api/team/likely/:id/looks-right (Decision 6): the team agrees the
 * photo shows a clip. The cat stays Probably sterilised and leaves the list.
 */
router.post(
  "/team/likely/:id/looks-right",
  ...formRoute("set_sterilisation"),
  async (req: Request, res: Response) => {
    const id = catIdOf(req);
    if (id === null) return notFound(req, res);
    try {
      const written = await agreeWithClip(teamPerson(res), id);
      if (written === "already") {
        if (isFormPost(req)) return void res.redirect(303, "/api/team/likely?done=already");
        return void res.status(409).json({ error: "Already checked", code: "ALREADY_CHECKED" });
      }
      if (isFormPost(req)) return void res.redirect(303, "/api/team/likely?done=looks_right");
      res.status(201).json({ id: written.id });
    } catch (err) {
      refusalFor(req, res, err, "/api/team/likely", "likely");
    }
  },
);

export default router;
