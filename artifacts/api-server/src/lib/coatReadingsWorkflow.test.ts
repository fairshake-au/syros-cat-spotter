/**
 * SYC-161 plan, PR 1: the coat-readings workflow's shell step, run for real
 * with a stand-in curl (and sleep) on PATH, as mailDrainWorkflow.test.ts does
 * for the mail drain.
 *  - The token only ever goes to the app's own address.
 *  - The request body is built from the run's inputs, which are checked first.
 *  - A connection failure is retried once; a timeout never is (a trial run
 *    twice would pay for its model calls twice).
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOW = resolve(__dirname, "../../../../.github/workflows/coat-readings.yml");

/** The `run: |` block of the step, de-indented. */
function runScript(): string {
  const lines = readFileSync(WORKFLOW, "utf8").split("\n");
  const start = lines.findIndex((l) => /^\s+run: \|\s*$/.test(l));
  expect(start).toBeGreaterThan(-1);
  const indent = lines[start]!.search(/\S/) + 2;
  const body: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (l.trim() && l.search(/\S/) < indent) break;
    body.push(l.slice(indent));
  }
  return body.join("\n");
}

type Response = number | { exit: number };

/**
 * Runs the step. Each entry of `responses` is what one curl call does: a
 * number answers with that HTTP status; `{ exit }` fails like curl does
 * (prints 000, exits with that code: 7 = couldn't connect, 28 = timed out).
 */
