import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { can } from "../lib/capabilities";
import { foldName } from "@workspace/db";
import {
  COLONY_NAME_MAX,
  COLONY_NOTES_MAX,
  GUARDIAN_NAME_MAX,
  colonyView,
  createColony,
  listColonies,
  updateColony,
  type ColonyChanges,
} from "../lib/teamColonies";
import {
  renderColoniesPage,
  renderColonyPage,
  renderColonyProblem,
  renderNameTaken,
  renderNoSuchColony,
} from "../lib/teamPages/colonyPages";
import { t, type WordKey } from "../lib/teamPages/words";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { refuseSignedIn, requireTeam, teamPerson } from "../middlewares/requireTeam";
import { formRoute } from "./teamCorrections";

// The team's Colonies screens (SYC-209 PR 2.1; spec §2.6, §2.7, §11.2).
// A browser gets a server-drawn page, or a 303 back with a message after a
// form; a caller asking for JSON gets JSON. A bad form gets a 400 naming the
// fields only, never echoing what was typed. Every POST checks Origin, then
// the session and capability (formRoute), then the body.
//
// **Permissions (plan Decision 1A).** Every route here asks requireTeam()/can()
// with NO colony target. That is deliberate: since the roles plan made can()
// strict (SYC-53 PR 0.5), "no target" means island-wide holders only, so a
// guardian gets the 403 on every one of these pages until SYC-209 PR 4.1
// switches targets and filters on together. These pages show team notes and
// every colony, so they must fail closed. Creating a colony also insists on
// an island row (below), since a guardian holds `create_colony`.

const router: IRouter = Router();

const wantsJson = (req: Request) => req.accepts(["html", "json"]) === "json";
const isFormPost = (req: Request) =>
  Boolean(req.is("application/x-www-form-urlencoded"));

const ID_RE = /^\d{1,9}$/;
const QUERY_MAX = 200;

const colonyPage = (id: number, done?: string) =>
  `/api/team/colonies/${id}${done ? `?done=${encodeURIComponent(done)}` : ""}`;

/** Postgres refuses a NUL character in text, so a form carrying one is a bad form. */
const NUL = String.fromCharCode(0);
const noNul = (s: string) => !s.includes(NUL);

/** A browser sends a text box's line breaks as CRLF; store them as LF. */
const lf = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n") : v);

/** An optional text box: "" means none. */
const optionalText = (max: number) =>
  z.preprocess(
    (v) => {
      const s = lf(v);
      return typeof s === "string" && s.trim() === "" ? null : s;
    },
    z.string().trim().max(max).refine(noNul).nullable(),
  );

const nameField = z.preprocess(
  lf,
  z
    .string()
    .trim()
    .min(1)
    .max(COLONY_NAME_MAX)
    .refine(noNul)
    // Nothing left once folded (only invisible characters, say): unreadable,
    // and "taken" by every other such name.
    .refine((s) => foldName(s) !== ""),
);

/** A coordinate box: "" means none; anything else must be a real number. */
const coordinate = (limit: number) =>
  z.preprocess(
    (v) => {
      if (typeof v === "string") {
        const s = v.trim();
        if (s === "") return null;
        // Plain decimal numbers only: Number() would also take "0x10",
        // "0b11" and "1e1".
        return /^[+-]?\d+(\.\d+)?$/.test(s) ? Number(s) : Number.NaN;
      }
      return v;
    },
    z.number().finite().min(-limit).max(limit).nullable(),
  );

const CreateForm = z.object({
  name: nameField,
  guardianName: optionalText(GUARDIAN_NAME_MAX).optional(),
  notes: optionalText(COLONY_NOTES_MAX).optional(),
});

const UpdateForm = z
  .object({
    name: nameField.optional(),
    guardianName: optionalText(GUARDIAN_NAME_MAX).optional(),
    notes: optionalText(COLONY_NOTES_MAX).optional(),
    lat: coordinate(90).optional(),
    lng: coordinate(180).optional(),
  })
  // The centre is a pair: both numbers, or both empty.
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), {
    path: ["lat"],
  })
  .refine((v) => (v.lat === null) === (v.lng === null), { path: ["lat"] });

const fieldsOf = (err: z.ZodError) => [...new Set(err.issues.map((i) => i.path.join(".")))];

const FIELD_WORDS: Record<string, WordKey> = {
  name: "problem.nameEmpty",
  guardianName: "problem.guardianTooLong",
  notes: "problem.notesTooLong",
  lat: "problem.centre",
  lng: "problem.centre",
};

const problemFor = (fields: string[], name: unknown) => {
  const sentences = new Set(
    fields.map((f) => {
      // A name that was there but too long gets its own sentence.
      if (f === "name" && typeof name === "string" && name.trim().length > COLONY_NAME_MAX) {
        return t("problem.nameTooLong");
      }
      const key = Object.hasOwn(FIELD_WORDS, f) ? FIELD_WORDS[f] : undefined;
      return key ? t(key) : t("problem.fields") + ".";
    }),
  );
  return [...sentences].join(" ");
};

function badForm(
  req: Request,
  res: Response,
  err: z.ZodError,
  back: { href: string; label: string },
) {
  const fields = fieldsOf(err);
  if (!isFormPost(req)) {
    return void res.status(400).json({ error: "Invalid request", fields });
  }
  const typedName = (req.body as Record<string, unknown> | undefined)?.["name"];
  res
    .status(400)
    .type("html")
    .send(renderColonyProblem(teamPerson(res).name, problemFor(fields, typedName), back));
}

// ── Reading ────────────────────────────────────────────────────────────────

