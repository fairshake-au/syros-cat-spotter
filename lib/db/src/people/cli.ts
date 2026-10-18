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
//   pnpm --filter @workspace/db run people -- add --target <t> --accepted [--email <e>] [--name <n>] [--role staff] [--colony <id>] [--language en] [--by <operator>]
//   pnpm --filter @workspace/db run people -- set-roles --target <t> (--add <role> | --remove <role> | --replace <role>...) [--colony <id> | --start] [--force] [--email <e>] [--by <operator>]
//   pnpm --filter @workspace/db run people -- list --target <t>
//   pnpm --filter @workspace/db run people -- mark-left --target <t> [--force] [--email <e>] [--by <operator>]
//   pnpm --filter @workspace/db run people -- sign-out-everywhere --target <t> [--email <e>] [--by <operator>]
//
// The address is typed a second time for set-roles, mark-left and
// sign-out-everywhere: at a terminal, interactively; otherwise (db-ops,
// SYC-131) as the first line of stdin.
//
// SYC-53 PR 0.3. `add` adds someone directly, joined at once, so it needs
// --accepted: it is the break-glass for a team member, and invitations
// (people who must accept first) come with the people screen. A cat guardian
// needs --colony; `volunteer` is retired; `management` is never given by
// `add`. `set-roles` is how management is given, and it is additive: one
// role is added or removed at a time, a whole new list needs --replace, the
// roles are printed before and after, and a result with neither staff nor
// management, or one that takes management from the last manager, is
// refused unless --force is given (SYC-53 PR 0.5; SYC-316).
//
// Someone who leaves is marked as left, never removed (SYC-43 part 2, Decision
// 7; SYC-53 PR 0.1): their history stays theirs. There is no `remove`: every
// person has an `added` event in the record of who changed what, so a hard
// delete can never succeed. Marking as left is the only way off the list.
//
// Claude runs it through db-ops (scripts/db-ops.sh, `people-add`,
// `people-list`, `people-set-roles`, `people-mark-left` and
// `people-sign-out-everywhere`), the SYC-121 route for every database command. It picks its
// database exactly the way db-ops.sh does for migrate:
//  1. `--target` is mandatory, and DATABASE_TARGET (set by the GitHub
//     Environment) must equal it. This is checked first; a mismatch refuses.
//  2. The address comes only from the target's own variable: production →
//     NEON_PROD_URL, rehearsal → NEON_REHEARSAL_URL, development →
//     NEON_DEV_URL. There's no fallback, and never DATABASE_URL, so an empty
//     secret can't resolve to another branch.
// The address and name can come from PEOPLE_EMAIL and PEOPLE_NAME instead of
// flags, so db-ops passes them from short-lived Environment secrets, never on
// a command line. Output names the target and the person's id and role, never
// their address, a connection string or a host, even in an error (SYC-121
// plan H.1(b)).

export interface CliIo {
  env: Record<string, string | undefined>;
  out: (line: string) => void;
  /** Asks a question and returns the typed answer. */
  ask: (question: string) => Promise<string>;
}

const USAGE = [
  "Usage:",
  "  people add --target <target> --accepted [--email <address>] [--name <name>] [--role <role>]... [--colony <id>] [--language en|el|fr] [--by <operator>]",
  "  people set-roles --target <target> (--add <role> | --remove <role> | --replace <role>...) [--colony <id> | --start] [--force] [--email <address>] [--by <operator>]",
  "  people list --target <target>",
  "  people mark-left --target <target> [--force] [--email <address>] [--by <operator>]",
  "  people sign-out-everywhere --target <target> [--email <address>] [--by <operator>]",
  "<target> is development, rehearsal or production, and DATABASE_TARGET must equal it.",
  "The address comes from NEON_DEV_URL, NEON_REHEARSAL_URL or NEON_PROD_URL respectively.",
  "--email and --name may instead come from PEOPLE_EMAIL and PEOPLE_NAME.",
  "Roles are staff, management, guardian and vet. A guardian needs --colony, or --start for a cat guardian with no colony yet (set-roles --add guardian or --remove guardian).",
].join("\n");

class UsageError extends Error {}

/** Each target's address comes only from its own variable (db-ops.sh). */
export const TARGET_URL_VARIABLES = {
  production: "NEON_PROD_URL",
  rehearsal: "NEON_REHEARSAL_URL",
  development: "NEON_DEV_URL",
} as const;

/** Flags that take no value. */
const SWITCHES = new Set(["accepted", "force", "start"]);

