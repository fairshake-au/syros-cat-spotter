import { Router, type IRouter, type Request, type Response } from "express";
import { refuseSignedIn, requireTeam, teamPerson } from "../middlewares/requireTeam";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { can } from "../lib/capabilities";
import { getAppSettings } from "../lib/appSettings";
import { visibleColonyIds } from "../lib/guardianView";
import { colonyHealthReport } from "../lib/reports/colonyHealth";
import { coverageReport } from "../lib/reports/coverage";
import { recordDownload } from "../lib/reports/downloads";
import { launchMeasuresReport } from "../lib/reports/launchMeasures";
import { progressReport } from "../lib/reports/progress";
import { parseRange, rangeQuery } from "../lib/reports/range";
import { vetCostsReport } from "../lib/reports/vetCosts";
import { welfarePatterns } from "../lib/reports/welfarePatterns";
import {
  CSV_REPORTS,
  coverageTables,
  csvFilename,
  csvOf,
  healthTable,
  parseHealthSort,
  progressTables,
  renderCoveragePage,
  renderHealthPage,
  renderProgressPage,
  renderReportsList,
  renderVetPage,
  renderWelfarePage,
  VET_CSV_REPORTS,
  vetTables,
  welfareTables,
  type CsvReport,
} from "../lib/teamPages/reportPages";
import { launchRange, launchRangeQuery, launchTables, renderLaunchPage } from "../lib/teamPages/launchPage";

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
//
// **Vet visits and costs needs view_vet_costs as well** (§8.4; PR 3.3c): the
// page and its files refuse anyone without it before anything is worked out
// or recorded.

const router: IRouter = Router();

const LAUNCH_CSV_REPORTS: readonly string[] = ["launch-use", "launch-matched", "launch-accuracy", "launch-wait", "launch-follow"];

const UNAVAILABLE =
  "This download isn't available right now, because it couldn't be recorded. Nothing was downloaded. Please try again in a minute.";

router.get("/team/insights", requireTeam("view_reports"), (req: Request, res: Response) => {
  setTeamHeaders(res);
  const person = teamPerson(res);
  res.type("html").send(renderReportsList({ personName: person.name, vetCosts: can(person, "view_vet_costs") }));
});

// Before /team/insights/:report, which would otherwise take "health.csv" as a report's name.
router.get("/team/insights/:report.csv", requireTeam("export_report"), async (req: Request, res: Response) => {
  setTeamHeaders(res); // before any await, so an error answer carries them too
  // Express answers HEAD on a GET route. A HEAD sends no file, so it must not
  // be recorded as a download (review of #260).
  if (req.method !== "GET") return void res.status(405).set("Allow", "GET").end();
  const person = teamPerson(res);
  const report = String(req.params["report"]);
  if (!(CSV_REPORTS as readonly string[]).includes(report)) return void res.status(404).json({ error: "Not found" });
  const vet = VET_CSV_REPORTS.includes(report as CsvReport);
  if (vet && !can(person, "view_vet_costs")) return refuseSignedIn(req, res);
  const now = new Date();
  // Launch measures has a range of its own, "Since launch", which opens on the launch date.
  const launchFile = LAUNCH_CSV_REPORTS.includes(report as CsvReport);
  const range = launchFile ? launchRange(req.query, now, (await getAppSettings()).launchDate) : parseRange(req.query, now);
  let csv: string;
  if (launchFile) {
    const tables = launchTables(await launchMeasuresReport(range, now), true);
    csv = csvOf(
      report === "launch-use" ? tables.weeks
      : report === "launch-matched" ? tables.matched
      : report === "launch-accuracy" ? tables.accuracy
      : report === "launch-wait" ? tables.wait
      : tables.followUp,
    );
  } else if (report === "health") {
    const { sort, dir } = parseHealthSort(req.query);
    csv = csvOf(healthTable(await colonyHealthReport(visibleColonyIds(person), range, now), sort, dir, true));
  } else if (report === "coverage-weeks" || report === "coverage-areas") {
    const tables = coverageTables(await coverageReport(range, now), true);
    csv = csvOf(report === "coverage-weeks" ? tables.weeks : tables.areas);
  } else if (vet) {
    const tables = vetTables(await vetCostsReport(range, now), true);
    csv = csvOf(report === "vet-months" ? tables.months : report === "vet-purposes" ? tables.purposes : tables.visits);
  } else if (report === "welfare-weeks" || report === "welfare-areas") {
    const tables = welfareTables(await welfarePatterns(range, now), true);
    csv = csvOf(report === "welfare-weeks" ? tables.weeks : tables.areas);
  } else {
    const tables = progressTables(await progressReport(range, now), true);
    csv = csvOf(report === "progress-over" ? tables.over : tables.colonies);
  }
  try {
    await recordDownload(person.id, report, launchFile ? launchRangeQuery(range as ReturnType<typeof launchRange>) : rangeQuery(range));
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
  const canExport = can(person, "export_report");
  const started = Date.now();
  if (report === "launch") {
    const range = launchRange(req.query, now, (await getAppSettings()).launchDate);
    const data = await launchMeasuresReport(range, now);
    req.log.info({ ms: Date.now() - started, report }, "report worked out");
    return void res.type("html").send(renderLaunchPage(data, { personName: person.name, range, canExport, now }));
  }
  const range = parseRange(req.query, now);
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
  if (report === "coverage") {
    const data = await coverageReport(range, now);
    req.log.info({ ms: Date.now() - started, report }, "report worked out");
    return void res.type("html").send(renderCoveragePage(data, { personName: person.name, range, canExport }));
  }
  if (report === "welfare") {
    const data = await welfarePatterns(range, now);
    req.log.info({ ms: Date.now() - started, report }, "report worked out");
    return void res.type("html").send(renderWelfarePage(data, { personName: person.name, range, canExport }));
  }
  if (report === "vet") {
    if (!can(person, "view_vet_costs")) return refuseSignedIn(req, res);
    const data = await vetCostsReport(range, now);
    req.log.info({ ms: Date.now() - started, report }, "report worked out");
    return void res.type("html").send(renderVetPage(data, { personName: person.name, range, canExport }));
  }
  res.status(404).json({ error: "Not found" });
});

export default router;
