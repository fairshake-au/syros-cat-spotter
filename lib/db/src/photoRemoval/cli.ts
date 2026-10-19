import { pathToFileURL } from "node:url";
import pg from "pg";
import { redact, resolveTarget } from "../people/cli";
import { hidePhotoForPrivacy, restorePhoto } from "./hide";
import { listCatPhotos } from "./list";
import { removePhoto, type RemovalPlan } from "./remove";
import { isPhotoRef, PERSON_ID_RE, PUBLIC_ID_RE } from "./rules";
import type { SearchResult } from "./search";

// The `photos` command (SYC-462, docs/runbooks/photo-removal.md): how Claude
// removes a photo by hand on a privacy request, until SYC-246's button.
//
//   pnpm --filter @workspace/db run photos -- list    --target <t> --cat <n>
//   pnpm --filter @workspace/db run photos -- hide    --target <t> --photo <id> --by <person> [--confirm HIDE]
//   pnpm --filter @workspace/db run photos -- restore --target <t> --photo <id> --by <person> [--confirm RESTORE]
//   pnpm --filter @workspace/db run photos -- remove  --target <t> --photo <id> --by <person> --ref <ref>
//                                                      [--photo-confirm <id> --confirm REMOVE]
//
// Every writing command is a dry run unless --confirm names it; remove also
// needs the id typed twice. On production, remove also needs the
// photo_removal_on setting (spec §4.6). The database is picked exactly as the
// people command picks it (db-ops.sh). Run through db-ops (photo-list,
// photo-hide, photo-restore, photo-remove).
//
// **Everything printed is public** (the repository and its workflow runs are):
// photo ids, cat numbers, sighting numbers, dates and yes/no only. Never a
// location, a device, a name, a note, a report reason or a hide reason.
//
// Exit codes: 0 done, already, or a dry run; 1 refused, or failed; 2 a usage
// or target problem (as the settings command); 3 NOT GONE; 4 NOT VERIFIED.

export interface PhotosIo {
  env: Record<string, string | undefined>;
  out: (line: string) => void;
}