function parseArgs(argv: string[]): {
  command: string;
  flags: Map<string, string[]>;
} {
  const [command, ...rest] = argv.filter((a) => a !== "--");
  if (!command) throw new UsageError("No command given.");
  const flags = new Map<string, string[]>();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    if (flag.startsWith("--") && SWITCHES.has(flag.slice(2))) {
      if (flags.has(flag.slice(2))) {
        throw new UsageError(`Give ${flag} at most once.`);
      }
      flags.set(flag.slice(2), ["yes"]);
      continue;
    }
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

/** --flag once, or nothing. */
function optional(
  flags: Map<string, string[]>,
  name: string,
): string | undefined {
  return flags.has(name) ? one(flags, name) : undefined;
}

/** A colony number, or why it isn't one. */
function colonyFlag(flags: Map<string, string[]>): number | undefined {
  const raw = optional(flags, "colony");
  if (raw === undefined) return undefined;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new UsageError("--colony is a colony's number, like 12.");
  }
  return Number(raw);
}

/** --flag, or the environment variable db-ops passes it in. */
function flagOrEnv(
  flags: Map<string, string[]>,
  name: string,
  envName: string,
  env: CliIo["env"],
): string {
  if (flags.has(name)) return one(flags, name);
  const value = env[envName];
  if (!value) throw new UsageError(`Give --${name}, or set ${envName}.`);
  return value;
}

/**
 * The connection string for a named target, or why there isn't one. The
 * DATABASE_TARGET check comes first, as in db-ops.sh.
 */
export function resolveTarget(
  target: string,
  env: CliIo["env"],
): { url: string } | { problem: string } {
  if (env["DATABASE_TARGET"] !== target) {
    return {
      problem: `DATABASE_TARGET ('${env["DATABASE_TARGET"] ?? "unset"}') doesn't match target '${target}'. Refusing.`,
    };
  }
  if (!Object.hasOwn(TARGET_URL_VARIABLES, target)) {
    return {
      problem: "The target must be development, rehearsal or production.",
    };
  }
  const name =
    TARGET_URL_VARIABLES[target as keyof typeof TARGET_URL_VARIABLES];
  const url = env[name];
  if (!url) return { problem: `${name} must be set for target '${target}'.` };
  return { url };
}

