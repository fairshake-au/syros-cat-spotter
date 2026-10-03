import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { describeHost, resolveDatabaseUrl } from "./url";

const { url, source } = resolveDatabaseUrl(process.env);
export const databaseTarget = { source, host: describeHost(url) };
export const pool = new pg.Pool({ connectionString: url });
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
  normaliseEmail,
  checkPersonEmail,
  isPersonId,
  peopleStore,
  PeopleError,
  type AllowedPerson,
  type PersonWithScopes,
  type PeopleStore,
} from "./people";
import { peopleStore } from "./people";

// The people operations on the app's database (team-access spec §2.9). The
// future manage_people screen calls these same functions.
const people = peopleStore(db);
export const addPerson = people.addPerson;
export const removePerson = people.removePerson;
export const signOutEverywhere = people.signOutEverywhere;
export const findAllowedPerson = people.findAllowedPerson;
export const findPersonById = people.findPersonById;
export const listPeople = people.listPeople;
