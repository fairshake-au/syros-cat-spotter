import { db, reportDownloadsTable } from "@workspace/db";

// The record of report downloads (SYC-396 PR 3.3a; spec §9.3): who, which
// report, which range and when, but never the contents.
//
// **Written before the file is sent.** The route awaits this first and, if
// it fails, answers 503 with no file: a download nobody recorded never
// happens. An unrecorded download looks exactly like a recorded one to the
// person downloading, so team.reportsArea.test.ts forces a failure here and
// checks no file went out (with a mutation probe: send first, record after,
// and that test must go red).

export async function recordDownload(personId: string, report: string, range: string): Promise<void> {
  await db.insert(reportDownloadsTable).values({ personId, report, range });
}
