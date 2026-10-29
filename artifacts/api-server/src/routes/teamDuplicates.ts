import { Router, type IRouter, type Request, type Response } from "express";
import { loadDuplicateCards } from "../lib/duplicateCards";
import { checkedItsNew, decidePair, NOTE_MAX } from "../lib/duplicateDecide";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { DUPLICATES_PATH, renderDuplicatesPage } from "../lib/teamPages/duplicatesPage";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { formRoute } from "./teamCorrections";

// The Possible duplicates list and its two answers (which-cat-is-which.md
// §3.3, §9.6; SYC-59 PR 5.1). `review_duplicates` (island, TEAM): a cat
// guardian gets the 403. "Same cat, merge…" is a link to the merge screen
// (routes/teamMerges.ts), which writes its own `merged` decision.

const router: IRouter = Router();

const NUMBER = /^\d{1,9}$/;
const one = (v: unknown): string | undefined => (typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : undefined);
const numberOf = (v: unknown): number | undefined => {
  const s = one(v);
  return s !== undefined && NUMBER.test(s) ? Number(s) : undefined;
};

async function draw(res: Response, status: number, extra: { done?: string; problem?: string } = {}) {
  const person = teamPerson(res);
  setTeamHeaders(res);
  const { cards, total } = await loadDuplicateCards();
  res.status(status).type("html").send(renderDuplicatesPage(cards, total, { personName: person.name, ...extra }));
}

/** GET /api/team/duplicates: the list. */
router.get("/team/duplicates", requireTeam("review_duplicates"), async (req: Request, res: Response) => {
  await draw(res, 200, { done: one(req.query["done"]) });
});

/** POST /api/team/duplicates/decide: "Different cats" or "Not sure yet", with the pair as the page drew it. */
router.post("/team/duplicates/decide", ...formRoute("review_duplicates"), async (req: Request, res: Response) => {
  const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<string, unknown>;
  const a = numberOf(body["a"]);
  const b = numberOf(body["b"]);
  const decision = one(body["decision"]);
  const note = (one(body["note"]) ?? "").replace(/\r\n?/g, "\n").trim();
  if (a === undefined || b === undefined || (decision !== "different" && decision !== "not_sure")) {
    return void (await draw(res, 400, { problem: "Something in the form wasn't right. Check it and try again." }));
  }
  if (note.length > NOTE_MAX || note.includes(String.fromCharCode(0))) {
    return void (await draw(res, 400, { problem: `Keep the note to ${NOTE_MAX} characters.` }));
  }
  const outcome = await decidePair(teamPerson(res), { a, b, decision, note });
  if (!outcome.ok) return void (await draw(res, outcome.refused.code === "NOT_FOUND" ? 404 : 409, { problem: outcome.refused.message }));
  res.redirect(303, `${DUPLICATES_PATH}?done=${decision}`);
});

/** POST /api/team/new-cats-to-check/:id/checked: "Checked, it's new". */
router.post("/team/new-cats-to-check/:id/checked", ...formRoute("review_duplicates"), async (req: Request, res: Response) => {
  const raw = String(req.params["id"]);
  if (!NUMBER.test(raw)) return void res.status(404).type("text").send("Not found");
  const outcome = await checkedItsNew(teamPerson(res), Number(raw));
  if (!outcome.ok) return void res.status(404).type("text").send("Not found");
  res.redirect(303, "/api/team/new-cats-to-check");
});

export default router;
