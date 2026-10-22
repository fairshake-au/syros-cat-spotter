/**
 * SYC-527 piece 3: the fingerprints-nightly workflow's shell step, run for
 * real with a stand-in curl (and sleep) on PATH, as coatReadingsWorkflow.test.ts
 * does for the coat sweep.
 *  - The token only ever goes to the app's own address.
 *  - A missing token or a non-200 fails the run.
 *  - A connection failure is retried once; a timeout never is.
 *  - The schedule is switched by FINGERPRINTS_NIGHTLY_ENABLED, with the same
 *    guards as news-nightly.yml.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOW = resolve(__dirname, "../../../../.github/workflows/fingerprints-nightly.yml");
const text = readFileSync(WORKFLOW, "utf8");

function runScript(): string {
  const lines = text.split("\n");
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

function run(env: { BASE_URL?: string; TOKEN?: string }, responses: Response[] = [200]) {
  const dir = mkdtempSync(join(tmpdir(), "fingerprints-nightly-"));
  const calls = join(dir, "calls");
  writeFileSync(join(dir, "calls"), "");
  writeFileSync(
    join(dir, "responses"),
    responses.map((r) => (typeof r === "number" ? String(r) : `exit${r.exit}`)).join("\n") + "\n",
  );
  writeFileSync(
    join(dir, "curl"),
    `#!/usr/bin/env bash
out=""; url=""; auth=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift ;; -H) auth="$2"; shift ;; -w|-X|--max-time) shift ;; -*) ;; *) url="$1" ;; esac
  shift
done
printf '%s|%s\\n' "$url" "$auth" >> "${calls}"
n=$(wc -l < "${calls}" | tr -d ' ')
r=$(sed -n "\${n}p" "${join(dir, "responses")}")
case "$r" in exit*) printf 000; exit "\${r#exit}" ;; esac
[ -n "$out" ] && printf '{"made":2,"failed":0,"left":0}' > "$out"
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
        FINGERPRINT_JOB_TOKEN: env.TOKEN ?? "test-token",
        BASE_URL: env.BASE_URL ?? "https://apptest.catspotters.com",
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    status = err.status ?? 1;
    output = err.stdout ?? "";
  }
  const made = readFileSync(calls, "utf8").split("\n").filter(Boolean);
  return { status, output, calls: made };
}

describe("fingerprints-nightly.yml", () => {
  it("calls the route once with the bearer token and passes on 200", () => {
    const r = run({});
    expect(r.status).toBe(0);
    expect(r.calls).toEqual(["https://apptest.catspotters.com/api/internal/fingerprints/nightly|Authorization: Bearer test-token"]);
    expect(r.output).toContain('"made":2');
  });

  it("refuses any host but production or localhost, before sending the token", () => {
    for (const base of ["https://evil.example.com", "https://apptest.catspotters.com.evil.com", "http://apptest.catspotters.com"]) {
      const r = run({ BASE_URL: base });
      expect(r.status).not.toBe(0);
      expect(r.calls).toEqual([]);
    }
    expect(run({ BASE_URL: "http://localhost:8080" }).status).toBe(0);
  });

  it("fails without a token, and sends nothing", () => {
    const r = run({ TOKEN: "" });
    expect(r.status).not.toBe(0);
    expect(r.calls).toEqual([]);
  });

  it("waits at most 150 seconds for the answer (the app works for 90)", () => {
    expect(runScript()).toContain("--max-time 150");
    expect(runScript()).not.toContain("--max-time 330");
  });

  it("fails on a non-200", () => {
    expect(run({}, [401]).status).not.toBe(0);
    expect(run({}, [500]).status).not.toBe(0);
  });

  it("retries once on a connection failure or a 503, never on a timeout or a 504", () => {
    expect(run({}, [{ exit: 7 }, 200])).toMatchObject({ status: 0 });
    expect(run({}, [503, 200]).calls).toHaveLength(2);
    expect(run({}, [{ exit: 28 }, 200])).toMatchObject({ status: 1 });
    expect(run({}, [{ exit: 28 }, 200]).calls).toHaveLength(1);
    expect(run({}, [504, 200]).calls).toHaveLength(1);
  });

  it("is switched on and off like news-nightly.yml", () => {
    const news = readFileSync(resolve(__dirname, "../../../../.github/workflows/news-nightly.yml"), "utf8");
    expect(text).toContain("vars.FINGERPRINTS_NIGHTLY_ENABLED == 'true' || github.event_name == 'workflow_dispatch'");
    for (const line of ["environment: production", "permissions: { contents: read }", "cancel-in-progress: false"]) {
      expect(text).toContain(line);
      expect(news).toContain(line);
    }
    expect(text).toMatch(/secrets\.FINGERPRINT_JOB_TOKEN/);
    expect(text).toMatch(/cron: "\d+ \d+ \* \* \*"/);
    expect(text.match(/cron: "([^"]+)"/)![1]).not.toBe(news.match(/cron: "([^"]+)"/)![1]);
  });
});
