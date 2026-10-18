import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { can, type CapabilityTarget } from "../lib/capabilities";
import { ObservationRefused } from "../lib/observations";
import { ADD_CATS_MAX, colonyRef, placeCats, searchCatsToAdd } from "../lib/colonyCats";
import { foldName, PeopleError } from "@workspace/db";
import {
  COLONY_NAME_MAX,
  COLONY_NOTES_MAX,
  GUARDIAN_NAME_MAX,
  colonyView,
  createColonyAs,
  listColonies,
  updateColony,
  type ColonyChanges,
} from "../lib/teamColonies";
import {
  renderAddCatsPage,
  renderColoniesPage,
  renderColonyPage,
  renderColonyProblem,
  renderNameTaken,
  renderNoSuchColony,
} from "../lib/teamPages/colonyPages";
import { t, type WordKey } from "../lib/teamPages/words";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { refuseSignedIn, requireTeam, teamPerson } from "../middlewares/requireTeam";
import { pageViewer, requireColoniesList, requireSeeing } from "../middlewares/requireSeeing";
import { covers } from "../lib/guardianView";
import { movedAwayNotices } from "../lib/movedAway";
import { recentGuardianChanges } from "../lib/recentGuardianChanges";
import { formRoute } from "./teamCorrections";
import { coordinate, fieldsOf, lf, noNul, optionalText } from "../lib/teamForms";

// The team's Colonies screens (SYC-209 PR 2.1; spec §2.6, §2.7, §11.2).
// A browser gets a server-drawn page, or a 303 back with a message after a
// form; a caller asking for JSON gets JSON. A bad form gets a 400 naming the
// fields only, never echoing what was typed. Every POST checks Origin, then
// the session and capability (formRoute), then the body.
//
// **Permissions (PR 4.1; spec §7.3).** The reading pages (the list and its
// search, one colony, and the "Add cats" search) let in anyone who sees some
// colony (`requireSeeing`), and every query behind them is filtered by
// `visibleColonyIds` in SQL: a cat guardian sees her own colonies and nothing
// else; another colony answers exactly what a number that was never a
// colony answers. Since PR 4.2 a cat guardian creates colonies (hers at
// once), edits her own, and puts cats in or takes them out; each write is
// checked against the colony read from the record. Renaming stays island-only.

const router: IRouter = Router();

const wantsJson = (req: Request) => req.accepts(["html", "json"]) === "json";
const isFormPost = (req: Request) =>
  Boolean(req.is("application/x-www-form-urlencoded"));

const ID_RE = /^\d{1,9}$/;
const QUERY_MAX = 200;

const colonyPage = (id: number, done?: string) =>
  `/api/team/colonies/${id}${done ? `?done=${encodeURIComponent(done)}` : ""}`;

/** The NUL character, which Postgres cannot hold in text. */
const NUL = String.fromCharCode(0);

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

const FIELD_WORDS: Record<string, WordKey> = {
  name: "problem.nameEmpty",
  guardianName: "problem.guardianTooLong",
  notes: "problem.notesTooLong",
  lat: "problem.centre",
  lng: "problem.centre",
};

