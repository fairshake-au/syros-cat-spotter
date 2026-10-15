import { Router, type IRouter, type Request, type Response } from "express";
import {
  colonyNames,
  db,
  isPersonId,
  peopleNames,
  peopleScreen,
  personEventsTable,
  type ScreenPerson,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import {
  ActionRefused,
  bringBack,
  changeRoles,
  invite,
  markLeft,
  resend,
  signOutEverywhere,
  withdraw,
} from "../lib/people/actions";
import {
  buildView,
  idsMentioned,
  endDateOf,
  parsePlacements,
  type Lookups,
  type PersonView,
} from "../lib/people/screen";
import { listColonies } from "../lib/teamColonies";
import {
  renderBringBackPage,
  renderNoSuchPerson,
  renderPeoplePage,
  renderPeopleProblem,
  renderRolesPage,
  type ColonyOption,
  type Done,
  type Prefill,
} from "../lib/teamPages/peoplePages";
import { CATALOGUE } from "../lib/capabilities";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { formRoute } from "./teamCorrections";

// SYC-53 PR 1.2: the People screen (SYC-104; roles-and-invites.md §8.1,
// §8.2, §9). Every route needs `manage_people` (management only); every POST
// checks the Origin first (formRoute). Every change goes through
// lib/people/actions.ts with the signed-in manager as the actor and the
// request's address for the limits: this file never touches the database to
// change anything. A refusal is drawn in plain English with a way back and
// echoes nothing that was typed; a successful form 303s back with fixed keys
// and ids only (names are looked up from the records when the page is drawn).

const router: IRouter = Router();

const PEOPLE = "/api/team/people";
const isFormPost = (req: Request) => Boolean(req.is("application/x-www-form-urlencoded"));
const bodyOf = (req: Request): Record<string, unknown> =>
  req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};

// ── Reading ────────────────────────────────────────────────────────────────

async function loadAll(selfId: string) {
  const rows = await peopleScreen();
  const { personIds, colonyIds } = idsMentioned(rows);
  const [people, colonies] = await Promise.all([
    peopleNames(db, [...personIds, ...rows.map((r) => r.id)]),
    colonyNames(db, colonyIds),
  ]);
  const lk: Lookups = { people, colonies };
  const now = new Date();
  return { rows, views: rows.map((r) => buildView(r, now, lk, selfId)), now };
}

const colonyOptions = async (): Promise<ColonyOption[]> =>
  (await listColonies()).map((c) => ({ id: c.id, name: c.name }));

const WORKSPACE_ROLES: readonly string[] = CATALOGUE.use_workspace.roles;
const DAY = 24 * 60 * 60 * 1000;

const ids = (raw: unknown): number[] =>
  typeof raw === "string"
    ? [...new Set(raw.split(",").filter((s) => /^[1-9]\d{0,8}$/.test(s)).map(Number))].slice(0, 20)
    : [];

/** What the banner after a change says, from the fixed keys and ids in the query, names from the records. */
async function doneFrom(req: Request): Promise<Done | null> {
  const q = req.query;
  const kind = q["done"];
  const known = ["invited", "resent", "withdrawn", "roles", "left", "signedOut", "broughtBack", "nothing"];
  if (typeof kind !== "string" || !known.includes(kind)) return null;
  const pid = typeof q["p"] === "string" && isPersonId(q["p"]) ? q["p"] : null;
  const name = pid ? (await peopleNames(db, [pid])).get(pid) : undefined;
  const colonyIds = ids(q["c"]);
  const names = await colonyNames(db, colonyIds);
  const n = typeof q["n"] === "string" && /^\d{1,3}$/.test(q["n"]) ? Number(q["n"]) : 0;
  return {
    kind: kind as Done["kind"],
    name: name ? [...name].slice(0, 60).join("") : undefined,
    inEnglish: q["en"] === "1",
    workspace: q["w"] === "1",
    withdrawn: n,
    rename: colonyIds.filter((c) => names.has(c)).map((c) => ({ id: c, name: names.get(c)! })),
  };
}

/** GET /api/team/people: the list, or (?tab=left) the people who have left. */
router.get("/team/people", requireTeam("manage_people"), async (req: Request, res: Response) => {
  setTeamHeaders(res);
  const me = teamPerson(res);
  const { views, now } = await loadAll(me.id);
  const tab: "left" | "people" = req.query["tab"] === "left" ? "left" : "people";
  const week = now.getTime() - 7 * DAY;
  const recent = views.filter((v) => v.state === "joined" && v.joinedAt && v.joinedAt.getTime() > week);
  const body = {
    tab,
    people: views.filter((v) => v.state !== "left"),
    left: views.filter((v) => v.state === "left"),
    recent,
  };
  if (req.accepts(["html", "json"]) === "json") {
    return void res.json({
      tab,
      people: body.people.map(jsonOf),
      left: body.left.map(jsonOf),
      joinedLast7Days: recent.map(jsonOf),
    });
  }
  res.type("html").send(
    renderPeoplePage({
      viewer: me.name,
      ...body,
      colonies: await colonyOptions(),
      done: await doneFrom(req),
    }),
  );
});

