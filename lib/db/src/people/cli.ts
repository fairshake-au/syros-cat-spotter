import os from "node:os";
import readline from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../schema";
import { normaliseEmail, PeopleError, peopleStore } from "../people";

// The `people` command (SYC-43 part 1, Decision 4): the stopgap way to manage
// the list until the manage_people screen (SYC-104) exists.
//
//   pnpm --filter @workspace/db run people -- add --target <t> --email <e> --name <n> [--role staff] [--by <operator>]
//   pnpm --filter @workspace/db run people -- list --target <t>
//   pnpm --filter @workspace/db run people -- remove --target <t> --email <e>
//   pnpm --filter @workspace/db run people -- sign-out-everywhere --target <t> --email <e>
//
// The target is always named. Its connection string comes from
// DATABASE_URL_<TARGET> (for example DATABASE_URL_PRODUCTION). It never falls
// back to DATABASE_URL, so a seed can't land on whatever that happens to point
// at. The command prints what it did, never a connection string or secret.

export interface CliIo {
  env: Record<string, string | undefined>;
  out: (line: string) => void;
  /** Asks a question and returns the typed answer. */
  ask: (question: string) => Promise<string>;
}

const USAGE = [
  "Usage:",
  "  people add --target <name> --email <address> --name <name> [--role <role>]... [--by <operator>]",
  "  people list --target <name>",
  "  people remove --target <name> --email <address>",
  "  people sign-out-everywhere --target <name> --email <address>",
  "The connection string is read from DATABASE_URL_<TARGET>, e.g. DATABASE_URL_PRODUCTION.",
].join("\n");

class UsageError extends Error {}

function parseArgs(argv: string[]): {
  command: string;
  flags: Map<string, string[]>;
} {
  const [command, ...rest] = argv.filter((a) => a !== "--");
  if (!command) throw new UsageError("No command given.");
  const flags = new Map<string, string[]>();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    const value = rest[i + 1];
    if (
      !flag.startsWith("--") ||
      value === undefined ||
      value.startsWith("--")
    ) {
      throw new UsageError(`Unexpected argument "${flag}".`);
    }
    flags.set(flag.slice(2), [...(flags.get(flag.slice(2)) ?? []), value]);
    i++;
  }
  return { command, flags };
}

function one(flags: Map<string, string[]>, name: string): string {
  const values = flags.get(name);
  if (!values || values.length !== 1 || !values[0]) {
    throw new UsageError(`Give --${name} exactly once.`);
  }
  return values[0];
}

/** Where the target points, without credentials. */
function describeTarget(target: string, connectionString: string): string {
  try {
    const u = new URL(connectionString);
    return `${target} (${u.hostname}${u.pathname})`;
  } catch {
    return target;
  }
}

/** Runs one command. Returns the process exit code. */
export async function runPeopleCommand(
  argv: string[],
  io: CliIo,
): Promise<number> {
  let client: pg.Client | undefined;
  try {
    const { command, flags } = parseArgs(argv);
    const known = ["add", "list", "remove", "sign-out-everywhere"];
    if (!known.includes(command)) {
      throw new UsageError(`Unknown command "${command}".`);
    }
    const target = one(flags, "target").toLowerCase();
    if (!/^[a-z0-9_]+$/.test(target)) {
      throw new UsageError("--target may only hold letters, digits and _.");
    }
    const envName = `DATABASE_URL_${target.toUpperCase()}`;
    const connectionString = io.env[envName];
    if (!connectionString) {
      io.out(
        `${envName} is not set, so there is no "${target}" database to use.`,
      );
      return 2;
    }
    io.out(`Target: ${describeTarget(target, connectionString)}`);

    client = new pg.Client({ connectionString });
    await client.connect();
    const store = peopleStore(drizzle(client, { schema }));

    if (command === "add") {
      const person = await store.addPerson({
        email: one(flags, "email"),
        name: one(flags, "name"),
        roles: flags.get("role") ?? ["staff"],
        addedBy: `cli:${flags.get("by")?.[0] ?? os.userInfo().username}`,
      });
      io.out(
        `Added ${person.email} (${person.name}) as ${(flags.get("role") ?? ["staff"]).join(", ")}.`,
      );
      return 0;
    }

    if (command === "list") {
      const people = await store.listPeople();
      if (people.length === 0) io.out("Nobody is on the list.");
      for (const p of people) {
        io.out(
          `${p.email}\t${p.name}\t${p.roles.join(",") || "(no roles)"}\tsession ${p.sessionVersion}\tadded ${p.addedAt.toISOString()} by ${p.addedBy ?? "unknown"}`,
        );
      }
      return 0;
    }

    // remove and sign-out-everywhere: the address is typed a second time.
    const email = normaliseEmail(one(flags, "email"));
    const confirmation = normaliseEmail(
      await io.ask(`Type ${email} again to confirm: `),
    );
    if (confirmation !== email) {
      io.out("The addresses don't match. Nothing was changed.");
      return 1;
    }
    if (command === "remove") {
      const removed = await store.removePerson(email);
      io.out(
        removed
          ? `Removed ${email} and their roles.`
          : `${email} isn't on the list. Nothing was changed.`,
      );
      return removed ? 0 : 1;
    }
    const version = await store.signOutEverywhere(email);
    io.out(
      version === null
        ? `${email} isn't on the list. Nothing was changed.`
        : `Signed ${email} out everywhere (session version is now ${version}).`,
    );
    return version === null ? 1 : 0;
  } catch (err) {
    if (err instanceof UsageError) {
      io.out(`${err.message}\n${USAGE}`);
      return 2;
    }
    if (err instanceof PeopleError) {
      io.out(err.message);
      return 1;
    }
    // A database error message can quote the connection string's host but
    // never its password; print only the message, not the object.
    io.out(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    await client?.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  runPeopleCommand(process.argv.slice(2), {
    env: process.env,
    out: (line) => console.log(line),
    ask: (question) => rl.question(question),
  })
    .then((code) => {
      rl.close();
      process.exitCode = code;
    })
    .catch(() => {
      rl.close();
      process.exitCode = 1;
    });
}
