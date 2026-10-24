import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { describeHost, resolveDatabaseUrl } from "./url";

const { url, source } = resolveDatabaseUrl(process.env);
export const databaseTarget = { source, host: describeHost(url) };

// SYC-407: a request that can't get a connection fails after this long, with
// a logged error, instead of waiting for ever. Without it, one route that
// holds a connection while asking for a second could hang every route
// silently. 10 s is longer than any healthy checkout (normally milliseconds),
// shorter than a phone's patience.
export const POOL_CONNECTION_TIMEOUT_MS = 10_000;
// Deliberately NOT set here: idle_in_transaction_session_timeout and
// statement_timeout. The live app uses Neon's pooled address (a
// transaction-mode pooler), where a per-connection SET is unreliable, and a
// statement timeout could cut a long report export. Both belong on the
// database role instead (SYC-407 follow-up).

export const pool = new pg.Pool({
  connectionString: url,
  connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
});
// Neon closes idle connections when its compute suspends. Without a listener,
// an idle client's 'error' event would crash the process.
pool.on("error", (err) =>
  console.error(
    `database pool: idle client error on ${databaseTarget.host}: ${err.message}`,
  ),
);
export const db = drizzle(pool, { schema });
export * from "./schema";
export { describeHost, resolveDatabaseUrl } from "./url";
export { foldName } from "./fold";
export {
  STARTER_FACT_IDS,
  SIGN_OFF_FACT_IDS,
  SETTING_KEYS,
  type SettingKey,
  isSettingKey,
  isHttpsAddress,
  settingShapeProblem,
  settingWriteProblem,
} from "./appSettings/shape";
export { foldedNameEquals } from "./catNames";

export {
  normaliseEmail,
  checkPersonEmail,
  isPersonId,
  peopleStore,
  PeopleError,
  LAST_MANAGER,
  placementEndsAt,
  scopeInForce,
  personState,
  isInvitedNow,
  isAnonymisedEmail,
  anonymisedEmail,
  cleanPersonName,
  inviteRecipient,
  managerRecipient,
  managersToNotify,
  peopleNames,
  colonyNames,
  recordInviteDelivered,
  ANONYMISED_NAME,
  INVITATION_DAYS,
  PERSON_NAME_MAX,
  START_LABEL,
  START_ALONE,
  START_OR_COLONIES,
  START_NO_END,
  type PersonState,
  type Invitee,
  type InviteRecipient,
  type PlacementInput,
  type InTransaction,
  type MarkLeftResult,
  type SetPlacementsResult,
  type PeopleTx,
  type PeopleExec,
  type AllowedPerson,
  type PersonWithScopes,
  type PeopleStore,
  type ScreenPerson,
} from "./people";
import { peopleStore } from "./people";

// The people operations on the app's database (team-access spec §2.9). The
// future manage_people screen calls these same functions.
const people = peopleStore(db);
export const addPerson = people.addPerson;
export const markLeft = people.markLeft;
export const signOutEverywhere = people.signOutEverywhere;
export const findAllowedPerson = people.findAllowedPerson;
export const findPersonById = people.findPersonById;
export const listPeople = people.listPeople;
export const peopleScreen = people.peopleScreen;
// SYC-53 PR 1.1: invitations, accepting, withdrawing, leaving.
export const invitePerson = people.invitePerson;
export const findInvitee = people.findInvitee;
export const findInviteeByEmail = people.findInviteeByEmail;
export const invitationFor = people.invitationFor;
export const acceptInvitation = people.acceptInvitation;
export const declineInvitation = people.declineInvitation;
export const withdrawInvitation = people.withdrawInvitation;
export const resendInvitation = people.resendInvitation;
export const setPlacements = people.setPlacements;
export const markLeftById = people.markLeftById;
export const stopHelping = people.stopHelping;
export const signOutEverywhereById = people.signOutEverywhereById;
export const myColonies = people.myColonies;
export const setOwnLanguage = people.setOwnLanguage;
export const rejoinPerson = people.rejoinPerson;
export const createColonyWithPlacement = people.createColonyWithPlacement;