const jsonOf = (v: PersonView) => ({
  id: v.id,
  name: v.name,
  state: v.state,
  roles: v.roles,
  history: v.history.map((h) => h.text),
});

async function viewOf(res: Response, id: string): Promise<{ view: PersonView; row: ScreenPerson } | null> {
  if (!isPersonId(id)) return null;
  const { rows, views } = await loadAll(teamPerson(res).id);
  const i = rows.findIndex((r) => r.id === id);
  return i < 0 ? null : { view: views[i]!, row: rows[i]! };
}

/** GET /api/team/people/:id/roles: the form to change one person's roles and colonies. */
router.get("/team/people/:id/roles", requireTeam("manage_people"), async (req: Request, res: Response) => {
  setTeamHeaders(res);
  const me = teamPerson(res);
  const found = await viewOf(res, String(req.params["id"]));
  if (!found) return void res.status(404).type("html").send(renderNoSuchPerson(me.name));
  const { view, row } = found;
  if (view.state === "left" || view.isSelf) {
    return void res
      .status(409)
      .type("html")
      .send(
        renderPeopleProblem(
          me.name,
          view.isSelf
            ? "You can't change your own roles here."
            : "That person has left. Bring them back instead.",
        ),
      );
  }
  const inForce = row.placements.filter((p) => p.inForce);
  const pre: Prefill = {
    roles: [...new Set(inForce.map((p) => p.role))],
    colonies: new Map(
      inForce
        .filter((p) => p.role === "guardian" && p.colonyId !== null)
        .map((p) => [p.colonyId!, { endDate: p.expiresAt ? endDateOf(p.expiresAt) : null, relationship: p.relationship }]),
    ),
  };
  res.type("html").send(renderRolesPage({ viewer: me.name, person: view, colonies: await colonyOptions(), pre }));
});

/** GET /api/team/people/:id/bring-back: choose roles afresh for someone who left. */
router.get("/team/people/:id/bring-back", requireTeam("manage_people"), async (req: Request, res: Response) => {
  setTeamHeaders(res);
  const me = teamPerson(res);
  const found = await viewOf(res, String(req.params["id"]));
  if (!found) return void res.status(404).type("html").send(renderNoSuchPerson(me.name));
  if (found.view.state !== "left" || found.view.anonymised) {
    return void res
      .status(409)
      .type("html")
      .send(
        renderPeopleProblem(
          me.name,
          found.view.anonymised ? "That was a withdrawn invitation. Invite the person afresh instead." : "They haven't left.",
        ),
      );
  }
  res.type("html").send(renderBringBackPage({ viewer: me.name, person: found.view, colonies: await colonyOptions() }));
});

// ── Writing ────────────────────────────────────────────────────────────────

const location = (done: string, extra: Record<string, string | number | undefined> = {}) => {
  const q = new URLSearchParams({ done });
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== "") q.set(k, String(v));
  return `${PEOPLE}?${q.toString()}`;
};

class Bad extends Error {}

/**
 * Runs one change and answers it: a form gets a 303 back to the list (a
 * banner built from ids), anything else gets JSON. A refusal from the
 * actions layer is drawn in its own plain words and changes nothing.
 */
async function answer(req: Request, res: Response, change: () => Promise<string>, back = { href: PEOPLE, label: "Back to People" }) {
  const me = teamPerson(res);
  try {
    const to = await change();
    if (isFormPost(req)) return void res.redirect(303, to);
    return void res.json({ ok: true, location: to });
  } catch (err) {
    if (err instanceof ActionRefused || err instanceof Bad) {
      const status = err instanceof ActionRefused ? { forbidden: 403, limited: 429, refused: 409 }[err.reason] : 400;
      req.log.info({ reason: err instanceof ActionRefused ? err.reason : "bad_form" }, "people change refused");
      if (!isFormPost(req)) return void res.status(status).json({ error: err.message });
      return void res.status(status).type("html").send(renderPeopleProblem(me.name, err.message, back));
    }
    throw err;
  }
}

const MYSELF = "You can't do that to yourself here. Use the buttons on your own page.";

function personIdOf(req: Request, res: Response): string | null {
  const id = String(req.params["id"]);
  if (isPersonId(id)) return id;
  res.status(404);
  if (isFormPost(req)) res.type("html").send(renderNoSuchPerson(teamPerson(res).name));
  else res.json({ error: "Not found" });
  return null;
}

/** POST /api/team/people/invite: invite someone (the address is typed once). */
router.post("/team/people/invite", ...formRoute("manage_people"), async (req: Request, res: Response) => {
  const me = teamPerson(res);
  const b = bodyOf(req);
  await answer(req, res, async () => {
    const colonies = await colonyOptions();
    const form = parsePlacements(b, new Set(colonies.map((c) => c.id)));
    if (!form.ok) throw new Bad(form.message);
    const language = typeof b["language"] === "string" ? b["language"] : "en";
    const r = await invite(
      me,
      {
        email: typeof b["email"] === "string" ? b["email"] : "",
        name: typeof b["name"] === "string" ? b["name"] : "",
        placements: form.placements,
        language,
      },
      { ip: req.ip },
    );
    return location("invited", { p: r.personId, en: r.languageUsed !== language ? 1 : undefined });
  });
});

