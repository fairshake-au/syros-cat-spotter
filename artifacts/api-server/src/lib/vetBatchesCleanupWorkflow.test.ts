/**
 * SYC-677: the vet-batches clean-up workflow's shell step, run for real with a
 * stand-in curl (and sleep) on PATH, as coatReadingsWorkflow.test.ts does.
 *  - The token only ever goes to the app's own address (never one with "@").
 *  - A connection failure or a 502/503 is retried once.
 *  - Any non-2xx fails the run (the app answers 500 when a batch could not go).
 *  - It is scheduled, but only runs once the rollout switch is on.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOW = resolve(__dirname, "../../../../.github/workflows/vet-batches-cleanup.yml");

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
 * (prints 000, exits with that code).
 */
function run(env: { BASE_URL?: string; TOKEN?: string }, responses: Response[] = [200]) {
  const dir = mkdtempSync(join(tmpdir(), "vet-cleanup-"));
  const calls = join(dir, "calls");
  writeFileSync(
    join(dir, "responses"),
    responses.map((r) => (typeof r === "number" ? String(r) : `exit${r.exit}`)).join("\n") + "\n",
  );
  writeFileSync(
    join(dir, "curl"),
    `#!/usr/bin/env bash
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift ;; -H|-w|-X|--max-time) shift ;; -*) ;; *) url="$1" ;; esac
  shift
done
printf '%s\\n' "$url" >> "${calls}"
n=$(wc -l < "${calls}" | tr -d ' ')
r=$(sed -n "\${n}p" "${join(dir, "responses")}")
case "$r" in exit*) printf 000; exit "\${r#exit}" ;; esac
[ -n "$out" ] && printf '{"removed":2,"failed":0}' > "$out"
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
        MAIL_DRAIN_TOKEN: env.TOKEN ?? "test-token",
        BASE_URL: env.BASE_URL ?? "https://apptest.catspotters.com",
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    status = e.status;
    output = `${e.stdout}${e.stderr}`;
  }
  const urls = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : [];
  return { status, output, curlCalls: urls.length, urls };
}

describe("vet-batches-cleanup workflow step", () => {
  it("posts to the clean-up and prints the answer, never the token", () => {
    const r = run({});
    expect(r.status).toBe(0);
    expect(r.urls).toEqual(["https://apptest.catspotters.com/api/internal/vet-batches/cleanup"]);
    expect(r.output).toContain("HTTP 200");
    expect(r.output).toContain('"removed":2');
    expect(r.output).not.toContain("test-token");
  });

  it("a trailing slash on the address is fine, and localhost is allowed", () => {
    expect(run({ BASE_URL: "https://apptest.catspotters.com/" }).urls).toEqual([
      "https://apptest.catspotters.com/api/internal/vet-batches/cleanup",
    ]);
    expect(run({ BASE_URL: "http://localhost:8080" }).status).toBe(0);
  });

  it("the token never goes to any other host, and an address with '@' is refused outright", () => {
    for (const url of [
      "https://evil.example.com",
      "https://apptest.catspotters.com.evil.example.com",
      "https://apptest.catspotters.com@evil.example.com",
      "https://apptest.catspotters.com:pw@evil.example.com",
      "https://apptest.catspotters.com:@evil.example.com",
      "http://localhost:x@evil.example.com",
      "http://localhost:80@evil.example.com",
      "https://apptest.catspotters.com/x@y",
      "http://apptest.catspotters.com",
    ]) {
      const r = run({ BASE_URL: url });
      expect(r.status, url).not.toBe(0);
      expect(r.curlCalls, url).toBe(0);
    }
  });

  it("refuses to run with no token, before calling", () => {
    const r = run({ TOKEN: "" });
    expect(r.status).not.toBe(0);
    expect(r.curlCalls).toBe(0);
  });

  it("a connection failure (a sleeping deployment) and a 503 are each retried once", () => {
    expect(run({}, [{ exit: 7 }, 200])).toMatchObject({ curlCalls: 2, status: 0 });
    expect(run({}, [503, 200])).toMatchObject({ curlCalls: 2, status: 0 });
  });

  it("any non-2xx fails the run, including the app's 500 when a batch could not be removed", () => {
    for (const code of [401, 500]) {
      const r = run({}, [code]);
      expect(r.status, String(code)).not.toBe(0);
      expect(r.output).toContain(`HTTP ${code}`);
    }
  });

  it("is scheduled daily, and the schedule waits for the rollout switch (a manual run always goes)", () => {
    const src = readFileSync(WORKFLOW, "utf8");
    expect(src).toMatch(/^\s*schedule:/m);
    expect(src).toContain("vars.VET_BATCH_CLEANUP_ENABLED == 'true' || github.event_name == 'workflow_dispatch'");
    expect(src).toContain("secrets.MAIL_DRAIN_TOKEN");
  });
});
