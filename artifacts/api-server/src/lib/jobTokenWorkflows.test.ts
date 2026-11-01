/**
 * SYC-769: every workflow step that holds a secret AND a BASE_URL sends the
 * secret only to the app. One test walks .github/workflows, so a new
 * workflow can't skip the guard (the guards are copies, SYC-740).
 *
 * Each such step's shell is run for real, with a stand-in curl on PATH that
 * records every call. Given a base URL with user-info, the step must fail
 * before curl runs: "https://apptest.catspotters.com:pw@evil.example.com"
 * passes a naive host check but sends the token to evil.example.com.
 *
 * A step whose shell hands BASE_URL to a script instead (db-ops.yml's smoke)
 * is listed in DELEGATED with the test that covers that script.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = resolve(__dirname, "../../../../.github/workflows");

/** Steps that pass BASE_URL on to a script, and where that script's guard is tested. */
const DELEGATED: Record<string, string> = {
  "db-ops.yml#Run": "lib/db/src/migrate/smoke.test.ts (SYC-769: refuses user-info and other hosts before any request)",
};

/** Inputs a step validates before it calls out, set to a valid value so the default address gets through. */
const INPUTS: Record<string, Record<string, string>> = {
  "coat-readings.yml#Run the colour sweep": { MODE: "dry_run", LIMIT: "1", EXCLUDE: "", REREAD: "false" },
};

type Step = { id: string; secrets: string[]; script: string };

/** Every step in a workflow that has a `run:`, with the secrets its env reads. */
function steps(file: string): Step[] {
  const lines = readFileSync(join(DIR, file), "utf8").split("\n");
  const found: Step[] = [];
  lines.forEach((line, i) => {
    const run = line.match(/^\s+(?:- )?run: (.*)$/);
    if (!run) return;
    const runIndent = line.search(/\S/);
    // The step starts at the nearest "- " line two spaces left of `run:`.
    let start = i;
    while (start > 0 && !(lines[start]!.search(/\S/) === runIndent - 2 && lines[start]!.trimStart().startsWith("- "))) start--;
    const head = lines.slice(start, i).join("\n");
    const name = head.match(/^\s*- name: (.+)$/m)?.[1]?.trim() ?? `line ${i + 1}`;
    const body: string[] = [];
    if (run[1]!.trim() === "|") {
      for (const l of lines.slice(i + 1)) {
        if (l.trim() && l.search(/\S/) <= runIndent) break;
        body.push(l.slice(runIndent + 2));
      }
    } else {
      body.push(run[1]!);
    }
    const secrets = [...head.matchAll(/^\s+([A-Z][A-Z0-9_]*): \$\{\{ secrets\.[A-Z0-9_]+ \}\}/gm)].map((m) => m[1]!);
    if (/^\s+BASE_URL:/m.test(head) || body.some((l) => l.includes("BASE_URL"))) {
      found.push({ id: `${file}#${name}`, secrets, script: body.join("\n") });
    }
  });
  return found;
}

const workflows = readdirSync(DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
const tokenSteps = workflows.flatMap(steps).filter((s) => s.secrets.length > 0);
const guarded = tokenSteps.filter((s) => !(s.id in DELEGATED));

/** Run a step's shell with every secret set, a recording curl, and a no-op sleep. */
function run(step: Step, baseUrl: string): { status: number; calls: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "job-token-workflow-"));
  const calls = join(dir, "calls");
  writeFileSync(calls, "");
  writeFileSync(
    join(dir, "curl"),
    `#!/usr/bin/env bash
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift ;; -H|-w|-X|--max-time|-d|--data) shift ;; -*) ;; *) url="$1" ;; esac
  shift
done
printf '%s\\n' "$url" >> "${calls}"
[ -n "$out" ] && printf '{}' > "$out"
printf 200
`,
  );
  writeFileSync(join(dir, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(join(dir, "curl"), 0o755);
  chmodSync(join(dir, "sleep"), 0o755);
  const script = join(dir, "step.sh");
  writeFileSync(script, step.script);
  const env: Record<string, string> = { PATH: `${dir}:${process.env["PATH"]}`, ...INPUTS[step.id], BASE_URL: baseUrl };
  for (const name of step.secrets) env[name] = "test-token";
  let status = 0;
  try {
    execFileSync("bash", [script], { env, stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 });
  } catch (e) {
    status = (e as { status?: number }).status ?? 1;
  }
  return { status, calls: readFileSync(calls, "utf8").split("\n").filter(Boolean) };
}

const USER_INFO = [
  "https://apptest.catspotters.com:pw@evil.example.com",
  "https://apptest.catspotters.com@evil.example.com",
  "http://localhost:80@evil.example.com",
  "http://127.0.0.1@evil.example.com",
  "https://user@apptest.catspotters.com",
];

describe("workflows that send a job token (SYC-769)", () => {
  it("finds every step that holds a secret and a BASE_URL (the walk itself works)", () => {
    expect(guarded.map((s) => s.id).sort()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^coat-readings\.yml#/),
        expect.stringMatching(/^fingerprints-nightly\.yml#/),
        expect.stringMatching(/^mail-drain\.yml#/),
        expect.stringMatching(/^news-nightly\.yml#/),
        expect.stringMatching(/^vet-batches-cleanup\.yml#/),
      ]),
    );
    // fingerprints-nightly has two token steps (fill, then the look-alike sweep).
    expect(guarded.filter((s) => s.id.startsWith("fingerprints-nightly.yml#"))).toHaveLength(2);
    // Every delegated entry still names a real step, so the list can't go stale.
    for (const id of [...Object.keys(DELEGATED), ...Object.keys(INPUTS)]) expect(tokenSteps.map((s) => s.id)).toContain(id);
  });

  it("each one calls the app with the default address (so the refusals below are real refusals)", () => {
    for (const step of guarded) {
      expect(run(step, "https://apptest.catspotters.com").calls.length, step.id).toBeGreaterThan(0);
    }
  });

  it("each one refuses a base URL with '@' in it, before curl runs", () => {
    for (const step of guarded) {
      for (const base of USER_INFO) {
        const r = run(step, base);
        expect(r.status, `${step.id} with ${base}`).not.toBe(0);
        expect(r.calls, `${step.id} with ${base}`).toEqual([]);
      }
    }
  });

  it("each one refuses another host, or plain http to the app, before curl runs", () => {
    for (const step of guarded) {
      for (const base of ["https://evil.example.com", "https://apptest.catspotters.com.evil.com", "http://apptest.catspotters.com"]) {
        const r = run(step, base);
        expect(r.status, `${step.id} with ${base}`).not.toBe(0);
        expect(r.calls, `${step.id} with ${base}`).toEqual([]);
      }
    }
  });
});