/** POST /api/team/people/:id/resend */
router.post("/team/people/:id/resend", ...formRoute("manage_people"), async (req: Request, res: Response) => {
  const id = personIdOf(req, res);
  if (!id) return;
  await answer(req, res, async () => {
    await resend(teamPerson(res), id, { ip: req.ip });
    return location("resent", { p: id });
  });
});

/** POST /api/team/people/:id/withdraw */
router.post("/team/people/:id/withdraw", ...formRoute("manage_people"), async (req: Request, res: Response) => {
  const id = personIdOf(req, res);
  if (!id) return;
  await answer(req, res, async () => {
    const r = await withdraw(teamPerson(res), id);
    return location(r.withdrawn ? "withdrawn" : "nothing", { p: id });
  });
});

/** POST /api/team/people/:id/roles: change roles and colonies (never your own). */
router.post("/team/people/:id/roles", ...formRoute("manage_people"), async (req: Request, res: Response) => {
  const id = personIdOf(req, res);
  if (!id) return;
  const me = teamPerson(res);
  await answer(
    req,
    res,
    async () => {
      if (id === me.id) throw new ActionRefused("refused", "You can't change your own roles. Nothing was changed.");
      const colonies = await colonyOptions();
      const form = parsePlacements(bodyOf(req), new Set(colonies.map((c) => c.id)));
      if (!form.ok) throw new Bad(form.message);
      const r = await changeRoles(me, id, form.placements);
      const guardian = (labels: string[]) =>
        labels.filter((l) => l.startsWith("guardian:")).map((l) => Number(l.split(":")[1]));
      const kept = new Set(guardian(r.after));
      const lost = guardian(r.before).filter((c) => !kept.has(c));
      return location("roles", { p: id, c: lost.join(",") });
    },
    { href: `${PEOPLE}/${id}/roles`, label: "Back to the form" },
  );
});

/** POST /api/team/people/:id/left: mark as left (never yourself). */
router.post("/team/people/:id/left", ...formRoute("manage_people"), async (req: Request, res: Response) => {
  const id = personIdOf(req, res);
  if (!id) return;
  const me = teamPerson(res);
  await answer(req, res, async () => {
    if (id === me.id) throw new ActionRefused("refused", "You can't mark yourself as left here. Use Stop helping on your own page.");
    const r = await markLeft(me, id);
    // What they held when they left is in the `left` event the change just
    // wrote: the workspace reminder and the colonies to offer renaming.
    const [ev] = await db
      .select({ detail: personEventsTable.detail })
      .from(personEventsTable)
      .where(and(eq(personEventsTable.personId, id), eq(personEventsTable.kind, "left")))
      .orderBy(desc(personEventsTable.id))
      .limit(1);
    const d = (ev?.detail ?? {}) as { roles?: unknown; colonyIds?: unknown };
    const roles = Array.isArray(d.roles) ? d.roles.filter((x): x is string => typeof x === "string") : [];
    const held = Array.isArray(d.colonyIds) ? d.colonyIds.filter((x): x is number => typeof x === "number") : [];
    return location("left", {
      p: id,
      w: roles.some((x) => WORKSPACE_ROLES.includes(x)) ? 1 : undefined,
      n: r.withdrawnInvitations || undefined,
      c: held.join(","),
    });
  });
});

/** POST /api/team/people/:id/sign-out: sign someone out everywhere (never yourself here). */
router.post("/team/people/:id/sign-out", ...formRoute("manage_people"), async (req: Request, res: Response) => {
  const id = personIdOf(req, res);
  if (!id) return;
  const me = teamPerson(res);
  await answer(req, res, async () => {
    if (id === me.id) throw new ActionRefused("refused", MYSELF);
    await signOutEverywhere(me, id);
    return location("signedOut", { p: id });
  });
});

/** POST /api/team/people/:id/bring-back: roles chosen afresh, a new invitation. */
router.post("/team/people/:id/bring-back", ...formRoute("manage_people"), async (req: Request, res: Response) => {
  const id = personIdOf(req, res);
  if (!id) return;
  const b = bodyOf(req);
  await answer(
    req,
    res,
    async () => {
      const colonies = await colonyOptions();
      const form = parsePlacements(b, new Set(colonies.map((c) => c.id)));
      if (!form.ok) throw new Bad(form.message);
      const language = typeof b["language"] === "string" ? b["language"] : "en";
      const r = await bringBack(teamPerson(res), id, form.placements, language, { ip: req.ip });
      return location("broughtBack", { p: id, en: r.languageUsed !== language ? 1 : undefined });
    },
    { href: `${PEOPLE}/${id}/bring-back`, label: "Back to the form" },
  );
});

export default router;