const problemFor = (fields: string[], name: unknown, lang?: string) => {
  const sentences = new Set(
    fields.map((f) => {
      // A name that was there but too long gets its own sentence.
      if (f === "name" && typeof name === "string" && name.trim().length > COLONY_NAME_MAX) {
        return t("problem.nameTooLong", lang);
      }
      const key = Object.hasOwn(FIELD_WORDS, f) ? FIELD_WORDS[f] : undefined;
      return key ? t(key, lang) : t("problem.fields", lang) + ".";
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
  const v = pageViewer(res);
  res
    .status(400)
    .type("html")
    .send(renderColonyProblem(v.personName, problemFor(fields, typedName, v.lang), back, v));
}

/**
 * Where a one-colony write is checked (SYC-209 PR 4.2): that colony. A cat
 * guardian passes for her own; another colony and a number that is no colony
 * get the same quiet 403. Anything that isn't a colony number has no colony,
 * so only the team passes (and then gets the usual 404).
 */
async function thisColony(req: Request): Promise<CapabilityTarget> {
  const raw = String(req.params["id"]);
  return { colonyId: ID_RE.test(raw) ? Number(raw) : null };
}

// ── Reading ────────────────────────────────────────────────────────────────

/** GET /api/team/colonies?q=: every colony, or those that ever had a name like q. */
router.get(
  "/team/colonies",
  // Its own door: a cat guardian with no colony yet reaches it too (SYC-439).
  ...requireColoniesList(),
  async (req: Request, res: Response) => {
    const person = teamPerson(res);
    const v = pageViewer(res);
    setTeamHeaders(res); // before any await, so an error answer carries them too
    // Only a single string is a query; ?q=a&q=b or ?q[x]=1 is no query.
    const q = typeof req.query["q"] === "string" ? req.query["q"].slice(0, QUERY_MAX) : "";
    // A query with a NUL in it can match nothing (Postgres can't hold one),
    // and is never echoed back.
    const unmatchable = q.includes(NUL);
    const shown = unmatchable ? "" : q;
    const colonies = unmatchable ? [] : await listColonies(v.visible, q);
    // "Recent changes by cat guardians" (PR 4.3): the team's alone
    // (`view_guardian_changes`, island-only). A cat guardian gets neither the
    // list nor the field.
    const recentChanges = can(person, "view_guardian_changes")
      ? await recentGuardianChanges()
      : undefined;
    if (wantsJson(req)) {
      return void res.json({ query: shown, colonies, ...(recentChanges ? { recentChanges } : {}) });
    }
    const done = typeof req.query["done"] === "string" ? req.query["done"] : undefined;
    res.type("html").send(
      renderColoniesPage({
        query: shown,
        searched: unmatchable,
        colonies,
        personName: v.personName,
        lang: v.lang,
        island: v.island,
        done,
        // A cat guardian creates colonies too (spec §2.7; SYC-209 PR 4.2).
        canCreate: can(person, "create_colony"),
        recentChanges,
      }),
    );
  },
);

/**
 * GET /api/team/guardian-changes: the same list on its own, as JSON
 * (`view_guardian_changes`, island-only, so a cat guardian gets the 403). A
 * browser is sent to the Colonies page, where the list is drawn.
 */
router.get(
  "/team/guardian-changes",
  requireTeam("view_guardian_changes"),
  async (req: Request, res: Response) => {
    setTeamHeaders(res);
    if (!wantsJson(req)) return void res.redirect(303, "/api/team/colonies#recent-changes-title");
    res.json({ changes: await recentGuardianChanges() });
  },
);

/** GET /api/team/colonies/:id: one colony. */
router.get(
  "/team/colonies/:id",
  ...requireSeeing(),
  async (req: Request, res: Response) => {
    const person = teamPerson(res);
    const v = pageViewer(res);
    setTeamHeaders(res);
    const raw = String(req.params["id"]);
    // Filtered in the query: another colony is simply not found.
    const view = ID_RE.test(raw) ? await colonyView(v.visible, Number(raw)) : null;
    if (!view) return notFoundPage(req, res);
    if (wantsJson(req)) return void res.json(view);
    const done = typeof req.query["done"] === "string" ? req.query["done"] : undefined;
    res.type("html").send(
      renderColonyPage(view, v.personName, {
        // Asked against THIS colony, from the record (SYC-209 PR 4.2): a cat
        // guardian edits her own colony and its cats; renaming stays island-only.
        may: (c) => can(person, c, { colonyId: view.id }),
        done,
        // Her cats someone else moved elsewhere (spec Decision 14); nothing for the team.
        movedAway: (await movedAwayNotices(person)).filter((n) => n.fromColonyId === view.id),
        lang: v.lang,
        island: v.island,
      }),
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
  // Only a colony this person sees is named or linked; anyone else reads
  // "That name can't be used." (spec §7.3).
  const v = pageViewer(res);
  const shown = holder && covers(v.visible, holder.id) ? holder : null;
  if (!isFormPost(req)) {
    return void res.status(409).json({
      error: "Colony name already taken",
      code: "NAME_TAKEN",
      ...(shown ? { colony: { id: shown.id, name: shown.name } } : {}),
    });
  }
  res
    .status(409)
    .type("html")
    .send(renderNameTaken(v.personName, shown, back, v));
};

/**
 * POST /api/team/colonies: create one (`create_colony`). A cat guardian
 * creates colonies too (spec §2.7; SYC-209 PR 4.2): the colony and her
 * placement on it are one transaction (`createColonyAs`), so it is hers at
 * once. Her form has a name and notes only: her own name is the colony's
 * guardian, whatever the form says.
 */
router.post(
  "/team/colonies",
  // A cat guardian with no colony yet creates her first one here (SYC-439).
  ...formRoute("create_colony", { starting: true }),
  async (req: Request, res: Response) => {
    const v = pageViewer(res);
    const back = { href: "/api/team/colonies", label: t("problem.backToColonies", v.lang) };
    const parsed = CreateForm.safeParse(req.body ?? {});
    if (!parsed.success) return badForm(req, res, parsed.error, back);
    const person = teamPerson(res);
    let outcome;
    try {
      outcome = await createColonyAs(person, {
        name: parsed.data.name,
        guardianName: v.island ? (parsed.data.guardianName ?? null) : person.name,
        notes: parsed.data.notes ?? null,
      });
    } catch (err) {
      // Someone who holds `create_colony` but is neither the team nor a cat
      // guardian (a vet, say): roles PR 1.1 refuses them, and so do we.
      if (err instanceof PeopleError) {
        req.log.info({ reason: "missing_capability" }, "colony create refused");
        return refuseSignedIn(req, res);
      }
      throw err;
    }
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
  ...formRoute("edit_colony", { target: thisColony }),
  async (req: Request, res: Response) => {
    const person = teamPerson(res);
    const raw = String(req.params["id"]);
    if (!ID_RE.test(raw)) return notFound(req, res);
    const id = Number(raw);
    const back = { href: colonyPage(id), label: t("problem.backToColony", pageViewer(res).lang) };
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
        (!needed.edit || can(person, "edit_colony", { colonyId: id })),
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

// ── Adding cats ────────────────────────────────────────────────────────────

/** The ticked cats: one id or several, as the form sends them, or a JSON list. */
const AddCatsForm = z.object({
  catIds: z.preprocess(
    (v) => (typeof v === "string" || typeof v === "number" ? [v] : v),
    z
      .array(
        z.union([
          z.string().regex(ID_RE),
          z.number().int().min(1).max(999_999_999),
        ]),
      )
      .min(1)
      .max(ADD_CATS_MAX),
  ),
});

/**
 * The page for finding cats to add (`assign_cat_to_colony`, checked against
 * the colony READ FROM THE RECORD). A cat guardian may search for her own
 * colony; a cat outside her colonies shows only what the public sees, and
 * its colony as "In another colony". Adding is checked against this colony (PR 4.2).
 */
router.get(
  "/team/colonies/:id/cats",
  ...requireSeeing(),
  async (req: Request, res: Response) => {
    const person = teamPerson(res);
    const v = pageViewer(res);
    setTeamHeaders(res);
    const raw = String(req.params["id"]);
    // Filtered in the query: another colony is simply not found.
    const colony = ID_RE.test(raw) ? await colonyRef(v.visible, Number(raw)) : null;
    if (!colony) return notFoundPage(req, res);
    if (!can(person, "assign_cat_to_colony", { colonyId: colony.id })) {
      req.log.info({ reason: "missing_capability" }, "add cats refused");
      return refuseSignedIn(req, res);
    }
    const q = typeof req.query["q"] === "string" ? req.query["q"].slice(0, QUERY_MAX) : "";
    // A NUL can match nothing (Postgres can't hold one) and is never echoed.
    const unmatchable = q.includes(NUL);
    const results = unmatchable ? [] : await searchCatsToAdd(v.visible, q);
    if (wantsJson(req)) return void res.json({ colony, query: unmatchable ? "" : q, results });
    res
      .type("html")
      .send(
        renderAddCatsPage({
          colony,
          query: unmatchable ? "" : q,
          results,
          personName: v.personName,
          lang: v.lang,
          island: v.island,
          mayAdd: can(person, "assign_cat_to_colony", { colonyId: colony.id }),
        }),
      );
  },
);

/**
 * Puts the ticked cats in this colony, one signed statement each, all or
 * none (`assign_cat_to_colony`, no target).
 */
router.post(
  "/team/colonies/:id/cats",
  ...formRoute("assign_cat_to_colony", { target: thisColony }),
  async (req: Request, res: Response) => {
    const person = teamPerson(res);
    const raw = String(req.params["id"]);
    if (!ID_RE.test(raw)) return notFound(req, res);
    const id = Number(raw);
    const back = { href: `${colonyPage(id)}/cats`, label: t("problem.backToAdd", pageViewer(res).lang) };
    const parsed = AddCatsForm.safeParse(req.body ?? {});
    if (!parsed.success) {
      if (!isFormPost(req)) {
        return void res
          .status(400)
          .json({ error: "Invalid request", fields: fieldsOf(parsed.error) });
      }
      return void res
        .status(400)
        .type("html")
        .send(renderColonyProblem(person.name, t("problem.pickCats", pageViewer(res).lang), back, pageViewer(res)));
    }
    try {
      const out = await placeCats(person, id, parsed.data.catIds.map(Number));
      switch (out.kind) {
        case "no_colony":
          return notFound(req, res);
        case "no_cat":
          if (!isFormPost(req)) {
            return void res.status(400).json({ error: "Invalid request", fields: ["catIds"] });
          }
          return void res
            .status(400)
            .type("html")
            .send(renderColonyProblem(person.name, t("problem.noSuchCat", pageViewer(res).lang), back, pageViewer(res)));
        case "done":
          if (isFormPost(req)) {
            return void res.redirect(
              303,
              colonyPage(id, out.written.length > 0 ? "added" : "nothingNew"),
            );
          }
          return void res
            .status(out.written.length > 0 ? 201 : 200)
            .json({ added: out.written.length, skipped: out.skipped, statementIds: out.written });
      }
    } catch (err) {
      if (err instanceof ObservationRefused && err.code === "NOT_AUTHORISED") {
        req.log.info({ reason: "missing_capability" }, "colony change refused");
        return refuseSignedIn(req, res);
      }
      throw err;
    }
  },
);

function notFound(req: Request, res: Response) {
  if (!isFormPost(req)) return void res.status(404).json({ error: "Not found" });
  const v = pageViewer(res);
  res.status(404).type("html").send(renderNoSuchColony(v.personName, v));
}

/**
 * "No such colony" for a page: the one answer for a number that was never a
 * colony AND, for a cat guardian, for another colony (spec §7.3).
 */
function notFoundPage(req: Request, res: Response) {
  if (wantsJson(req)) return void res.status(404).json({ error: "Not found" });
  const v = pageViewer(res);
  res.status(404).type("html").send(renderNoSuchColony(v.personName, v));
}

export default router;
