import type { NextFunction, Request, RequestHandler, Response } from "express";
import { TEAM_ORIGIN } from "../lib/teamAuth/config";
import { requireOrigin, setTeamHeaders } from "../lib/teamAuth/refuse";
import { holdsStartRow, type CapabilityHolder } from "../lib/capabilities";
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
// that same set, in SQL. Never the "for any colony?" check, which is the sign-in door's
// alone (a roles test enforces it).
//
// Someone who may enter the dashboard but sees no colony (no
// `view_exact_location` anywhere) gets the quiet 403, as any other refused
// page. A cat guardian with no colony yet (SYC-439) is refused here too: only
// the Colonies list (requireColoniesList, below) and its create form let her
// in.

function enterIfSees(req: Request, res: Response, next: NextFunction): void {
  if (!seesAny(visibleColonyIds(teamPerson(res)))) {
    req.log.info({ reason: "sees_no_colony" }, "team request refused");
    return refuseSignedIn(req, res);
  }
  next();
}

/** A page a cat guardian may read: the dashboard door, then "sees some colony". */
export const requireSeeing = (): RequestHandler[] => [requireTeam(), enterIfSees];

/**
 * The Colonies LIST's own door (SYC-439; first-colony spec §4.3): "sees some
 * colony, or holds a 'no colony yet' row", so a cat guardian with no colony
 * reaches her empty list and the create form. Used ONLY by GET
 * /team/colonies; the shared door above is unchanged, so the other Colonies
 * and Feeding sites pages still refuse her. Every query behind it is still
 * filtered by visibleColonyIds, which for her is nothing.
 */
export const requireColoniesList = (): RequestHandler[] => [
  requireTeam(undefined, { openToStarter: true }),
  (req: Request, res: Response, next: NextFunction) => {
    if (!opensColoniesList(teamPerson(res))) {
      req.log.info({ reason: "sees_no_colony" }, "team request refused");
      return refuseSignedIn(req, res);
    }
    next();
  },
];

/**
 * May this person open the Colonies list? Sees some colony, or holds a "no
 * colony yet" row. A second line behind the door (which already refuses
 * someone who holds nothing), so it is tested on its own.
 */
export function opensColoniesList(person: CapabilityHolder): boolean {
  return seesAny(visibleColonyIds(person)) || holdsStartRow(person);
}

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