/** Removes the connection string, and every part of it, from a message. */
export function redact(message: string, connectionString: string | undefined): string {
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
    const known = [
      "add",
      "list",
      "set-roles",
      "mark-left",
      "sign-out-everywhere",
    ];
    if (!known.includes(command)) {
      throw new UsageError(`Unknown command "${command}".`);
    }
    const target = one(flags, "target");
    const resolved = resolveTarget(target, io.env);
    if ("problem" in resolved) {
      io.out(resolved.problem);
      return 2;
    }
    connectionString = resolved.url;
    // The target's name only: never the connection string or its host.
    io.out(`Target: ${target}`);

    // Read the person's details before connecting, so a missing one is a
    // usage error rather than a half-done run.
    if (command === "add" && !flags.has("accepted")) {
      throw new UsageError(
        "add puts someone straight on the list, joined at once, so it needs --accepted. Invitations come with the people screen.",
      );
    }
    const addInput =
      command === "add"
        ? {
            email: flagOrEnv(flags, "email", "PEOPLE_EMAIL", io.env),
            name: flagOrEnv(flags, "name", "PEOPLE_NAME", io.env),
            roles: flags.get("role") ?? ["staff"],
            colonyId: colonyFlag(flags),
            language: optional(flags, "language"),
          }
        : null;
    const setRolesInput =
      command === "set-roles"
        ? {
            add: optional(flags, "add"),
            remove: optional(flags, "remove"),
            replace: flags.get("replace"),
            colonyId: colonyFlag(flags),
            ...(flags.has("start") ? { start: true } : {}),
            force: flags.has("force"),
          }
        : null;
    // A bare --role is how `add` names roles; for set-roles it would read
    // as "these are the roles now", which is exactly the misuse additive
    // set-roles exists to prevent.
    if (setRolesInput && flags.has("role")) {
      throw new UsageError(
        "set-roles takes --add <role> or --remove <role>, one at a time; a whole new list needs --replace <role>.",
      );
    }

    client = new pg.Client({ connectionString });
    await client.connect();
    const store = peopleStore(drizzle(client, { schema }));

    const operator = `cli:${flags.get("by")?.[0] ?? os.userInfo().username}`;

    if (addInput) {
      const person = await store.addPerson({ ...addInput, addedBy: operator });
      const as =
        addInput.roles.join(", ") +
        (addInput.colonyId === undefined
          ? ""
          : ` on colony ${addInput.colonyId}`);
      io.out(
        person.rejoined
          ? `Rejoined person ${person.id} as ${as}. They had left; their history is still theirs.`
          : `Added person ${person.id} as ${as}.`,
      );
      return 0;
    }

    if (command === "list") {
      const people = await store.listPeople();
      // On the list means joined and not left (roles-and-invites.md §10.1).
      const onList = people.filter(
        (p) => p.leftAt === null && p.acceptedAt !== null,
      ).length;
      const pending = people.filter(
        (p) => p.leftAt === null && p.acceptedAt === null,
      ).length;
      const left = people.length - onList - pending;
      const extras = [
        pending ? `${pending} invited and not yet joined` : null,
        left ? `${left} marked as left` : null,
      ].filter((x) => x !== null);
      // Ids and roles only: never an address or a name (H.1(b)).
      io.out(
        `${onList} ${onList === 1 ? "person" : "people"} on the list` +
          (extras.length ? `, and ${extras.join(", and ")}.` : "."),
      );
      for (const p of people) {
        io.out(
          `${p.id}\t${p.roles.join(",") || "(no roles)"}\tsession ${p.sessionVersion}\tadded ${p.addedAt.toISOString()} by ${p.addedBy ?? "unknown"}` +
            (p.leftAt
              ? `\tLEFT ${p.leftAt.toISOString()} by ${p.leftBy ?? "unknown"}`
              : "") +
            (p.acceptedAt === null && p.leftAt === null ? "\tPENDING" : "") +
            `\tlanguage ${p.language}` +
            // Kinds only: the record's verbs, never a name (SYC-213).
            `\thistory ${p.history.map((e) => e.kind).join(",") || "(none)"}`,
        );
      }
      return 0;
    }

    // set-roles, mark-left and sign-out-everywhere: the address is typed a
    // second time.
    const email = normaliseEmail(
      flagOrEnv(flags, "email", "PEOPLE_EMAIL", io.env),
    );
    const confirmation = normaliseEmail(
      await io.ask("Type the address again to confirm: "),
    );
    if (confirmation !== email) {
      io.out("The addresses don't match. Nothing was changed.");
      return 1;
    }
    if (setRolesInput) {
      const result = await store.setRoles({
        ...setRolesInput,
        email,
        by: operator,
      });
      // Role names and colony ids only.
      io.out(`Person ${result.id}`);
      io.out(`  before: ${result.before.join(", ") || "(no roles)"}`);
      io.out(`  after:  ${result.after.join(", ") || "(no roles)"}`);
      if (result.droppedPlacements.length) {
        io.out(
          `  WARNING: --replace took away their cat guardian placement${result.droppedPlacements.length === 1 ? "" : "s"}: ${result.droppedPlacements.join(", ")}.`,
        );
      }
      return 0;
    }
    if (command === "mark-left") {
      // SYC-53 PR 1.1: the last management person is refused unless
      // --force (the break-glass, as for set-roles; SYC-333).
      const marked = await store.markLeft(email, operator, {
        force: flags.has("force"),
      });
      io.out(
        marked === null
          ? "That address isn't on the list. Nothing was changed."
          : marked.invitationWithdrawn
            ? `Person ${marked.id} hadn't joined, so their invitation was withdrawn (and their address removed if they never joined).`
            : `Marked person ${marked.id} as left. They're signed out everywhere and can't sign in. Their history stays theirs.` +
              (marked.withdrawnInvitations
                ? ` ${marked.withdrawnInvitations} pending invitation${marked.withdrawnInvitations === 1 ? "" : "s"} they sent ${marked.withdrawnInvitations === 1 ? "was" : "were"} withdrawn.`
                : ""),
      );
      return marked === null ? 1 : 0;
    }
    const version = await store.signOutEverywhere(email, operator);
    io.out(
      version === null
        ? "That address isn't on the list. Nothing was changed."
        : `Signed that person out everywhere (session version is now ${version}).`,
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

/**
 * The first line of a piped stdin (db-ops pipes the confirmation in,
 * SYC-131). Only read when the command actually asks: data already piped in
 * stays buffered until then. Settles on the first newline or end of input,
 * then lets go of stdin, so an open but idle stdin never holds the process.
 */
function firstLineOfStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    const finish = () => {
      process.stdin.off("data", onData);
      process.stdin.off("end", finish);
      process.stdin.off("error", finish);
      process.stdin.destroy();
      resolve(data.split("\n")[0] ?? "");
    };
    const onData = (chunk: Buffer | string) => {
      data += String(chunk);
      if (data.includes("\n")) finish();
    };
    process.stdin.on("data", onData);
    process.stdin.once("end", finish);
    process.stdin.once("error", finish);
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  // A terminal gets the interactive retype; anything else (db-ops) has the
  // answer read from stdin, and only by a command that asks.
  const rl = process.stdin.isTTY
    ? readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })
    : null;
  runPeopleCommand(process.argv.slice(2), {
    env: process.env,
    out: (line) => console.log(line),
    ask: (question) => (rl ? rl.question(question) : firstLineOfStdin()),
  })
    .then((code) => {
      rl?.close();
      process.exitCode = code;
    })
    .catch(() => {
      rl?.close();
      process.exitCode = 1;
    });
}
