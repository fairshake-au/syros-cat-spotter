import { readFileSync } from "node:fs";
import pg from "pg";
import { carryBack, formatCarryBackReport } from "./carryBack";
import { compare as doCompare, fingerprint as doFingerprint } from "./fingerprint";
import { cutoverDone, guardTarget, mark, rehearsalMarked, type GuardMode } from "./guard";

// pnpm --filter @workspace/db run switchover <command>
//
// SOURCE_DATABASE_URL / TARGET_DATABASE_URL name the two ends. See
// docs/superpowers/plans/syc-121-neon-switchover.md, Part B.3.
//
//   fingerprint                        fingerprints SOURCE (read-only)
//   guard-target --mode rehearsal|cutover   wipes/checks TARGET
//   mark --mode rehearsal|cutover [--fingerprint <md5>] [--fingerprint-file <json>]
//                                       marks TARGET, storing the copy source's fingerprint
//   compare [--projected]               fingerprints SOURCE and TARGET (both read-only)
//   carry-back [--apply]                SOURCE = Neon production, TARGET = the old
//                                       database; a dry run unless --apply (carryBack.ts)

class SwitchoverCliError extends Error {}

function flag(args: string[], name: string): boolean {
  return args.includes(name);
}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (!v) throw new SwitchoverCliError(`${name} needs a value`);
  return v;
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new SwitchoverCliError(`${name} must be set`);
  return v;
}

async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

/**
 * Opens the connection read-only at the session level (R1, §B.3): any write
 * attempt through this client fails with SQLSTATE 25006, whatever the
 * caller tries to do with it.
 */
async function connectReadOnly(url: string): Promise<pg.Client> {
  const client = await connect(url);
  await client.query("set session characteristics as transaction read only");
  return client;
}

function parseMode(args: string[]): GuardMode {
  const m = option(args, "--mode");
  if (m !== "rehearsal" && m !== "cutover") {
    throw new SwitchoverCliError("--mode must be rehearsal or cutover");
  }
  return m;
}

async function cmdFingerprint(): Promise<void> {
  const client = await connectReadOnly(requiredEnv("SOURCE_DATABASE_URL"));
  try {
    const fp = await doFingerprint(client);
    console.log(JSON.stringify(fp, null, 2));
  } finally {
    await client.end();
  }
}

async function cmdGuardTarget(args: string[]): Promise<void> {
  const mode = parseMode(args);
  const client = await connect(requiredEnv("TARGET_DATABASE_URL"));
  try {
    await guardTarget(client, mode);
    console.log(`guard-target ${mode}: target is now empty and ready.`);
  } finally {
    await client.end();
  }
}

async function cmdMark(args: string[]): Promise<void> {
  const mode = parseMode(args);
  const sourceFingerprint = option(args, "--fingerprint") ?? "";
  // The copy source's full fingerprint (counts and hashes only), kept with
  // the marker so a later carry-back can prove the old database is
  // unchanged since this copy.
  const fingerprintFile = option(args, "--fingerprint-file");
  let fingerprintJson: unknown;
  if (fingerprintFile) {
    try {
      fingerprintJson = JSON.parse(readFileSync(fingerprintFile, "utf8"));
    } catch {
      throw new SwitchoverCliError("--fingerprint-file is not a readable JSON fingerprint.");
    }
  }
  const client = await connect(requiredEnv("TARGET_DATABASE_URL"));
  try {
    await mark(client, mode, sourceFingerprint, fingerprintJson);
    const done = await cutoverDone(client);
    const rehearsed = await rehearsalMarked(client);
    console.log(
      `mark ${mode}: cutover_done=${done} rehearsal_marker=${rehearsed}`,
    );
  } finally {
    await client.end();
  }
}

async function cmdCompare(args: string[]): Promise<void> {
  const projected = flag(args, "--projected");
  const source = await connectReadOnly(requiredEnv("SOURCE_DATABASE_URL"));
  const target = await connectReadOnly(requiredEnv("TARGET_DATABASE_URL"));
  try {
    const diffs = await doCompare(source, target, { projected });
    if (diffs.length) {
      for (const d of diffs) console.error(`DIFF ${d.kind}: ${d.detail}`);
      throw new SwitchoverCliError(`compare found ${diffs.length} difference(s).`);
    }
    console.log("compare: no differences.");
  } finally {
    await source.end();
    await target.end();
  }
}

async function cmdCarryBack(args: string[]): Promise<void> {
  const apply = flag(args, "--apply");
  const source = await connectReadOnly(requiredEnv("SOURCE_DATABASE_URL"));
  // Only --apply needs to write; the dry run's target connection is also
  // read-only, since it must change nothing.
  const target = apply
    ? await connect(requiredEnv("TARGET_DATABASE_URL"))
    : await connectReadOnly(requiredEnv("TARGET_DATABASE_URL"));
  try {
    const report = await carryBack(source, target, { apply });
    // The formatted report only: ids, never contents, device ids hashed.
    console.log(formatCarryBackReport(report));
  } finally {
    await source.end();
    await target.end();
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "fingerprint":
      return cmdFingerprint();
    case "guard-target":
      return cmdGuardTarget(args);
    case "mark":
      return cmdMark(args);
    case "compare":
      return cmdCompare(args);
    case "carry-back":
      return cmdCarryBack(args);
    default:
      throw new SwitchoverCliError(`unknown command: ${command ?? "(none)"}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
