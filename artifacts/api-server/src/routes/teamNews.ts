import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { desc, eq, gte } from "drizzle-orm";
import { catNewsChangesTable, catsTable, db } from "@workspace/db";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { requireTeam } from "../middlewares/requireTeam";
import { syrNumber } from "../lib/teamCatView";
import { formRoute } from "./teamCorrections";

/**
 * SYC-45 Slice 1 (syc-344-email-capture.md, PR 1.1): the nightly news
 * check's review list. What the two-week rule needs a person to look at
 * (email-capture.md §10.1 Risk 1). No dashboard page yet: JSON only, and
 * Claude reads the list to Samuel.
 *
 * The team's: `review_cat_news` is island-only, so a cat guardian gets the
 * 403. (It used to reuse `use_workspace`, for want of a §6.2 news row; when
 * the workspace became management's, SYC-619 §2.2, the list got its own row
 * in roles-and-invites.md §6.2 so staff keep it.)
 *
 * - GET /api/team/news-changes: the last 30 days of changes, newest first,
 *   with each cat's name and code. Never the devices that caused them.
 * - POST /api/team/news-changes/:id/review: marks one looked at, with an
 *   optional note. Reviewing again replaces the note and the time.
 */
const router: IRouter = Router();

const WINDOW_DAYS = 30;

router.get("/team/news-changes", requireTeam("review_cat_news"), async (_req: Request, res: Response) => {
  setTeamHeaders(res);
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const rows = await db
    .select({
      id: catNewsChangesTable.id,
      catId: catNewsChangesTable.catId,
      catName: catsTable.name,
      change: catNewsChangesTable.change,
      evidenceIds: catNewsChangesTable.evidenceIds,
      foundAt: catNewsChangesTable.foundAt,
      state: catNewsChangesTable.state,
      silencedReason: catNewsChangesTable.silencedReason,
      reviewedAt: catNewsChangesTable.reviewedAt,
      reviewedNote: catNewsChangesTable.reviewedNote,
    })
    .from(catNewsChangesTable)
    .leftJoin(catsTable, eq(catsTable.id, catNewsChangesTable.catId))
    .where(gte(catNewsChangesTable.foundAt, since))
    .orderBy(desc(catNewsChangesTable.foundAt), desc(catNewsChangesTable.id));
  res.json({
    changes: rows.map((r) => ({
      ...r,
      catCode: syrNumber(r.catId),
      foundAt: r.foundAt.toISOString(),
      reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    })),
  });
});

const ReviewForm = z.object({
  note: z.string().max(500).optional(),
});

router.post(
  "/team/news-changes/:id/review",
  ...formRoute("review_cat_news"),
  async (req: Request, res: Response) => {
    const raw = String(req.params["id"]);
    const id = /^[1-9][0-9]{0,9}$/.test(raw) ? Number(raw) : null;
    if (id === null || id > 2_147_483_647) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const parsed = ReviewForm.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_note" });
      return;
    }
    const note = parsed.data.note?.trim() || null;
    const [row] = await db
      .update(catNewsChangesTable)
      .set({ reviewedAt: new Date(), reviewedNote: note })
      .where(eq(catNewsChangesTable.id, id))
      .returning({ id: catNewsChangesTable.id, reviewedAt: catNewsChangesTable.reviewedAt });
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ id: row.id, reviewedAt: row.reviewedAt!.toISOString(), reviewedNote: note });
  },
);

export default router;
