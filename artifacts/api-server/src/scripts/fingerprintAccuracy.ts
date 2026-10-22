import { pathToFileURL } from "node:url";
import { safeError } from "../lib/logger";
import { chooseModelAndK, hitRate } from "./accuracyRules";
import { dinoEmbedder, loadClipEmbedder, type Embedder } from "./embedders";

// SYC-527 piece 3, Task 4: the accuracy check (spec section 8) that chooses
// the looks-like model and the shortlist length K. READ-ONLY and prints
// aggregates and ranks only.
//
//   Check 1 (smoke, the island's own photos; db-ops `fingerprint-accuracy`):
//     pnpm --filter @workspace/db exec tsx ../../artifacts/api-server/src/scripts/fingerprintAccuracy.ts
//       [--clip-dir <folder>]            (or CLIP_MODEL_DIR; without it CLIP is skipped)
//   Check 2 (a local folder of individually labelled cats; the Mac only):
//       ... fingerprintAccuracy.ts --dataset <folder> [--clip-dir <folder>] [--max-cats <n>]
//
// Check 2 needs no database. Check 1 reads the database named by the usual
// environment (DATABASE_URL etc.), over a read-only session.

interface Args {
  dataset?: string;
  clipDir?: string;
  maxCats?: number;
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): Args {
  const out: Args = { clipDir: env["CLIP_MODEL_DIR"] || undefined };
  const list = argv.filter((a) => a !== "--");
  for (let i = 0; i < list.length; i += 2) {
    const flag = list[i]!;
    const value = list[i + 1];
    if (value === undefined || value === "") throw new Error(`Give a value after ${flag}.`);
    if (flag === "--dataset") out.dataset = value;
    else if (flag === "--clip-dir") out.clipDir = value;
    else if (flag === "--max-cats") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) throw new Error("--max-cats must be a whole number of 1 or more.");
      out.maxCats = n;
    } else throw new Error(`Unknown argument ${flag}.`);
  }
  return out;
}

async function embedders(args: Args, say: (l: string) => void): Promise<Embedder[]> {
  const list: Embedder[] = [];
  if (args.clipDir) list.push(await loadClipEmbedder(args.clipDir)); // CLIP loads before DINOv2.
  else say("CLIP check skipped: no --clip-dir (or CLIP_MODEL_DIR) given. Only DINOv2 small is measured.");
  list.push(dinoEmbedder);
  return list;
}

export async function main(argv: string[], env: NodeJS.ProcessEnv, say: (l: string) => void): Promise<number> {
  const args = parseArgs(argv, env);
  const models = await embedders(args, say);
  const names = models.map((m) => m.name);

  if (args.dataset) {
    const { runDatasetCheck, formatDataset } = await import("./datasetCheck");
    const r = await runDatasetCheck(args.dataset, models, { maxCats: args.maxCats });
    formatDataset(r).forEach(say);
    const dino = r.ranks["dinov2-small-q8"];
    const clip = r.ranks["clip-b32-q8"];
    if (dino && clip) {
      const c2 = {
        dino: { top10: hitRate(dino, 10)!, top20: hitRate(dino, 20)! },
        clip: { top10: hitRate(clip, 10)!, top20: hitRate(clip, 20)! },
      };
      const d = chooseModelAndK(c2, true);
      say(`Rule 1 (model) on this set: ${d.model}. Rule 2 (K) needs the smoke result too; with it passing at 10: K = ${d.k}.`);
    } else {
      say("Both models are needed to apply the model rule; run with --clip-dir.");
    }
    return 0;
  }

  const { makeReadOnly, runSmokeCheck, formatSmoke, smokePassesAt } = await import("./smokeCheck");
  await makeReadOnly();
  const r = await runSmokeCheck(models);
  formatSmoke(r, names).forEach(say);
  if (names.length === 2) {
    const smoke = {
      dino: smokePassesAt(r, "dinov2-small-q8", 10),
      clip: smokePassesAt(r, "clip-b32-q8", 10),
    };
    say(`Smoke passes at top 10: dinov2-small-q8 ${smoke.dino}, clip-b32-q8 ${smoke.clip}. Apply the rules with check 2's rates (chooseWithSmoke) to pick the model and K.`);
  } else {
    say("With check 2 skipped the rules give: dinov2-small-q8, K = 20.");
  }
  // The pool keeps the process alive; end it so the script exits.
  const { pool } = await import("@workspace/db");
  await pool.end();
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env, (l) => console.log(l)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      // safeError: a database error's own message can carry a query and its values.
      console.error(`fingerprint-accuracy failed: ${JSON.stringify(safeError(err))}`);
      process.exit(1);
    },
  );
}
