import type { NextFunction, Request, RequestHandler, Response } from "express";
import { TEAM_ORIGIN } from "../lib/teamAuth/config";
import { requireOrigin, setTeamHeaders } from "../lib/teamAuth/refuse";
import {
  isIslandWide,
  pageLangFor,
  seesAny,
  visibleColonyIds,
  type Visible,
} from "../lib/guardianView";
import { refuseSignedIn, requireTeam, teamPerson } from "./requireTeam";

// The door to the Colonies and Feeding sites pages that a cat guardian may
// read (SYC-209 PR 4.1; spec §7.3). She enters when `visibleColonyIds`
// names at least one colony; every query behind the door is then filtered by
// that same set, in SQL. Never `canSomewhere`, which is the sign-in door's
// alone (a roles test enforces it).
//
// Someone who may enter the dashboard but sees no colony (no
// `view_exact_location` anywhere) gets the quiet 403, as any other refused
// page. A cat guardian who holds only `create_colony`, with no colony yet,
// can't exist today: a guardian with no placement holds nothing, and gets the
// "access has ended" page at the dashboard door. Her create form arrives with
// PR 4.2 (createColonyWithPlacement).

function enterIfSees(req: Request, res: Response, next: NextFunction): void {
  if (!seesAny(visibleColonyIds(teamPerson(res)))) {
    req.log.info({ reason: "sees_no_colony" }, "team request refused");
    return refuseSignedIn(req, res);
  }
  next();
}

/** A page a cat guardian may read: the dashboard door, then "sees some colony". */
export const requireSeeing = (): RequestHandler[] => [requireTeam(), enterIfSees];

/** The same, for a form that writes nothing (the map's zoom, pan and area buttons). */
export const seeingFormRoute = (): RequestHandler[] => [
  requireOrigin(TEAM_ORIGIN),
  requireTeam(),
  enterIfSees,
  (_req: Request, res: Response, next: NextFunction) => {
    setTeamHeaders(res);
    next();
  },
];

/** Who a Colonies or Feeding sites page is drawn for. */
export interface PageViewer {
  personName: string;
  visible: Visible;
  /** True for the team. */
  island: boolean;
  /** A cat guardian's own language; undefined (English) for the team (spec Decision 9). */
  lang: string | undefined;
}

export function pageViewer(res: Response): PageViewer {
  const person = teamPerson(res);
  const island = isIslandWide(person);
  return {
    personName: person.name,
    visible: visibleColonyIds(person),
    island,
    lang: island ? undefined : pageLangFor(person),
  };
}
