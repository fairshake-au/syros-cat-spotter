import { and, eq, sql } from "drizzle-orm";
import {
  catsTable,
  catUpdatesTable,
  db,
  type Cat,
  type CatUpdate,
  type Observation,
} from "@workspace/db";
import { fanOutNotifications, insertCatUpdate } from "./notificationFanout";
import {
  loadCatRecords,
  writeObservation,
  type WriteObservationInput,
} from "./observations";
import { resolveSterilised, type Resolved } from "./resolve";

// The ONE way a route writes a `sterilised` statement, or marks one wrong
// (SYC-53 plan, PR 2.2, B1; roles spec §7.2 "The 'sterilised' news"). The
// team's routes (recordTeamStatement and supersedeStatement in
// teamCorrections.ts, which the dashboard forms and the JSON routes share),
// a cat guardian's route, and later a vet's and an owner's all come through
// here. A source test (commitStatement.source.test.ts) fails if any other
// file calls writeObservation for that kind, with one named exemption: the
// owner-key route in routes/notifications.ts, which SYC-185 retires and which
// is NOT this path.
//
// The news: when a statement makes a cat *Confirmed sterilised* (it was not
// before, it is now), and the cat has never had a `desexed` update (the
// owner-key route's older ones count), a `desexed` cat update is inserted in
// the SAME transaction. It is sent (in-app rows and Expo push, through
// fanOutNotifications, which already skips a deceased cat) only after that
// transaction commits: see {@link inStatementTransaction}. Once per cat,
// ever. No email from here: the SYC-55 nightly job keeps its own `cat_news`
// purpose.
//
// The transition is worked out from the RESOLVED answers before and after the
// write, so it fires the same way for anyone whose statement makes the cat
// Confirmed (team, management, guardian, and later vet and owner), and for a
// "This is wrong" that exposes an earlier "sterilised".

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A `desexed` update written inside a transaction, to send once it commits. */
export interface PendingNews {
  cat: Cat;
  update: CatUpdate;
}

/** The words of the news, as the app shows them (in-app list and push body). */
export function sterilisedNewsMessage(catName: string): string {
  return `${catName} has been sterilised!`;
}

function confirmedSterilised(r: Resolved<boolean>): boolean {
  return r.confidence === "confirmed" && r.value === true;
}

async function sterilisedAnswer(tx: Tx, catId: number): Promise<Resolved<boolean>> {
  const record = (await loadCatRecords([catId], tx)).get(catId);
  // Imports are not linked yet (data spine §10.6): every reader passes [].
  return resolveSterilised(record?.observations ?? [], []);
}

/**
 * Writes one statement inside `tx`. For any kind but `sterilised` this is
 * exactly writeObservation. For `sterilised`, with the cat row locked
 * (`SELECT … FOR UPDATE`) for the rest of the transaction, so two
 * confirmations at the same moment queue up and only the first announces:
 * resolve the answer, write, resolve again, and queue the news into `news`
 * if this write made the cat Confirmed sterilised for the first time ever.
 *
 * The caller sends what `news` holds only after its transaction commits;
 * a rolled-back write leaves no update and sends nothing.
 */
export async function commitStatement(
  tx: Tx,
  input: WriteObservationInput,
  news: PendingNews[],
  now: Date = new Date(),
): Promise<Observation> {
  if (input.kind !== "sterilised") return writeObservation(tx, input, now);

  const [cat] = await tx
    .select()
    .from(catsTable)
    .where(eq(catsTable.id, input.catId))
    .for("update");
  // No such cat: writeObservation refuses it (the foreign key), nothing to announce.
  if (!cat) return writeObservation(tx, input, now);

  const before = await sterilisedAnswer(tx, cat.id);
  const row = await writeObservation(tx, input, now);
  const after = await sterilisedAnswer(tx, cat.id);
  if (confirmedSterilised(before) || !confirmedSterilised(after)) return row;

  const [already] = await tx
    .select({ one: sql<number>`1` })
    .from(catUpdatesTable)
    .where(and(eq(catUpdatesTable.catId, cat.id), eq(catUpdatesTable.updateType, "desexed")))
    .limit(1);
  if (already) return row;

  const update = await insertCatUpdate(tx, {
    cat,
    updateType: "desexed",
    message: sterilisedNewsMessage(cat.name),
  });
  news.push({ cat, update });
  return row;
}

/** Sends queued news. Call only after the transaction that wrote it has committed. */
export async function sendNews(news: readonly PendingNews[]): Promise<void> {
  for (const n of news) await fanOutNotifications(n);
}

/**
 * Runs `fn` in one transaction and, only once it has committed, sends the
 * news its statements queued. If `fn` throws, the transaction rolls back
 * and nothing is sent.
 */
export async function inStatementTransaction<T>(
  fn: (tx: Tx, news: PendingNews[]) => Promise<T>,
): Promise<T> {
  const news: PendingNews[] = [];
  const result = await db.transaction((tx) => fn(tx, news));
  await sendNews(news);
  return result;
}