/** GET /api/team/colonies?q=: every colony, or those that ever had a name like q. */
router.get(
  "/team/colonies",
  requireTeam("view_exact_location"),
  async (req: Request, res: Response) => {
    const person = teamPerson(res);
    setTeamHeaders(res); // before any await, so an error answer carries them too
    // Only a single string is a query; ?q=a&q=b or ?q[x]=1 is no query.
    const q = typeof req.query["q"] === "string" ? req.query["q"].slice(0, QUERY_MAX) : "";
    // A query with a NUL in it can match nothing (Postgres can't hold one),
    // and is never echoed back.
    const unmatchable = q.includes(NUL);
    const shown = unmatchable ? "" : q;
    const colonies = unmatchable ? [] : await listColonies(q);
    if (wantsJson(req)) return void res.json({ query: shown, colonies });
    const done = typeof req.query["done"] === "string" ? req.query["done"] : undefined;
    res.type("html").send(
      renderColoniesPage({
        query: shown,
        searched: unmatchable,
        colonies,
        personName: person.name,
        done,
        canCreate: can(person, "create_colony"),
      }),
    );
  },
);

/** GET /api/team/colonies/:id: one colony. */
router.get(
  "/team/colonies/:id",
  requireTeam("view_exact_location"),
  async (req: Request, res: Response) => {
    const person = teamPerson(res);
    setTeamHeaders(res);
    const raw = String(req.params["id"]);
    const view = ID_RE.test(raw) ? await colonyView(Number(raw)) : null;
    if (!view) {
      if (wantsJson(req)) return void res.status(404).json({ error: "Not found" });
      return void res.status(404).type("html").send(renderNoSuchColony(person.name));
    }
    if (wantsJson(req)) return void res.json(view);
    const done = typeof req.query["done"] === "string" ? req.query["done"] : undefined;
    res.type("html").send(
      renderColonyPage(view, person.name, { may: (c) => can(person, c), done }),
    );
  },
);

// ── Writing ────────────────────────────────────────────────────────────────

const takenResponse = (
  req: Request,
  res: Response,
  holder: { id: number; name: string } | null,
  back: { href: string; label: string },
) => {
  if (!isFormPost(req)) {
    return void res.status(409).json({
      error: "Colony name already taken",
      code: "NAME_TAKEN",
      ...(holder ? { colony: { id: holder.id, name: holder.name } } : {}),
    });
  }
  res
    .status(409)
    .type("html")
    .send(renderNameTaken(teamPerson(res).name, holder, back));
};

/**
 * POST /api/team/colonies: create one (`create_colony`). A cat guardian holds
 * `create_colony` (it creates its own scope, roles spec §6.9), but this
 * route makes a colony with no placement, which is the team's way. So it
 * insists on an island row until PR 1.1's createColonyWithPlacement places a
 * guardian on what she creates.
 */
router.post(
  "/team/colonies",
  ...formRoute("create_colony", { island: true }),
  async (req: Request, res: Response) => {
    const back = { href: "/api/team/colonies", label: t("problem.backToColonies") };
    const parsed = CreateForm.safeParse(req.body ?? {});
    if (!parsed.success) return badForm(req, res, parsed.error, back);
    const person = teamPerson(res);
    const outcome = await createColony(person.id, {
      name: parsed.data.name,
      guardianName: parsed.data.guardianName ?? null,
      notes: parsed.data.notes ?? null,
    });
    if (outcome.kind === "taken") return takenResponse(req, res, outcome.holder, back);
    if (isFormPost(req)) return void res.redirect(303, colonyPage(outcome.id, "created"));
    res.status(201).json({ id: outcome.id });
  },
);

/**
 * POST /api/team/colonies/:id: change a colony. The guardian's name, notes and
 * centre need `edit_colony`; the name needs `rename_colony`. Only what
 * differs from what is stored is written, one history row each.
 */
router.post(
  "/team/colonies/:id",
  ...formRoute("edit_colony"),
  async (req: Request, res: Response) => {
    const person = teamPerson(res);
    const raw = String(req.params["id"]);
    if (!ID_RE.test(raw)) return notFound(req, res);
    const id = Number(raw);
    const back = { href: colonyPage(id), label: t("problem.backToColony") };
    const parsed = UpdateForm.safeParse(req.body ?? {});
    if (!parsed.success) return badForm(req, res, parsed.error, back);

    const { name, guardianName, notes, lat, lng } = parsed.data;
    const changes: ColonyChanges = {
      ...(name !== undefined ? { name } : {}),
      ...(guardianName !== undefined ? { guardianName } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(lat !== undefined && lng !== undefined
        ? { centre: lat === null || lng === null ? null : { lat, lng } }
        : {}),
    };
    const outcome = await updateColony(
      person.id,
      id,
      changes,
      (needed) =>
        (!needed.rename || can(person, "rename_colony")) &&
        (!needed.edit || can(person, "edit_colony")),
    );
    switch (outcome.kind) {
      case "missing":
        return notFound(req, res);
      case "forbidden":
        req.log.info({ reason: "missing_capability" }, "colony change refused");
        return refuseSignedIn(req, res);
      case "taken":
        return takenResponse(req, res, outcome.holder, back);
      case "unchanged":
        if (isFormPost(req)) return void res.redirect(303, colonyPage(id, "unchanged"));
        return void res.json({ changed: 0 });
      case "saved":
        if (isFormPost(req)) return void res.redirect(303, colonyPage(id, "saved"));
        return void res.json({ changed: outcome.events });
    }
  },
);

function notFound(req: Request, res: Response) {
  if (!isFormPost(req)) return void res.status(404).json({ error: "Not found" });
  res.status(404).type("html").send(renderNoSuchColony(teamPerson(res).name));
}

export default router;
