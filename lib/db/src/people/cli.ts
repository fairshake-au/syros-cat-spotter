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
// DATABASE_URL_<TARGET> (for example DATABASE_URL_PRODUCTION), or from
// DATABASE_URL when DATABASE_TARGET names the same target (how a workflow
// environment that holds one database's DATABASE_URL would call it). It never
// uses DATABASE_URL on its own, so a seed can't land on whatever that happens
// to point at. The command prints what it did and the target's name, never a
// connection string, host or secret, even in an error.

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
  "The connection string is read from DATABASE_URL_<TARGET> (e.g. DATABASE_URL_PRODUCTION),",
  "or from DATABASE_URL when DATABASE_TARGET=<target>.",
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

/**
 * The connection string for a named target, or an explanation of why there
 * isn't one. DATABASE_URL_<TARGET> is used when set. Otherwise DATABASE_URL
 * is used only when DATABASE_TARGET names the same target, so the database a
 * process happens to point at is never used by default.
 */
function resolveTarget(
  target: string,
  env: CliIo["env"],
): { url: string } | { problem: string } {
  const specific = env[`DATABASE_URL_${target.toUpperCase()}`];
  if (specific) return { url: specific };
  if (env["DATABASE_URL"] && env["DATABASE_TARGET"] === target) {
    return { url: env["DATABASE_URL"] };
  }
  return {
    problem: `No database is configured for target "${target}". Set DATABASE_URL_${target.toUpperCase()}, or DATABASE_URL with DATABASE_TARGET=${target}.`,
  };
}

/** Removes the connection string, and every part of it, from a message. */
function redact(message: string, connectionString: string | undefined): string {
  if (!connectionString) return message;
  const secrets = [connectionString];
  try {
    const u = new URL(connectionString);
    secrets.push(
      u.password,
      decodeURIComponent(u.password),
      u.username,
      u.hostname,
      u.host,
    );
  } catch {
    // Not a URL: the whole string is already listed.
  }
  let out = message;
  for (const s of secrets.filter((s) => s.length >= 3)) {
    out = out.split(s).join("[redacted]");
  }
  return out;
}

/** Runs one command. Returns the process exit code. */
export async function runPeopleCommand(
  argv: string[],
  io: CliIo,
): Promise<number> {
  let client: pg.Client | undefined;
  let connectionString: string | undefined;
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
    const resolved = resolveTarget(target, io.env);
    if ("problem" in resolved) {
      io.out(resolved.problem);
      return 2;
    }
    connectionString = resolved.url;
    // The target's name only: never the connection string or its host.
    io.out(`Target: ${target}`);

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
        `Added ${person.email} as ${(flags.get("role") ?? ["staff"]).join(", ")}.`,
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
    // A database error can quote the host or user from the connection
    // string. Print only the message, with every part of it redacted.
    io.out(
      `Failed: ${redact(err instanceof Error ? err.message : String(err), connectionString)}`,
    );
    return 1;
  } finally {
    await client?.end().catch(() => {});
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
