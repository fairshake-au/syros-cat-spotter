import { pathToFileURL } from "node:url";
import pg from "pg";
import { redact, resolveTarget } from "../people/cli";
import { isSettingKey, SETTING_KEYS, settingWriteProblem } from "./shape";

// The `settings` command (SYC-36 / SYC-48, match-wait plan PR 1, Samuel's
// Decision 1): how Claude changes the match-wait switches, with Samuel's OK
// each time, until the team dashboard has a page for them (SYC-383).
//
//   pnpm --filter @workspace/db run settings -- list --target <t>
//   pnpm --filter @workspace/db run settings -- set --target <t> --key <key> --value <json>
//
// <json> is the value as JSON: "\"https://syroscats.com/donations\"" (or
// "\"\"" to switch the link off), "[\"fact.earTip\"]", "false". A key outside
// the three, or a value of the wrong shape, is refused before connecting.
// The database is picked exactly as the people command picks it (db-ops.sh):
// --target, DATABASE_TARGET must equal it, and the address comes only from
// that target's own NEON_*_URL. Output never shows a connection string.
// Run through db-ops (`set-setting`, `list-settings`).

export interface SettingsIo {
  env: Record<string, string | undefined>;
  out: (line: string) => void;
}

const USAGE = [
  "Usage:",
  "  settings list --target <target>",
  "  settings set --target <target> --key <key> --value <json>",
  `<key> is one of: ${SETTING_KEYS.join(", ")}.`,
  "<target> is development, rehearsal or production, and DATABASE_TARGET must equal it.",
].join("\n");

class UsageError extends Error {}

function parse(argv: string[]): { command: string; flags: Map<string, string> } {
  const [command, ...rest] = argv.filter((a) => a !== "--");
  if (!command) throw new UsageError("No command given.");
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i]!;
    const value = rest[i + 1];
    if (!flag.startsWith("--") || value === undefined || flags.has(flag.slice(2))) {
      throw new UsageError(`Unexpected argument "${flag}".`);
    }
    flags.set(flag.slice(2), value);
  }
  return { command, flags };
}

function need(flags: Map<string, string>, name: string): string {
  const v = flags.get(name);
  if (v === undefined) throw new UsageError(`Give --${name}.`);
  return v;
}

/** Runs one command. Returns the process exit code. */
export async function runSettingsCommand(argv: string[], io: SettingsIo): Promise<number> {
  let client: pg.Client | undefined;
  let connectionString: string | undefined;
  try {
    const { command, flags } = parse(argv);
    if (command !== "list" && command !== "set") throw new UsageError(`Unknown command "${command}".`);

    // Check the change before connecting, so a refusal touches nothing.
    let key: string | undefined;
    let value: unknown;
    if (command === "set") {
      key = need(flags, "key");
      if (!isSettingKey(key)) throw new UsageError(`Unknown key "${key}".`);
      const raw = need(flags, "value");
      try {
        value = JSON.parse(raw);
      } catch {
        throw new UsageError("--value must be JSON, e.g. \"\\\"https://…\\\"\", \"[]\" or \"false\".");
      }
      const problem = settingWriteProblem(key, value);
      if (problem) throw new UsageError(`${key} ${problem}. Nothing was changed.`);
    }

    const target = need(flags, "target");
    const resolved = resolveTarget(target, io.env);
    if ("problem" in resolved) {
      io.out(resolved.problem);
      return 2;
    }
    connectionString = resolved.url;
    io.out(`Target: ${target}`);
    client = new pg.Client({ connectionString });
    await client.connect();

    if (command === "set") {
      await client.query(
        `insert into app_settings (key, value, updated_at) values ($1, $2::jsonb, now())
         on conflict (key) do update set value = excluded.value, updated_at = now()`,
        [key, JSON.stringify(value)],
      );
      io.out(`Set ${key} = ${JSON.stringify(value)}`);
    }

    const rows = await client.query<{ key: string; value: unknown; updated_at: Date }>(
      "select key, value, updated_at from app_settings order by key",
    );
    for (const k of SETTING_KEYS) {
      const row = rows.rows.find((r) => r.key === k);
      io.out(
        row
          ? `${k} = ${JSON.stringify(row.value)} (changed ${new Date(row.updated_at).toISOString()})`
          : `${k}: no row (the server uses its default)`,
      );
    }
    io.out("The server picks a change up within a minute; phones the next time they open the app with a signal.");
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      io.out(err.message);
      io.out(USAGE);
      return 2;
    }
    io.out(redact(`settings failed: ${err instanceof Error ? err.message : String(err)}`, connectionString));
    return 1;
  } finally {
    await client?.end().catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSettingsCommand(process.argv.slice(2), {
    env: process.env,
    out: (line) => console.log(line),
  }).then((code) => process.exit(code));
}