const USAGE = [
  "Usage:",
  "  photos list    --target <target> --cat <number>",
  "  photos hide    --target <target> --photo <public id> --by <people id> [--confirm HIDE]",
  "  photos restore --target <target> --photo <public id> --by <people id> [--confirm RESTORE]",
  "  photos remove  --target <target> --photo <public id> --by <people id> --ref <ref> [--photo-confirm <public id> --confirm REMOVE]",
  "<ref> is SYC-<number> or 'hello YYYY-MM-DD #<n>'. Never a name.",
  "<target> is development or production, and DATABASE_TARGET must equal it.",
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
  if (v === undefined || v === "") throw new UsageError(`Give --${name}.`);
  return v;
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const yes = (b: boolean) => (b ? "yes" : "no");

function printSearch(io: PhotosIo, search: SearchResult) {
  for (const l of search.lines) {
    const mark = l.ok === true ? "ok" : l.ok === false ? "NOT OK" : "not verified";
    io.out(`  search: ${l.check.padEnd(10)} ${mark} (${l.detail})`);
  }
}

function printPlan(io: PhotosIo, plan: RemovalPlan, done: boolean) {
  const w = (would: string, did: string) => (done ? did : `would ${would}`);
  io.out(`  picture:            ${plan.bytes.toLocaleString("en")} bytes → ${w("be deleted", "deleted")}`);
  io.out(
    `  versions:           ${plan.versions.length ? plan.versions.join(", ") : "none"}${
      plan.versions.length ? ` → ${w("be deleted", "deleted")}` : ""
    }`,
  );
  if (plan.repoints.length === 0) io.out("  main photo of:      no cat");
  for (const r of plan.repoints) {
    io.out(
      `  main photo of:      cat ${r.catId} → ${w("become", "now")} ${r.to === 0 ? "no photo (the placeholder)" : `photo row ${r.to} (what the public sees now)`}`,
    );
  }
  for (const s of plan.spotPhotos) {
    io.out(`  spot photos:        sighting ${s.sightingId} (${s.role}) → stays, shown with no photo`);
  }
  io.out(`  answers/readings:   ${plan.observations} → stay; no picture in them`);
  io.out(`  reports:            ${plan.reports} → stay`);
}

/** Runs one command. Returns the process exit code. */
export async function runPhotosCommand(argv: string[], io: PhotosIo): Promise<number> {
  let client: pg.Client | undefined;
  let connectionString: string | undefined;
  try {
    const { command, flags } = parse(argv);
    if (!["list", "hide", "restore", "remove"].includes(command)) {
      throw new UsageError(`Unknown command "${command}".`);
    }
    const target = need(flags, "target");
    if (target === "rehearsal") throw new UsageError("photos only runs against development or production.");

    // Check everything that can be checked before connecting, so a refusal touches nothing.
    let catId: number | undefined;
    let publicId = "";
    let by = "";
    let ref = "";
    let apply = false;
    if (command === "list") {
      const cat = need(flags, "cat");
      if (!/^\d{1,9}$/.test(cat)) throw new UsageError("--cat must be the cat's number.");
      catId = Number(cat);
    } else {
      publicId = need(flags, "photo");
      if (!PUBLIC_ID_RE.test(publicId)) throw new UsageError("--photo must be the photo's public id (from photos list).");
      by = need(flags, "by");
      if (!PERSON_ID_RE.test(by)) throw new UsageError("--by must be the approving team member's people id (from people-list).");
      const word = { hide: "HIDE", restore: "RESTORE", remove: "REMOVE" }[command as "hide" | "restore" | "remove"];
      const confirm = flags.get("confirm");
      if (confirm !== undefined && confirm !== "" && confirm !== word) {
        throw new UsageError(`--confirm must be ${word} for ${command}. Nothing was changed.`);
      }
      apply = confirm === word;
      if (command === "remove") {
        ref = need(flags, "ref");
        if (!isPhotoRef(ref)) {
          throw new UsageError("--ref must be SYC-<number> or 'hello YYYY-MM-DD #<n>', never a name. Nothing was changed.");
        }
        if (apply && flags.get("photo-confirm") !== publicId) {
          throw new UsageError("--photo-confirm doesn't match --photo. Nothing was changed.");
        }
      }
    }

    const resolved = resolveTarget(target, io.env);
    if ("problem" in resolved) {
      io.out(resolved.problem);
      return 2;
    }
    connectionString = resolved.url;
    client = new pg.Client({ connectionString });
    await client.connect();

    if (command === "list") {
      const photos = await listCatPhotos(client, catId!);
      io.out(`photo-list target=${target} cat=${catId}: ${photos.length} photo(s), newest first`);
      for (const p of photos) {
        io.out(
          `  ${p.publicId}  taken ${day(p.takenAt)}  ${p.uses.join(", ") || "no longer used"}` +
            `  hidden: ${yes(p.hidden)} · hidden for privacy: ${yes(p.hiddenForPrivacy)} · removed: ${p.removedAt ? day(p.removedAt) : "no"}`,
        );
      }
      return 0;
    }

    const head = (name: string) => `${name}${apply ? "" : " (DRY RUN: nothing changed)"} target=${target} photo=${publicId}`;

    if (command === "hide" || command === "restore") {
      const r =
        command === "hide"
          ? await hidePhotoForPrivacy(client, { publicId, by, apply })
          : await restorePhoto(client, { publicId, by, apply });
      io.out(head(`photo-${command}`));
      if (r.kind === "refused") {
        io.out(`  refused: ${refusalWords[r.why]}. Nothing was changed.`);
        return 1;
      }
      const s = r.state;
      io.out(`  now: hidden: ${yes(s.hiddenNow)} · hidden for privacy: ${yes(s.hiddenForPrivacy)}`);
      if (r.kind === "plan") {
        io.out(`  would: ${planWords[r.would]}`);
        io.out(`  To do it: confirm=${command === "hide" ? "HIDE" : "RESTORE"}`);
      } else {
        io.out(`  done: ${doneWords[r.kind]}`);
      }
      return 0;
    }

    const requireSwitch = target === "production";
    const r = await removePhoto(client, { publicId, by, ref, apply, requireSwitch });
    io.out(head("photo-remove"));
    if (r.kind === "refused") {
      io.out(`  refused: ${refusalWords[r.why]}. Nothing was changed.`);
      return 1;
    }
    if (r.kind === "already") {
      io.out(`  already removed on ${day(r.removedAt)}; nothing written.`);
    } else {
      io.out(`  hidden now: yes · hidden for privacy: yes${requireSwitch ? " · removal switched on: yes" : ""}`);
      printPlan(io, r.plan, r.kind === "removed");
    }
    if (r.kind === "plan") {
      io.out("  search (before removal, as things stand):");
      printSearch(io, r.search);
      io.out("  To do it: confirm=REMOVE and photo_id_confirm=<the same id>");
      return 0;
    }
    printSearch(io, r.search);
    for (const id of r.search.otherPhotoIds) {
      io.out(`  the same picture is also photo row ${id}: treat it as its own request (runbook step 6)`);
    }
    io.out(`${r.search.verdict} (${r.search.ms} ms)`);
    return r.search.verdict === "GONE" ? 0 : r.search.verdict === "NOT GONE" ? 3 : 4;
  } catch (err) {
    if (err instanceof UsageError) {
      io.out(err.message);
      io.out(USAGE);
      return 2;
    }
    io.out(redact(`photos failed: ${err instanceof Error ? err.message : String(err)}`, connectionString));
    return 1;
  } finally {
    await client?.end().catch(() => undefined);
  }
}

const refusalWords: Record<string, string> = {
  not_found: "no photo has that id",
  not_hidden: "the photo isn't hidden; hide it first (photo-hide)",
  not_for_privacy: "the photo isn't hidden for privacy (Decision 3); hide it for privacy first (photo-hide)",
  not_team: "--by isn't someone on the team now (joined, not left, staff or management in force)",
  bad_ref: "the request reference isn't SYC-<number> or 'hello YYYY-MM-DD #<n>'",
  switched_off: "removal isn't switched on for production yet (photo_removal_on; runbook, go-live step 4)",
  removed: "the photo was removed for good",
};
const planWords: Record<string, string> = {
  hide: "hide it, for privacy",
  add_privacy: "record that it is hidden for privacy (it stays hidden)",
  restore: "show it again",
  nothing: "nothing: it's already that way",
};
const doneWords: Record<string, string> = {
  hidden: "hidden, for privacy",
  privacy_added: "recorded as hidden for privacy (it stayed hidden)",
  already: "nothing: already hidden for privacy",
  restored: "shown again",
  already_public: "nothing: already shown",
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPhotosCommand(process.argv.slice(2), {
    env: process.env,
    out: (line) => console.log(line),
  }).then((code) => process.exit(code));
}
