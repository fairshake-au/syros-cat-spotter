import { Router, type IRouter, type Request, type Response } from "express";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { can } from "../lib/capabilities";
import { visibleColonyIds } from "../lib/guardianView";
import { colonyHealthReport } from "../lib/reports/colonyHealth";
import { recordDownload } from "../lib/reports/downloads";
import { progressReport } from "../lib/reports/progress";
import { parseRange, rangeQuery } from "../lib/reports/range";
import {
  CSV_REPORTS,
  csvFilename,
  csvOf,
  healthTable,
  parseHealthSort,
  progressTables,
  renderHealthPage,
  renderProgressPage,
  renderReportsList,
  type CsvReport,
} from "../lib/teamPages/reportPages";

// The Reports area (SYC-396 PR 3.3a; spec §9.3). At /insights, because
// /api/team/reports is already the welfare queue's JSON and report pages
// (routes/teamReports.ts); the menu's label is still "Reports".
//
// **Team-only at launch** (Samuel, 18 Oct, Q1). A cat guardian holds
// view_reports for her colonies, but every route here names it with no
// target, so it answers for island rows only and she gets the 403. Her own
// reports arrive on 16 Nov (SYC-472). Downloads are export_report, island-only.
//
// **A download is recorded before it is sent.** If the record can't be
// written, the answer is 503 and no file (team.reportsArea.test.ts, with a
// mutation probe). No script on any page, so the strict security header stays.

const router: IRouter = Router();

const UNAVAILABLE =
  "This download isn't available right now, because it couldn't be recorded. Nothing was downloaded. Please try again in a minute.";

router.get("/team/insights", requireTeam("view_reports"), (req: Request, res: Response) => {
  setTeamHeaders(res);
  res.type("html").send(renderReportsList({ personName: teamPerson(res).name }));
});

// Before /team/insights/:report, which would otherwise take "health.csv" as a report's name.
router.get("/team/insights/:report.csv", requireTeam("export_report"), async (req: Request, res: Response) => {
  setTeamHeaders(res); // before any await, so an error answer carries them too
  const person = teamPerson(res);
  const report = String(req.params["report"]);
  if (!(CSV_REPORTS as readonly string[]).includes(report)) return void res.status(404).json({ error: "Not found" });
  const now = new Date();
  const range = parseRange(req.query, now);
  let csv: string;
  if (report === "health") {
    const { sort, dir } = parseHealthSort(req.query);
    csv = csvOf(healthTable(await colonyHealthReport(visibleColonyIds(person), range, now), sort, dir, true));
  } else {
    const tables = progressTables(await progressReport(range, now), true);
    csv = csvOf(report === "progress-over" ? tables.over : tables.colonies);
  }
  try {
    await recordDownload(person.id, report, rangeQuery(range));
  } catch (err) {
    req.log.error({ err, report }, "report download not recorded; nothing sent");
    return void res.status(503).type("text/plain").send(UNAVAILABLE);
  }
  res
    .type("text/csv; charset=utf-8")
    .attachment(csvFilename(report as CsvReport, now))
    .send(csv);
});

router.get("/team/insights/:report", requireTeam("view_reports"), async (req: Request, res: Response) => {
  setTeamHeaders(res); // before any await, so an error answer carries them too
  const person = teamPerson(res);
  const report = String(req.params["report"]);
  const now = new Date();
  const range = parseRange(req.query, now);
  const canExport = can(person, "export_report");
  const started = Date.now();
  if (report === "progress") {
    const data = await progressReport(range, now);
    req.log.info({ ms: Date.now() - started, report }, "report worked out");
    return void res.type("html").send(renderProgressPage(data, { personName: person.name, range, canExport }));
  }
  if (report === "health") {
    const { sort, dir } = parseHealthSort(req.query);
    const data = await colonyHealthReport(visibleColonyIds(person), range, now);
    req.log.info({ ms: Date.now() - started, report }, "report worked out");
    return void res.type("html").send(renderHealthPage(data, { personName: person.name, range, sort, dir, canExport }));
  }
  res.status(404).json({ error: "Not found" });
});

export default router;
