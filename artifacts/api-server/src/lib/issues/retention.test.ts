import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { addPerson, db } from "@workspace/db";
import { removeTestPerson } from "../../test/removeTestPerson";
import { clearWelfareTables, seedReport, type SeedReport } from "../teamAuth/__fixtures__/queueKit";
import { _resetIssueNotesSweepForTests, sweepIssueNotes, sweepIssueNotesIfDue } from "./retention";

// SYC-44 PR 8.1 tests T8-1 to T8-3 (docs/superpowers/plans/syc-44-report-an-issue.md,
// Slice 8): a year after an issue report is closed its notes go; nothing else does.
// The clock is fixed: the sweep is given NOW, and every age is measured from it.

const NOW = Date.UTC(2027, 9, 22, 3, 0, 0);
const STAFF = "vitest-issue-retention@example.com";
let staffId: string;

type Row = {
  note: string | null;
  team_note: string | null;
  team_note_by: string | null;
  team_note_at: Date | null;
  note_cleared_at: Date | null;
  reason: string | null;
  state: string;
  state_changed_at: Date | null;
};

/** A report closed (or moved) `age` before NOW, e.g. '1 year 1 day'. */
async function seedAged(o: SeedReport, age: string): Promise<number> {
  const { id } = await seedReport({ note: "It's my neighbour's garden", teamNote: "Asked the spotter; they agreed", teamNoteBy: staffId, ...o });
  await db.execute(sql`
    update welfare_reports
       set state_changed_at = to_timestamp(${NOW} / 1000.0) - ${age}::interval,
           state_changed_by = ${staffId}
     where id = ${id}
  `);
  return id;
}

async function row(id: number): Promise<Row> {
  const r = await db.execute(sql`
    select note, team_note, team_note_by, team_note_at, note_cleared_at, reason, state, state_changed_at
      from welfare_reports where id = ${id}
  `);
  // Raw rows carry timestamps as text; compare them as dates.
  const raw = r.rows[0] as Record<string, unknown>;
  const at = (v: unknown) => (v === null ? null : new Date(v as string));
  return {
    ...(raw as Row),
    team_note_at: at(raw.team_note_at),
    note_cleared_at: at(raw.note_cleared_at),
    state_changed_at: at(raw.state_changed_at),
  };
}

beforeAll(async () => {
  await removeTestPerson(STAFF);
  staffId = (await addPerson({ email: STAFF, name: "Staff", addedBy: "cli:vitest" })).id;
});

beforeEach(async () => {
  await clearWelfareTables();
  _resetIssueNotesSweepForTests();
});

afterAll(async () => {
  await clearWelfareTables();
  await removeTestPerson(STAFF);
});

describe("the one-year clean-up of issue notes (SYC-44 PR 8.1)", () => {
  it("T8-1: at one year and a day both notes go and the bare record stays; at 364 days they're kept", async () => {
    const old = await seedAged({ kind: "content", reason: "location_revealing", state: "done" }, "1 year 1 day");
    const oldNothing = await seedAged({ kind: "content", reason: "wrong_name", state: "nothing_needed" }, "1 year 1 day");
    const young = await seedAged({ kind: "content", reason: "location_revealing", state: "done" }, "364 days");

    const before = await row(old);
    expect(await sweepIssueNotes(NOW)).toEqual({ notesCleared: 2 });

    for (const id of [old, oldNothing]) {
      const r = await row(id);
      expect(r).toMatchObject({ note: null, team_note: null, team_note_by: null, team_note_at: null });
      expect(r.note_cleared_at?.getTime()).toBe(NOW);
    }
    // The bare record: reason, state and when it closed are untouched.
    const after = await row(old);
    expect(after).toMatchObject({ reason: "location_revealing", state: "done" });
    expect(after.state_changed_at?.getTime()).toBe(before.state_changed_at?.getTime());

    const kept = await row(young);
    expect(kept).toMatchObject({
      note: "It's my neighbour's garden",
      team_note: "Asked the spotter; they agreed",
      team_note_by: staffId,
      note_cleared_at: null,
    });
    expect(kept.team_note_at).not.toBeNull();
  });

  it("T8-2: a welfare report closed four years ago is untouched", async () => {
    const welfare = await seedAged({ kind: "welfare", state: "done" }, "4 years");
    const welfareNothing = await seedAged({ kind: "welfare", state: "nothing_needed" }, "4 years");
    const before = [await row(welfare), await row(welfareNothing)];

    expect(await sweepIssueNotes(NOW)).toEqual({ notesCleared: 0 });

    expect([await row(welfare), await row(welfareNothing)]).toEqual(before);
    expect(before[0]).toMatchObject({ note: "It's my neighbour's garden", note_cleared_at: null });
  });

  it("T8-3: a reopened report (moved back to looking) isn't swept, nor is an open one", async () => {
    // Its last move is over a year old, but it's open: the state is what counts.
    const reopened = await seedAged({ kind: "content", state: "looking" }, "2 years");
    const fresh = await seedAged({ kind: "content", state: "new" }, "2 years");

    expect(await sweepIssueNotes(NOW)).toEqual({ notesCleared: 0 });

    for (const id of [reopened, fresh]) {
      expect(await row(id)).toMatchObject({ note: "It's my neighbour's garden", team_note: "Asked the spotter; they agreed", note_cleared_at: null });
    }
  });

  it("a second run changes nothing; a team note written after the clearing goes on the next run", async () => {
    const id = await seedAged({ kind: "content", state: "done" }, "1 year 1 day");
    expect(await sweepIssueNotes(NOW)).toEqual({ notesCleared: 1 });
    expect(await sweepIssueNotes(NOW + 60_000)).toEqual({ notesCleared: 0 });
    expect((await row(id)).note_cleared_at?.getTime()).toBe(NOW);

    await db.execute(sql`
      update welfare_reports set team_note = 'Looked again', team_note_by = ${staffId}, team_note_at = now() where id = ${id}
    `);
    expect(await sweepIssueNotes(NOW + 120_000)).toEqual({ notesCleared: 1 });
    expect(await row(id)).toMatchObject({ team_note: null, team_note_by: null, team_note_at: null });
  });

  it("rides on the mail drain at most once a day per server", async () => {
    const log = { error: () => {} };
    await seedAged({ kind: "content", state: "done" }, "3 years");
    expect(await sweepIssueNotesIfDue(log)).toEqual({ notesCleared: 1 });
    expect(await sweepIssueNotesIfDue(log)).toBeNull();
  });
});
