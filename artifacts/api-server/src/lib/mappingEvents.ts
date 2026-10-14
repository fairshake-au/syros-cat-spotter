import {
  db,
  mappingEventsTable,
  MAPPING_EVENT_KINDS,
  MAPPING_SUBJECT_KINDS,
  MAPPING_SYSTEM_ACTORS,
  type MappingEventKind,
  type MappingSubjectKind,
  type MappingSystemActor,
} from "@workspace/db";

// The feeding-site and colony history (SYC-209 PR 1.1; feeding-sites-and-
// colonies.md §8). **This is the only writer of mapping_events.** Every change
// to a site or a colony writes exactly one row here, in the same transaction
// as the change, so the two always commit or fail together (spec test 11).
//
// It takes the caller's transaction, never the pool: the type refuses `db`
// (a transaction has `rollback()`, the pool doesn't), and a runtime check
// refuses it again for callers that cast their way past the type.
//
// The database backs every rule here: a check constraint for the kinds and
// for "exactly one actor", and a trigger that makes the table add-only
// (migration 0015). These checks give a plain-English refusal first.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Who did it: a person on the people list, or one of the app's own actors. */
export type MappingActor =
  | { personId: string; actorSystem?: undefined }
  | { actorSystem: MappingSystemActor; personId?: undefined };

export type MappingEventInput = MappingActor & {
  subjectKind: MappingSubjectKind;
  subjectId: number;
  kind: MappingEventKind;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  note?: string | null;
  guardianAware?: boolean | null;
};

export class MappingEventRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MappingEventRefused";
  }
}

const KINDS: ReadonlySet<string> = new Set(MAPPING_EVENT_KINDS);
const SUBJECTS: ReadonlySet<string> = new Set(MAPPING_SUBJECT_KINDS);
const SYSTEM_ACTORS: ReadonlySet<string> = new Set(MAPPING_SYSTEM_ACTORS);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isTransaction(tx: unknown): boolean {
  return (
    typeof tx === "object" &&
    tx !== null &&
    tx !== (db as unknown) &&
    typeof (tx as { rollback?: unknown }).rollback === "function"
  );
}

/**
 * Records one change in the history, inside the caller's transaction.
 * Returns the new row's id. Refuses (throws {@link MappingEventRefused}) if
 * called outside a transaction, with no actor or two, with an unknown
 * system actor, or with an unknown kind or subject.
 */
export async function recordMappingEvent(
  tx: Tx,
  event: MappingEventInput,
): Promise<number> {
  if (!isTransaction(tx)) {
    throw new MappingEventRefused(
      "recordMappingEvent needs the caller's transaction, so the change and its history row commit together",
    );
  }
  const personId = event.personId ?? null;
  const actorSystem = event.actorSystem ?? null;
  if ((personId === null) === (actorSystem === null)) {
    throw new MappingEventRefused(
      "a history row needs exactly one of a person and a system actor",
    );
  }
  if (personId !== null && !UUID.test(personId)) {
    throw new MappingEventRefused("personId is not a person's id");
  }
  if (actorSystem !== null && !SYSTEM_ACTORS.has(actorSystem)) {
    throw new MappingEventRefused(`unknown system actor: ${actorSystem}`);
  }
  if (!SUBJECTS.has(event.subjectKind)) {
    throw new MappingEventRefused(`unknown subject kind: ${event.subjectKind}`);
  }
  if (!Number.isInteger(event.subjectId) || event.subjectId <= 0) {
    throw new MappingEventRefused("subjectId must be a positive whole number");
  }
  if (!KINDS.has(event.kind)) {
    throw new MappingEventRefused(`unknown history kind: ${event.kind}`);
  }

  const [row] = await tx
    .insert(mappingEventsTable)
    .values({
      subjectKind: event.subjectKind,
      subjectId: event.subjectId,
      kind: event.kind,
      personId,
      actorSystem,
      before: event.before ?? null,
      after: event.after ?? null,
      note: event.note ?? null,
      guardianAware: event.guardianAware ?? null,
    })
    .returning({ id: mappingEventsTable.id });
  return row!.id;
}