function run(env: { BASE_URL?: string; MODE?: string; LIMIT?: string; EXCLUDE?: string; REREAD?: string }, responses: Response[] = [200]) {
  const dir = mkdtempSync(join(tmpdir(), "coat-readings-"));
  const calls = join(dir, "calls");
  writeFileSync(
    join(dir, "responses"),
    responses.map((r) => (typeof r === "number" ? String(r) : `exit${r.exit}`)).join("\n") + "\n",
  );
  writeFileSync(
    join(dir, "curl"),
    `#!/usr/bin/env bash
out=""; data=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift ;; --data) data="$2"; shift ;; -H|-w|-X|--max-time) shift ;; -*) ;; *) url="$1" ;; esac
  shift
done
printf '%s %s\\n' "$url" "$data" >> "${calls}"
n=$(wc -l < "${calls}" | tr -d ' ')
r=$(sed -n "\${n}p" "${join(dir, "responses")}")
case "$r" in exit*) printf 000; exit "\${r#exit}" ;; esac
[ -n "$out" ] && printf '{"mode":"dry_run","due":3}' > "$out"
printf '%s' "$r"
`,
  );
  writeFileSync(join(dir, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(join(dir, "curl"), 0o755);
  chmodSync(join(dir, "sleep"), 0o755);
  const script = join(dir, "step.sh");
  writeFileSync(script, runScript());
  let status = 0;
  let output = "";
  try {
    output = execFileSync("bash", [script], {
      env: {
        PATH: `${dir}:${process.env["PATH"]}`,
        MAIL_DRAIN_TOKEN: "test-token",
        BASE_URL: env.BASE_URL ?? "https://apptest.catspotters.com",
        MODE: env.MODE ?? "dry_run",
        LIMIT: env.LIMIT ?? "50",
        EXCLUDE: env.EXCLUDE ?? "",
        REREAD: env.REREAD ?? "false",
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    status = e.status;
    output = `${e.stdout}${e.stderr}`;
  }
  const lines = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : [];
  return {
    status,
    output,
    curlCalls: lines.length,
    urls: lines.map((l) => l.split(" ")[0]),
    bodies: lines.map((l) => JSON.parse(l.slice(l.indexOf(" ") + 1)) as unknown),
  };
}

describe("coat-readings workflow step", () => {
  it("posts the run's inputs to the sweep and prints the answer", () => {
    const r = run({ MODE: "write", LIMIT: "12", EXCLUDE: "4, 17,23" });
    expect(r.status).toBe(0);
    expect(r.urls).toEqual(["https://apptest.catspotters.com/api/internal/coat/sweep"]);
    expect(r.bodies).toEqual([{ mode: "write", limit: 12, exclude: [4, 17, 23], reread: false }]);
    expect(r.output).toContain("HTTP 200");
    expect(r.output).toContain('"due": 3');
    expect(r.output).not.toContain("test-token");
  });

  it("exclude: spaces separate ids too, never joining them (ship review finding 2)", () => {
    expect(run({ MODE: "write", EXCLUDE: "12 14, 7" }).bodies).toEqual([{ mode: "write", limit: 50, exclude: [12, 14, 7], reread: false }]);
    expect(run({ MODE: "write", EXCLUDE: " 3,,  9 " }).bodies).toEqual([{ mode: "write", limit: 50, exclude: [3, 9], reread: false }]);
  });

  it("defaults: a dry run with nothing excluded", () => {
    expect(run({}).bodies).toEqual([{ mode: "dry_run", limit: 50, exclude: [], reread: false }]);
  });

  it("SYC-398 §7: the run's reread reaches the body as a real boolean, off by default", () => {
    expect(run({ MODE: "trial", REREAD: "true" }).bodies).toEqual([
      { mode: "trial", limit: 50, exclude: [], reread: true },
    ]);
    expect(run({ MODE: "write", REREAD: "false", EXCLUDE: "5" }).bodies).toEqual([
      { mode: "write", limit: 50, exclude: [5], reread: false },
    ]);
    const src = readFileSync(WORKFLOW, "utf8");
    expect(src).toMatch(/reread:\n\s+type: choice\n\s+options: \["false", "true"\]\n\s+default: "false"/);
    expect(src).toContain("REREAD: ${{ inputs.reread }}");
  });

  it("refuses a reread that isn't false or true, before calling", () => {
    for (const REREAD of ["yes", "1", "", "TRUE", "true,", '{"a":1}', "true || 1"]) {
      const r = run({ REREAD });
      expect(r.status, REREAD).not.toBe(0);
      expect(r.curlCalls, REREAD).toBe(0);
    }
  });

  it("the token never goes to any other host", () => {
    for (const url of [
      "https://evil.example.com",
      "https://apptest.catspotters.com.evil.example.com",
      "https://apptest.catspotters.com@evil.example.com",
      "https://apptest.catspotters.com:pw@evil.example.com",
      "https://apptest.catspotters.com:@evil.example.com",
      "http://localhost:x@evil.example.com",
      "http://apptest.catspotters.com",
    ]) {
      const r = run({ BASE_URL: url });
      expect(r.status, url).not.toBe(0);
      expect(r.curlCalls, url).toBe(0);
    }
  });

  it("refuses a bad mode, limit or exclude before calling", () => {
    for (const env of [
      { MODE: "fill_in" },
      { LIMIT: "51" },
      { LIMIT: "0" },
      { LIMIT: "ten" },
      { LIMIT: "" },
      { EXCLUDE: "4;rm -rf /" },
      { EXCLUDE: "4,$(id)" },
    ]) {
      const r = run(env);
      expect(r.status, JSON.stringify(env)).not.toBe(0);
      expect(r.curlCalls, JSON.stringify(env)).toBe(0);
    }
  });

  it("a connection failure (a sleeping deployment) is retried once", () => {
    const r = run({ MODE: "trial" }, [{ exit: 7 }, 200]);
    expect(r.curlCalls).toBe(2);
    expect(r.status).toBe(0);
  });

  it("a 503 from the platform is retried once", () => {
    expect(run({}, [503, 200]).curlCalls).toBe(2);
  });

  it("a timeout or a 504 is never retried: the app may still be working", () => {
    for (const first of [{ exit: 28 }, 504] as Response[]) {
      const r = run({ MODE: "trial" }, [first, 200]);
      expect(r.curlCalls, JSON.stringify(first)).toBe(1);
      expect(r.status).not.toBe(0);
    }
  });

  it("a non-200 fails the run", () => {
    const r = run({}, [401]);
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("HTTP 401");
  });

  it("has no schedule: it only ever runs by hand", () => {
    const src = readFileSync(WORKFLOW, "utf8");
    expect(src).not.toMatch(/^\s*schedule:/m);
    expect(src).toMatch(/^\s*workflow_dispatch:/m);
    // The address is never an input of the run.
    expect(src).not.toMatch(/inputs\.base_url/);
  });
});
